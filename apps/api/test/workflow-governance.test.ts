/**
 * Prompt 8 — composite workflow governance.
 *
 * A workflow is authorized as ONE unit (workflow-level authorization +
 * approval), but its inner steps invoke other capabilities. These tests prove
 * the unit is BOUNDED:
 *
 *  - the initiating run's RBAC ceiling applies to EVERY inner step and
 *    compensation (fails closed, audited, compensation of completed steps
 *    runs), and `workflows.execute` alone never grants hire/assign/create;
 *  - the trusted tenant/workspace/actor come from the instance, never input;
 *  - a policy DENY on an inner step stays final; policy-required approval is
 *    never silently satisfied by a REST start;
 *  - lineage attribution (agent, delegation, approval) rides along WITHOUT
 *    re-running delegation checks;
 *  - external evidence claiming approval cannot become authority.
 *
 * Adapter-level tests use the REAL ToolExecutor + WorkflowRuntime with fake
 * tools; the end-to-end tests drive the REAL REST and chat paths.
 */

import { describe, expect, it } from 'vitest';
import type { Tool, ToolExecutionContext } from '@nexora/agent-sdk/tools';
import {
  ToolExecutor,
  type LineagePort,
  type PolicyInvocationRequest,
  type PolicyPort,
  type SecurityDecision,
} from '@nexora/ai-runtime/execution';
import { ExecutableToolRegistry } from '@nexora/ai-runtime/registry';
import type { PolicyDecision, PolicyOutcome } from '@nexora/module-policy';
import {
  WorkflowDefinitionRegistry,
  WorkflowRuntime,
  hireAndAssignEmployeeWorkflowDefinition,
  type WorkflowStepInvocation,
} from '@nexora/module-workflow';
import type { TenantId } from '@nexora/contracts/common';
import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import type { WorkflowInstance, WorkflowStepExecution } from '@nexora/module-workflow';

import { WorkflowToolStepExecutor } from '../src/ai/workflow-executor.js';
import type {
  FakeEmployeeRepository,
  FakeProjectRepository,
  FakeWorkflowInstanceRepository,
} from './fakes.js';
import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  parseSse,
  seedEmployee,
  seedOrganization,
  seedOrganizationMembership,
  seedProject,
  seedWorkspace,
  seedWorkspaceMembership,
  type ChatClient,
} from './helpers.js';

const HIRE_KEY = 'hr.hire_and_assign_employee';
const CREATE_KEY = 'projects.create_and_assign_employee';
const ALL_HIRE = ['hr.create_employee', 'projects.find_project', 'projects.assign_employee'];

// ---------------------------------------------------------------------------
// Adapter-level harness (real ToolExecutor + WorkflowRuntime, fake tools)
// ---------------------------------------------------------------------------

function decisionOf(
  outcome: PolicyOutcome,
  rules: { policyId: string; outcome: PolicyOutcome }[],
  extra: Partial<PolicyDecision> = {},
): PolicyDecision {
  return {
    outcome,
    policyId: rules[0]?.policyId ?? 'POLICY_TEST',
    version: '1',
    reasonCode: outcome,
    reason: `scripted ${outcome}`,
    matchedRules: rules.map((rule) => ({ ...rule, version: '1', reasonCode: rule.outcome })),
    fingerprint: 'fp',
    evaluatedAt: new Date().toISOString(),
    ...extra,
  } as PolicyDecision;
}

class ScriptedPolicy implements PolicyPort {
  readonly requests: PolicyInvocationRequest[] = [];
  constructor(private readonly decide: (req: PolicyInvocationRequest) => PolicyDecision) {}
  async evaluate(request: PolicyInvocationRequest): Promise<PolicyDecision> {
    this.requests.push(request);
    return this.decide(request);
  }
}

function fakeTool(id: string, sideEffect: 'read_only' | 'state_change' | 'consequential') {
  const contexts: ToolExecutionContext[] = [];
  const inputs: Record<string, unknown>[] = [];
  const tool: Tool = {
    manifest: {
      id,
      name: id,
      description: id,
      sideEffectClass: sideEffect,
      idempotent: false,
      timeoutMs: 1000,
      inputSchema: { type: 'object', properties: {}, additionalProperties: true },
    },
    execute: async (input, context) => {
      contexts.push(context);
      inputs.push(input as Record<string, unknown>);
      return {
        ok: true,
        output: { employee: { id: 'emp_0a1b2c3d-0000-4000-8000-000000000001' }, id },
        completedAt: new Date().toISOString(),
      };
    },
  };
  return { tool, contexts, inputs };
}

interface Rig {
  adapter: WorkflowToolStepExecutor;
  runtime: WorkflowRuntime;
  decisions: SecurityDecision[];
  ran: string[];
  lineage: {
    agentId?: string;
    delegationId?: string;
    approvalId?: string;
    userId: string;
    toolId: string;
  }[];
  agentAuthorityCalls: number;
  contexts: Map<string, ToolExecutionContext[]>;
  instances: Map<string, WorkflowInstance>;
  executions: Map<string, WorkflowStepExecution>;
}

function rig(policy: PolicyPort = ALL_HIRE_POLICY()): Rig {
  const tools = new ExecutableToolRegistry();
  const contexts = new Map<string, ToolExecutionContext[]>();
  const ran: string[] = [];
  for (const [id, effect] of [
    ['hr.create_employee', 'consequential'],
    ['projects.find_project', 'read_only'],
    ['projects.assign_employee', 'consequential'],
    ['hr.revoke_hire', 'consequential'],
  ] as const) {
    const t = fakeTool(id, effect);
    const original = t.tool.execute;
    t.tool.execute = async (input, context) => {
      ran.push(id);
      return original(input, context);
    };
    contexts.set(id, t.contexts);
    tools.register(t.tool);
  }
  const decisions: SecurityDecision[] = [];
  const lineage: Rig['lineage'] = [];
  const port: LineagePort = {
    planned: async () => undefined,
    executed: async (event) => {
      lineage.push({
        ...(event.agent === undefined ? {} : { agentId: event.agent.agentId }),
        ...(event.delegationId === undefined ? {} : { delegationId: event.delegationId }),
        ...(event.approvalId === undefined ? {} : { approvalId: event.approvalId }),
        userId: event.userId,
        toolId: event.toolId,
      });
    },
  };
  const state = { agentAuthorityCalls: 0 };
  const executor = new ToolExecutor({
    tools,
    policy,
    lineage: port,
    securitySink: (decision) => {
      decisions.push(decision);
    },
    agentAuthority: {
      check: async () => {
        state.agentAuthorityCalls += 1;
        return { ok: false, reasonCode: 'AGENT_REVOKED', reason: 'must never be consulted' };
      },
    } as never,
  });
  const adapter = new WorkflowToolStepExecutor(executor, tools);
  const instances = new Map<string, WorkflowInstance>();
  const executions = new Map<string, WorkflowStepExecution>();
  const publisher: EventPublisher = {
    publish: async (_events: readonly EventEnvelope[]) => undefined,
  };
  const runtime = new WorkflowRuntime({
    definitions: new WorkflowDefinitionRegistry([hireAndAssignEmployeeWorkflowDefinition()]),
    instances: {
      findById: async (id) => instances.get(id),
      listByTenant: async () => [...instances.values()],
      save: async (instance) => {
        instances.set(instance.id, instance);
      },
    },
    executions: {
      findById: async (id) => executions.get(id),
      findByWorkflowAndStep: async (workflowId, stepId) =>
        [...executions.values()]
          .filter((e) => e.workflowId === workflowId && e.stepId === stepId)
          .sort((a, b) => b.attempt - a.attempt)[0],
      listByWorkflow: async (workflowId) =>
        [...executions.values()].filter((e) => e.workflowId === workflowId),
      listByTenant: async () => [...executions.values()],
      save: async (execution) => {
        executions.set(execution.id, execution);
      },
    },
    executor: adapter,
    publisher,
  });
  return {
    adapter,
    runtime,
    decisions,
    ran,
    lineage,
    get agentAuthorityCalls() {
      return state.agentAuthorityCalls;
    },
    contexts,
    instances,
    executions,
  };
}

/** Baseline policy: consequential -> REQUIRE_APPROVAL (side-effect rule), read -> ALLOW. */
function ALL_HIRE_POLICY(): PolicyPort {
  return new ScriptedPolicy((req) =>
    req.sideEffectClass === 'read_only'
      ? decisionOf('ALLOW', [{ policyId: 'POLICY_SIDE_EFFECT_APPROVAL', outcome: 'ALLOW' }])
      : decisionOf('REQUIRE_APPROVAL', [
          { policyId: 'POLICY_SIDE_EFFECT_APPROVAL', outcome: 'REQUIRE_APPROVAL' },
        ]),
  );
}

const INPUT = { employeeName: 'Rohan Das', projectName: 'Quantum Ledger' };
const CTX = {
  userId: 'usr_initiator',
  tenantId: 'org_a' as TenantId,
  correlationId: 'corr_wf',
  workspaceId: 'wsp_a' as never,
};

function invocation(overrides: Partial<WorkflowStepInvocation> = {}): WorkflowStepInvocation {
  return {
    stepId: 'hire_employee',
    capabilityId: 'hr.create_employee',
    toolId: 'hr.create_employee',
    input: { name: 'Rohan' },
    purpose: 'step',
    context: {
      userId: 'usr_initiator',
      tenantId: 'org_a',
      workspaceId: 'wsp_a',
      runId: 'run_1',
      autonomyTier: 'supervised',
      allowedCapabilityIds: ALL_HIRE,
    },
    approvalGranted: true,
    approvalBasis: 'approval_engine',
    ...overrides,
  };
}

describe('workflow ceiling — every inner step is bounded by the initiator ceiling', () => {
  it('an inner capability outside the ceiling fails closed FORBIDDEN, is audited, and never runs', async () => {
    const r = rig();
    const result = await r.adapter.execute(
      invocation({
        context: { ...invocation().context, allowedCapabilityIds: ['projects.find_project'] },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('FORBIDDEN');
    expect(r.ran).toEqual([]);
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({
      reasonCode: 'CAPABILITY_NOT_PERMITTED',
      origin: 'workflow',
      capabilityId: 'hr.create_employee',
      actorId: 'usr_initiator',
      outcome: 'blocked',
    });
  });

  it('an instance with NO ceiling (or an empty one) permits nothing — fail closed', async () => {
    for (const ceiling of [undefined, []] as const) {
      const r = rig();
      const base = invocation();
      const context = { ...base.context };
      if (ceiling === undefined) {
        delete (context as { allowedCapabilityIds?: unknown }).allowedCapabilityIds;
      } else {
        context.allowedCapabilityIds = ceiling;
      }
      const result = await r.adapter.execute({ ...base, context });
      expect(result.error?.code).toBe('FORBIDDEN');
      expect(r.ran).toEqual([]);
    }
  });

  it('runtime: an out-of-ceiling step fails the workflow, the completed hire is compensated, the refusal is audited', async () => {
    const r = rig();
    const result = await r.runtime.create({
      definitionKey: HIRE_KEY,
      // The ceiling covers hire + find but NOT assign.
      context: {
        ...CTX,
        origin: 'orchestrator',
        allowedCapabilityIds: ['hr.create_employee', 'projects.find_project'],
      },
      input: INPUT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.instance.status).toBe('compensated');
    // hire ran (forward), assign was refused, the hire was rolled back.
    expect(r.ran).toContain('hr.create_employee');
    expect(r.ran).not.toContain('projects.assign_employee');
    expect(r.ran).toContain('hr.revoke_hire');
    const refusal = r.decisions.find((d) => d.capabilityId === 'projects.assign_employee');
    expect(refusal).toMatchObject({ reasonCode: 'CAPABILITY_NOT_PERMITTED', origin: 'workflow' });
    const assign = result.value.steps.find((s) => s.stepId === 'assign_employee');
    expect(assign?.status).toBe('failed');
  });

  it('runtime: a ceiling lacking the FIRST mutating capability runs nothing and compensates nothing', async () => {
    const r = rig();
    const result = await r.runtime.create({
      definitionKey: HIRE_KEY,
      context: {
        ...CTX,
        allowedCapabilityIds: ['projects.find_project', 'projects.assign_employee'],
      },
      input: INPUT,
    });
    expect(result.ok && result.value.instance.status).not.toBe('succeeded');
    expect(r.ran).not.toContain('hr.create_employee');
    expect(r.ran).not.toContain('hr.revoke_hire');
    expect(r.ran).not.toContain('projects.assign_employee');
  });

  it('compensation stays bounded: it runs only when the forward capability it undoes was permitted', async () => {
    const compensation = (allowed: string[]) =>
      invocation({
        stepId: 'compensate:hire_employee',
        capabilityId: 'hr.revoke_hire',
        toolId: 'hr.revoke_hire',
        input: { employeeId: 'emp_0a1b2c3d-0000-4000-8000-000000000001' },
        purpose: 'compensation',
        compensatesCapabilityId: 'hr.create_employee',
        context: { ...invocation().context, allowedCapabilityIds: allowed },
      });
    const denied = rig();
    const refused = await denied.adapter.execute(compensation(['projects.find_project']));
    expect(refused.error?.code).toBe('FORBIDDEN');
    expect(denied.ran).toEqual([]);

    const allowed = rig();
    const ok = await allowed.adapter.execute(compensation(['hr.create_employee']));
    expect(ok.ok).toBe(true);
    expect(allowed.ran).toEqual(['hr.revoke_hire']);
  });
});

describe('workflow scope + actor — trusted values only', () => {
  it('scope and actor come from the instance context; forged identity in step input is refused', async () => {
    const r = rig();
    const result = await r.adapter.execute(
      invocation({
        input: {
          name: 'Rohan',
          userId: 'usr_admin',
          tenantId: 'org_other',
          workspaceId: 'wsp_other',
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('RESERVED_ARGUMENT');
    expect(r.ran).toEqual([]);

    const clean = await r.adapter.execute(invocation());
    expect(clean.ok).toBe(true);
    const context = r.contexts.get('hr.create_employee')?.[0];
    expect(context).toMatchObject({
      userId: 'usr_initiator',
      tenantId: 'org_a',
      workspaceId: 'wsp_a',
      origin: 'workflow',
    });
  });
});

describe('workflow policy — DENY stays final; approval never overrides it', () => {
  it('an inner DENY blocks even with approvalGranted (workflow approval never overrides policy)', async () => {
    const r = rig(
      new ScriptedPolicy(() =>
        decisionOf('DENY', [{ policyId: 'POLICY_TEST_DENY', outcome: 'DENY' }]),
      ),
    );
    const result = await r.adapter.execute(invocation({ approvalGranted: true }));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('POLICY_DENIED');
    expect(r.ran).toEqual([]);
  });

  it('a direct human start satisfies ONLY the baseline side-effect gate, never an org-required approval', async () => {
    const orgRequired = new ScriptedPolicy(() =>
      decisionOf('REQUIRE_APPROVAL', [
        { policyId: 'POLICY_SIDE_EFFECT_APPROVAL', outcome: 'REQUIRE_APPROVAL' },
        { policyId: 'POLICY_FINANCE_EXPENSE_APPROVAL', outcome: 'REQUIRE_APPROVAL' },
      ]),
    );
    const direct = rig(orgRequired);
    const blocked = await direct.adapter.execute(invocation({ approvalBasis: 'direct_human' }));
    expect(blocked.blocked).toBe(true);
    expect(direct.ran).toEqual([]);

    // Same decision, approved through the approval engine: satisfied.
    const engine = rig(orgRequired);
    const ok = await engine.adapter.execute(invocation({ approvalBasis: 'approval_engine' }));
    expect(ok.ok).toBe(true);

    // Baseline only + direct human: satisfied.
    const baseline = rig();
    const fine = await baseline.adapter.execute(invocation({ approvalBasis: 'direct_human' }));
    expect(fine.ok).toBe(true);

    // Org approval-authority governance attached: a direct start never satisfies it.
    const governed = rig(
      new ScriptedPolicy(() =>
        decisionOf(
          'REQUIRE_APPROVAL',
          [{ policyId: 'POLICY_SIDE_EFFECT_APPROVAL', outcome: 'REQUIRE_APPROVAL' }],
          {
            approval: {
              separationOfDuties: true,
              policyId: 'POLICY_APPROVAL_AUTHORITY',
              policyVersion: '1+config.1',
            },
          },
        ),
      ),
    );
    const stillBlocked = await governed.adapter.execute(
      invocation({ approvalBasis: 'direct_human' }),
    );
    expect(stillBlocked.blocked).toBe(true);
  });
});

describe('workflow attribution — lineage carries initiator/agent/delegation/approval, no re-check', () => {
  it('records the initiating actor + agent + delegation + approval; agent authority is not consulted', async () => {
    const r = rig();
    const result = await r.runtime.create({
      definitionKey: HIRE_KEY,
      context: {
        ...CTX,
        origin: 'agent',
        agentId: 'agt_hr',
        delegationId: 'dlg_1',
        approvalId: 'apr_1',
        allowedCapabilityIds: ALL_HIRE,
      },
      input: INPUT,
    });
    expect(result.ok && result.value.instance.status).toBe('succeeded');
    expect(r.lineage.length).toBeGreaterThanOrEqual(3);
    for (const event of r.lineage) {
      expect(event).toMatchObject({
        userId: 'usr_initiator',
        agentId: 'agt_hr',
        delegationId: 'dlg_1',
        approvalId: 'apr_1',
      });
    }
    expect(r.agentAuthorityCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: REST + chat (real app)
// ---------------------------------------------------------------------------

/** A delivery.manager: org `admin` tier (workflows.execute, but NOT employees.manage / projects.assign). */
async function managerClient(): Promise<{ client: ChatClient; organizationId: string }> {
  const client = await chatClient();
  const organizationId = 'org_mgr_wf';
  await seedOrganization(client.repos, { id: organizationId, slug: 'org-mgr-wf' });
  await seedOrganizationMembership(client.repos, {
    organizationId,
    userId: currentUserId(client),
    role: 'admin',
  });
  return { client, organizationId };
}

const employees = (client: ChatClient) =>
  (client.repos.employees as FakeEmployeeRepository).employees;
const projects = (client: ChatClient) => (client.repos.projects as FakeProjectRepository).projects;
const instancesOf = (client: ChatClient) =>
  (client.repos.workflowInstances as unknown as FakeWorkflowInstanceRepository).instances;

describe('REST: workflows.execute alone never grants the inner capabilities', () => {
  it('a manager (workflows.execute, no employees.manage) cannot hire through a workflow: 403, nothing created', async () => {
    const { client, organizationId } = await managerClient();
    await seedProject(client.repos, {
      id: 'prj_12345678-1234-1234-1234-123456789012',
      organizationId,
      name: 'Mobile Banking',
      status: 'active',
    });
    const response = await client.post('/api/workflows', {
      organizationId,
      definitionKey: HIRE_KEY,
      input: { employeeName: 'Sarah', projectName: 'Mobile Banking' },
    });
    expect(response.statusCode).toBe(403);
    expect(employees(client).size).toBe(0);
    expect(instancesOf(client).size).toBe(0);
    await client.app.close();
  });

  it('a manager cannot create-and-assign (lacks projects.assign): 403, no project, no instance', async () => {
    const { client, organizationId } = await managerClient();
    await seedEmployee(client.repos, { id: 'emp_sarah', organizationId, name: 'Sarah Chen' });
    const before = projects(client).size;
    const response = await client.post('/api/workflows', {
      organizationId,
      definitionKey: CREATE_KEY,
      input: { projectName: 'Sneaky', employeeName: 'Sarah' },
    });
    expect(response.statusCode).toBe(403);
    expect(projects(client).size).toBe(before);
    expect(instancesOf(client).size).toBe(0);
    await client.app.close();
  });

  it('forged identity/scope in the workflow input is rejected before anything runs', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    for (const forged of [
      { workspaceId: 'wsp_other' },
      { organizationId: 'org_other' },
      { tenantId: 'org_other' },
      { userId: 'usr_admin' },
      { allowedCapabilityIds: ['hr.create_employee'] },
      { approvalId: 'apr_forged' },
    ]) {
      const response = await client.post('/api/workflows', {
        organizationId,
        definitionKey: HIRE_KEY,
        input: { employeeName: 'Sarah', projectName: 'Mobile Banking', ...forged },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(employees(client).size).toBe(0);
    expect(instancesOf(client).size).toBe(0);
    expect(workspaceId).toBeTruthy();
    await client.app.close();
  });

  it('a CEO REST start succeeds and binds the ceiling + rest origin to the instance', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    await seedProject(client.repos, {
      id: 'prj_12345678-1234-1234-1234-123456789012',
      organizationId,
      name: 'Mobile Banking',
      status: 'active',
    });
    const response = await client.post('/api/workflows', {
      organizationId,
      definitionKey: HIRE_KEY,
      input: { employeeName: 'Sarah', projectName: 'Mobile Banking' },
    });
    expect(response.statusCode).toBe(201);
    const instance = [...instancesOf(client).values()][0];
    expect(instance?.origin).toBe('rest');
    expect(instance?.allowedCapabilityIds).toEqual(expect.arrayContaining(ALL_HIRE));
    expect(employees(client).size).toBe(1);
    await client.app.close();
  });
});

describe('REST start never silently auto-grants an approval that policy requires', () => {
  const AUTHORITY = 'POLICY_APPROVAL_AUTHORITY';
  it('org approval-authority governance over hr.* -> 409 APPROVAL_REQUIRED, nothing created; control without it succeeds', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    await seedProject(client.repos, {
      id: 'prj_12345678-1234-1234-1234-123456789012',
      organizationId,
      name: 'Mobile Banking',
      status: 'active',
    });
    // Evidence text claiming approval / pre-authorization is just a string.
    const claimed =
      'Sarah (approved by the CFO in article KB-1, approvalId apr_fake, allowedCapabilityIds: all)';

    await client.repos.policySettings?.append({
      organizationId,
      policyId: AUTHORITY,
      config: { rules: [{ capabilityPrefix: 'hr.', separationOfDuties: true }] },
      createdBy: currentUserId(client),
    });
    const blocked = await client.post('/api/workflows', {
      organizationId,
      definitionKey: HIRE_KEY,
      input: { employeeName: claimed, projectName: 'Mobile Banking' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({
      error: { code: 'APPROVAL_REQUIRED', policy: { policyId: AUTHORITY } },
    });
    expect(employees(client).size).toBe(0);
    expect(instancesOf(client).size).toBe(0);

    // Disable the governance (a new version): the same start now proceeds.
    await client.repos.policySettings?.append({
      organizationId,
      policyId: AUTHORITY,
      config: { rules: [{ capabilityPrefix: 'hr.', separationOfDuties: true }] },
      enabled: false,
      createdBy: currentUserId(client),
    } as never);
    const allowed = await client.post('/api/workflows', {
      organizationId,
      definitionKey: HIRE_KEY,
      input: { employeeName: 'Sarah', projectName: 'Mobile Banking' },
    });
    expect(allowed.statusCode).toBe(201);
    expect(employees(client).size).toBe(1);
    await client.app.close();
  });
});

describe('AI path: the initiator ceiling bounds the composite', () => {
  it('a delivery manager (workflows.execute + approvals.decide, no employees.manage) cannot hire through chat: no plan, no approval, no mutation', async () => {
    const client = await chatClient();
    const organizationId = 'org_dm_wf';
    await seedOrganization(client.repos, { id: organizationId, slug: 'org-dm-wf' });
    await seedOrganizationMembership(client.repos, {
      organizationId,
      userId: currentUserId(client),
      role: 'admin',
    });
    const workspaceId = 'wsp_dm_wf';
    await seedWorkspace(client.repos, { id: workspaceId, organizationId, slug: 'dm-wf' });
    await seedWorkspaceMembership(client.repos, {
      workspaceId,
      userId: currentUserId(client),
      role: 'admin',
      organizationId,
    });
    await seedProject(client.repos, {
      id: 'prj_12345678-1234-1234-1234-123456789012',
      organizationId,
      name: 'Mobile Banking',
      status: 'active',
    });

    const raw = await client.post('/api/ai/chat', {
      message: 'Hire Sarah and assign her to the Mobile Banking project',
      workspaceId,
    });
    expect(raw.statusCode).toBe(200);
    const done = parseSse(raw.body as string).find((e) => e.event === 'done')?.data as {
      status: string;
      approvals: unknown[];
      steps: { toolId: string; status: string }[];
    };
    expect(done.approvals).toEqual([]);
    expect(done.steps.some((step) => step.toolId.startsWith('workflow.'))).toBe(false);
    expect(employees(client).size).toBe(0);
    expect(instancesOf(client).size).toBe(0);
    await client.app.close();
  });

  it('the composite tools re-verify the initiator server-side (defense in depth), and bind the ceiling', async () => {
    const { HireAndAssignWorkflowTool } = await import('../src/ai/tools/hire-and-assign-tool.js');
    const started: { context: Record<string, unknown> }[] = [];
    const build = (granted: readonly string[]) =>
      new HireAndAssignWorkflowTool({
        startWorkflow: {
          handle: async (command: { context: Record<string, unknown> }) => {
            started.push(command);
            return { ok: false, error: { code: 'X', message: 'stop' } };
          },
        } as never,
        listOrganizations: {
          handle: async () => ({ ok: true, value: [{ id: 'org_a' }] }),
        } as never,
        resolveInitiatorCapabilities: async () => granted,
        listEmployeesByIds: {} as never,
        listProjects: {} as never,
        listProjectMembers: {} as never,
      });
    const context = {
      userId: 'usr_initiator',
      tenantId: 'org_a',
      workspaceId: 'wsp_a',
      executionId: 'run_1',
    };
    const input = { employeeName: 'Sarah', projectName: 'Mobile Banking' };

    // RBAC lacks hr.create_employee: refused, nothing started — even if the
    // invoking run's own ceiling would have allowed it (workflows.execute alone grants nothing).
    const refused = await build(['projects.find_project', 'projects.assign_employee']).execute(
      input,
      { ...context, allowedCapabilityIds: ALL_HIRE },
    );
    expect(refused.ok).toBe(false);
    expect(started).toHaveLength(0);

    // The run's own (agent) ceiling narrows RBAC: refused too.
    const narrowed = await build(ALL_HIRE).execute(input, {
      ...context,
      allowedCapabilityIds: ['projects.find_project'],
    });
    expect(narrowed.ok).toBe(false);
    expect(started).toHaveLength(0);

    // No resolver and no run ceiling: fail closed.
    const bare = new HireAndAssignWorkflowTool({
      startWorkflow: { handle: async () => ({ ok: false, error: { code: 'X' } }) } as never,
      listOrganizations: { handle: async () => ({ ok: true, value: [{ id: 'org_a' }] }) } as never,
      listEmployeesByIds: {} as never,
      listProjects: {} as never,
      listProjectMembers: {} as never,
    });
    expect((await bare.execute(input, context)).ok).toBe(false);

    // Holds all three: the workflow starts with the ceiling bound.
    await build(ALL_HIRE).execute(input, {
      ...context,
      allowedCapabilityIds: [...ALL_HIRE, 'x.y'],
    });
    expect(started).toHaveLength(1);
    expect(started[0]?.context['allowedCapabilityIds']).toEqual(ALL_HIRE);
    expect(started[0]?.context['userId']).toBe('usr_initiator');
    expect(started[0]?.context['tenantId']).toBe('org_a');
  });

  it('control: a CEO through the same AI path succeeds and the instance carries the ceiling + approval', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    await seedProject(client.repos, {
      id: 'prj_12345678-1234-1234-1234-123456789012',
      organizationId,
      name: 'Mobile Banking',
      status: 'active',
    });
    const raw = await client.post('/api/ai/chat', {
      message: 'Hire Sarah and assign her to the Mobile Banking project',
      workspaceId,
    });
    const done = parseSse(raw.body as string).find((e) => e.event === 'done')?.data as {
      approvals: { id?: string }[];
    };
    const decision = await client.post(`/api/ai/approvals/${done.approvals[0]?.id}/decision`, {
      decision: 'approve',
    });
    expect(decision.statusCode).toBe(200);
    expect(employees(client).size).toBe(1);
    const instance = [...instancesOf(client).values()][0];
    expect(instance?.allowedCapabilityIds).toEqual(expect.arrayContaining(ALL_HIRE));
    expect(instance?.approvalId).toMatch(/^apr_/);
    await client.app.close();
  });
});
