/**
 * @nexora/evaluation — dataset validation.
 *
 * Structural integrity of a scenario dataset, checked BEFORE anything runs:
 * unique ids, every reference resolvable, required category coverage, and
 * the invariants the platform itself enforces (e.g. an expense's decider is
 * never its submitter). A broken fixture must fail here with a precise
 * message — never surface later as a misleading evaluation result.
 */

import { WorldIndex } from './factories.js';
import {
  SCENARIO_CATEGORIES,
  type AgentLifecycleStep,
  type ScenarioDataset,
  type ScenarioDefinition,
  type ScenarioWorld,
} from './scenario.js';

/** Validates a dataset; returns every issue found (empty = valid). */
export function validateDataset(dataset: ScenarioDataset): readonly string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const scenario of dataset.scenarios) {
    if (ids.has(scenario.id)) issues.push(`duplicate scenario id ${scenario.id}`);
    ids.add(scenario.id);
    issues.push(...validateScenario(scenario).map((issue) => `${scenario.id}: ${issue}`));
  }
  const covered = new Set(dataset.scenarios.map((scenario) => scenario.category));
  for (const category of SCENARIO_CATEGORIES) {
    if (!covered.has(category)) issues.push(`no scenario covers category ${category}`);
  }
  return issues;
}

/** Validates one scenario (world integrity + every key it references). */
export function validateScenario(scenario: ScenarioDefinition): readonly string[] {
  const issues = [...validateWorld(scenario.world)];
  const world = new WorldIndex(scenario.world);
  const check = (label: string, fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      issues.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  check('organization', () => world.organization(scenario.organization));
  if (scenario.workspace !== undefined) {
    const workspace = scenario.workspace;
    check('workspace', () => world.workspace(workspace));
  }

  const request = scenario.request;

  /** Texts of lifecycle steps that may carry `{org:k}`-style placeholders. */
  const placeholderTexts: unknown[] = [];
  const stepLabels = new Set<string>();
  const checkLifecycleStep = (step: AgentLifecycleStep): void => {
    if (
      step.kind === 'http' ||
      step.kind === 'decide' ||
      step.kind === 'decide_expense' ||
      step.kind === 'replay_claim' ||
      step.kind === 'start_workflow' ||
      step.kind === 'invoke_tool'
    ) {
      if (stepLabels.has(step.label)) issues.push(`duplicate step label ${step.label}`);
      stepLabels.add(step.label);
    }
    if (step.kind === 'revoke_delegation') {
      check('afterGate delegation', () => {
        if (world.entity(step.delegation).kind !== 'delegation')
          throw new Error('not a delegation');
      });
    } else if (step.kind === 'set_policy') {
      check('afterGate policy organization', () => world.organization(step.organization));
      check('afterGate policy actor', () => world.user(step.by));
    } else if (step.kind === 'close_budget') {
      check('afterGate budget', () => world.entityId(step.budget));
      check('afterGate actor', () => world.user(step.by));
    } else if (step.kind === 'update_article') {
      check('afterGate article', () => world.entityId(step.article));
      check('afterGate actor', () => world.user(step.by));
    } else if (step.kind === 'ask') {
      check('afterGate ask actor', () => world.user(step.actor));
      check('afterGate ask workspace', () => world.workspace(step.workspace));
    } else if (step.kind === 'http') {
      check('step http actor', () => world.user(step.actor));
      placeholderTexts.push(step.path, ...Object.values(step.body ?? {}));
    } else if (step.kind === 'decide') {
      check('step decide actor', () => world.user(step.actor));
      placeholderTexts.push(...Object.values(step.extra ?? {}), step.approvalId ?? '');
    } else if (step.kind === 'tamper_telemetry') {
      check('step tamper organization', () => world.organization(step.organization));
    } else if (step.kind === 'decide_expense') {
      check('step decide_expense actor', () => world.user(step.actor));
      check('step decide_expense organization', () => world.organization(step.organization));
      check('step decide_expense workspace', () => world.workspace(step.workspace));
    } else if (step.kind === 'disconnect_connector') {
      check('step disconnect organization', () => world.organization(step.organization));
      const connected = scenario.world.entities.some(
        (entity) =>
          entity.kind === 'connector' &&
          entity.organization === step.organization &&
          entity.provider === step.provider,
      );
      if (!connected) issues.push(`disconnect_connector: no ${step.provider} connector fixture`);
    } else if (step.kind === 'suspend_agent') {
      check('afterGate agent', () => {
        if (world.entity(step.agent).kind !== 'agent') throw new Error('not an agent');
      });
    } else if (step.kind === 'start_workflow') {
      check('step start_workflow actor', () => world.user(step.actor));
      check('step start_workflow organization', () => world.organization(step.organization));
      const workspace = step.workspace;
      if (workspace !== undefined)
        check('step start_workflow workspace', () => world.workspace(workspace));
    } else if (step.kind === 'invoke_tool') {
      check('step invoke_tool actor', () => world.user(step.actor));
      check('step invoke_tool organization', () => world.organization(step.organization));
      check('step invoke_tool workspace', () => world.workspace(step.workspace));
    }
  };
  check('request actor', () => world.user(request.actor));
  if (request.channel === 'chat') {
    for (const step of request.afterGate ?? []) checkLifecycleStep(step);
    for (const step of request.after ?? []) checkLifecycleStep(step);
    if (request.organization !== undefined) {
      const organization = request.organization;
      check('request organization', () => world.organization(organization));
    }
    if (request.workspace !== undefined) {
      const workspace = request.workspace;
      check('request workspace', () => world.workspace(workspace));
    }
  }
  if (request.channel === 'http') {
    for (const step of request.after ?? []) checkLifecycleStep(step);
  }
  if (request.channel === 'remediation') {
    check('request organization', () => world.organization(request.organization));
    check('request workspace', () => world.workspace(request.workspace));
    for (const step of request.afterGate ?? []) checkLifecycleStep(step);
    for (const step of request.after ?? []) checkLifecycleStep(step);
  }
  if (
    (request.channel === 'chat' || request.channel === 'remediation') &&
    request.decision !== undefined
  ) {
    const decider = request.decision.actor;
    check('decision actor', () => world.user(decider));
    if (!scenario.expected.approval.required) {
      issues.push('a decision step is declared but no approval is expected');
    }
  }
  if (request.channel === 'mcp') {
    for (const step of request.afterGate ?? []) checkLifecycleStep(step);
    for (const step of request.after ?? []) checkLifecycleStep(step);
    for (const extra of request.additional ?? []) {
      if (stepLabels.has(extra.label)) issues.push(`duplicate step label ${extra.label}`);
      stepLabels.add(extra.label);
      placeholderTexts.push(...Object.values(extra.arguments));
    }
    check('request organization', () => world.organization(request.organization));
    if (request.workspace !== undefined) {
      const workspace = request.workspace;
      check('request workspace', () => world.workspace(workspace));
    }
    if (request.agent !== undefined) {
      const agent = request.agent;
      check('request agent', () => {
        if (world.entity(agent).kind !== 'agent') throw new Error('not an agent');
      });
    }
  }
  if (request.channel === 'agent') {
    check('request organization', () => world.organization(request.organization));
    check('request workspace', () => world.workspace(request.workspace));
    check('request agent', () => {
      if (world.entity(request.agent).kind !== 'agent') throw new Error('not an agent');
    });
    if (request.scopeWorkspace !== undefined) {
      const scopeWorkspace = request.scopeWorkspace;
      check('request scope workspace', () => world.workspace(scopeWorkspace));
    }
    for (const step of request.afterGate ?? []) checkLifecycleStep(step);
    if (request.decision !== undefined) {
      const decider = request.decision.actor;
      check('decision actor', () => world.user(decider));
      if (!scenario.expected.approval.required) {
        issues.push('a decision step is declared but no approval is expected');
      }
    }
  }
  {
    const texts =
      request.channel === 'http'
        ? [request.path, ...Object.values(request.body ?? {})]
        : request.channel === 'mcp'
          ? Object.values(request.arguments)
          : request.channel === 'chat'
            ? [request.message]
            : request.channel === 'agent'
              ? [request.utterance, request.agentId ?? '', request.followUp ?? '']
              : [];
    const placeholders = [...texts, ...placeholderTexts]
      .filter((value): value is string => typeof value === 'string')
      .flatMap((text) => [...text.matchAll(/\{(org|ws|id|user):([^}]+)\}/g)]);
    for (const match of placeholders) {
      const [, kind, key] = match as unknown as [string, string, string];
      check(`placeholder {${kind}:${key}}`, () => {
        if (kind === 'org') world.organization(key);
        else if (kind === 'ws') world.workspace(key);
        else if (kind === 'user') world.user(key);
        else world.entityId(key);
      });
    }
  }

  const expected = scenario.expected;
  for (const key of [
    ...(expected.retrieval?.required ?? []),
    ...(expected.retrieval?.forbidden ?? []),
  ]) {
    check(`retrieval source ${key}`, () => world.entityId(key));
  }
  for (const matcher of [...expected.audit.required, ...expected.audit.forbidden]) {
    if (matcher.organization !== undefined) {
      const organization = matcher.organization;
      check('audit organization', () => world.organization(organization));
    }
    if (matcher.workspace !== undefined) {
      const workspace = matcher.workspace;
      check('audit workspace', () => world.workspace(workspace));
    }
  }
  for (const stateCheck of expected.verification.checks) {
    if (
      stateCheck.kind === 'count' ||
      stateCheck.kind === 'problem_status' ||
      stateCheck.kind === 'connector_writes'
    ) {
      check('verification organization', () => world.organization(stateCheck.organization));
    }
    if (
      stateCheck.kind === 'count' &&
      stateCheck.entity !== 'employee' &&
      (stateCheck.status !== undefined || stateCheck.statusNot !== undefined)
    ) {
      issues.push(`${scenario.id}: status filters apply to employee counts only`);
    }
    if (stateCheck.kind === 'count' && stateCheck.workspace !== undefined) {
      const workspace = stateCheck.workspace;
      check('verification workspace', () => world.workspace(workspace));
    }
    if (
      stateCheck.kind === 'lineage' ||
      stateCheck.kind === 'lineage_integrity' ||
      stateCheck.kind === 'audit_trace'
    ) {
      check('verification organization', () => world.organization(stateCheck.organization));
    }
    if (stateCheck.kind === 'audit_trace' && stateCheck.composite !== undefined) {
      const composite = stateCheck.composite;
      check('trace composite requester', () => world.user(composite.requester));
      check('trace composite approver', () => world.user(composite.approver));
      if (composite.approver === composite.requester) {
        issues.push('audit_trace composite: the approver must differ from the requester');
      }
      const agent = composite.agent;
      if (agent !== undefined) {
        check('trace composite agent', () => {
          if (world.entity(agent).kind !== 'agent') throw new Error('not an agent');
        });
      }
    }
    if (stateCheck.kind === 'lineage') {
      const entity = stateCheck.subjectEntity;
      if (entity !== undefined) check('lineage subject', () => world.entityId(entity));
      const workspace = stateCheck.workspace;
      if (workspace !== undefined) check('lineage workspace', () => world.workspace(workspace));
    }
    if (stateCheck.kind === 'policy_versions') {
      check('verification organization', () => world.organization(stateCheck.organization));
    }
    if (stateCheck.kind === 'tool_catalog') {
      check('tool catalog actor', () => world.user(stateCheck.actor));
      check('tool catalog workspace', () => world.workspace(stateCheck.workspace));
    }
    if (stateCheck.kind === 'probe') {
      if (!stepLabels.has(stateCheck.label)) issues.push(`probe ${stateCheck.label}: no such step`);
    }
    if (stateCheck.kind === 'probe_history') {
      for (const label of [stateCheck.earlier, stateCheck.later]) {
        if (!stepLabels.has(label)) issues.push(`probe_history ${label}: no such step`);
      }
    }
    if (stateCheck.kind === 'actor_continuity') {
      check('continuity requester', () => world.user(stateCheck.requester));
      const approver = stateCheck.approver;
      if (approver !== undefined) {
        check('continuity approver', () => world.user(approver));
        if (approver === stateCheck.requester) {
          issues.push('actor_continuity: the approver must differ from the requester');
        }
      }
      const agent = stateCheck.agent;
      if (agent !== undefined) {
        check('continuity agent', () => {
          if (world.entity(agent).kind !== 'agent') throw new Error('not an agent');
        });
      }
      if ((agent !== undefined) !== (stateCheck.executionAuthority === 'agent_delegation')) {
        issues.push(
          'actor_continuity: an agent implies agent_delegation authority (and vice versa)',
        );
      }
      const reader = stateCheck.traceReader;
      if (reader !== undefined) {
        check('continuity trace reader', () => world.user(reader.user));
        check('continuity trace reader workspace', () => world.workspace(reader.workspace));
      }
      if (!expected.approval.required) {
        issues.push('actor_continuity requires an approval to be expected');
      }
    }
    if (stateCheck.kind === 'verification') {
      check('verification organization', () => world.organization(stateCheck.organization));
    }
    if (stateCheck.kind === 'expense') {
      check('verification organization', () => world.organization(stateCheck.organization));
      check('verification workspace', () => world.workspace(stateCheck.workspace));
      const submittedBy = stateCheck.submittedBy;
      if (submittedBy !== undefined) check('expense submitter', () => world.user(submittedBy));
      const decidedBy = stateCheck.decidedBy;
      if (decidedBy !== undefined) check('expense decider', () => world.user(decidedBy));
    }
    if (stateCheck.kind === 'budget_utilization') {
      check('verification budget', () => {
        if (world.entity(stateCheck.budget).kind !== 'budget') throw new Error('not a budget');
      });
    }
    if (stateCheck.kind === 'workflow_instances') {
      check('verification organization', () => world.organization(stateCheck.organization));
    }
    if (stateCheck.kind === 'expense_count') {
      check('verification organization', () => world.organization(stateCheck.organization));
      check('verification workspace', () => world.workspace(stateCheck.workspace));
    }
    if (stateCheck.kind === 'delegation_count' || stateCheck.kind === 'agent_status') {
      check('verification agent', () => world.entityId(stateCheck.agent));
    }
    if (stateCheck.kind === 'delegation_status') {
      check('verification delegation', () => world.entityId(stateCheck.delegation));
    }
    if (stateCheck.kind === 'budget_status') {
      check('verification budget', () => world.entityId(stateCheck.budget));
    }
  }
  if (
    expected.verification.outcome === 'not_applicable' &&
    expected.verification.checks.length > 0
  ) {
    issues.push('verification is not_applicable but declares checks');
  }
  if (
    expected.verification.outcome !== 'not_applicable' &&
    expected.verification.checks.length === 0
  ) {
    issues.push(`verification outcome ${expected.verification.outcome} declares no checks`);
  }
  if (
    expected.authorization.outcome === 'denied' &&
    expected.execution.outcome !== 'not_executed'
  ) {
    issues.push('a denied request cannot expect execution');
  }
  if (scenario.knownGap !== undefined && scenario.knownGap.metrics.length === 0) {
    issues.push('a known gap must name at least one metric');
  }
  return issues;
}

/** Validates a world's internal integrity. */
export function validateWorld(world: ScenarioWorld): readonly string[] {
  const issues: string[] = [];
  const index = new WorldIndex(world);
  const unique = (label: string, values: readonly string[]) => {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) issues.push(`duplicate ${label} ${value}`);
      seen.add(value);
    }
  };

  unique(
    'organization key',
    world.organizations.map((o) => o.key),
  );
  unique(
    'workspace key',
    world.workspaces.map((w) => w.key),
  );
  unique(
    'user key',
    world.users.map((u) => u.key),
  );
  unique(
    'entity key',
    world.entities.map((e) => e.key),
  );
  unique(
    'user email',
    world.users.map((u) => u.email.toLowerCase()),
  );
  unique('id', [
    ...world.organizations.map((o) => o.id),
    ...world.workspaces.map((w) => w.id),
    ...world.users.map((u) => u.id),
    ...world.entities.flatMap((e) => ('id' in e ? [e.id] : [])),
  ]);

  const attempt = (label: string, fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      issues.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  for (const org of world.organizations) {
    attempt(`auditor of ${org.key}`, () => index.user(org.auditor.user));
    attempt(`audit workspace of ${org.key}`, () => {
      const workspace = index.workspace(org.auditor.workspace);
      if (workspace.organization !== org.key) {
        throw new Error(`workspace ${workspace.key} is not in ${org.key}`);
      }
      const member = world.workspaceMemberships.some(
        (m) => m.user === org.auditor.user && m.workspace === workspace.key,
      );
      if (!member)
        throw new Error(`auditor ${org.auditor.user} is not a member of ${workspace.key}`);
    });
  }
  for (const workspace of world.workspaces) {
    attempt(`workspace ${workspace.key}`, () => index.organization(workspace.organization));
  }
  for (const membership of world.organizationMemberships) {
    attempt('organization membership', () => {
      index.user(membership.user);
      index.organization(membership.organization);
    });
  }
  for (const membership of world.workspaceMemberships) {
    attempt('workspace membership', () => {
      index.user(membership.user);
      const workspace = index.workspace(membership.workspace);
      const inOrg = world.organizationMemberships.some(
        (m) => m.user === membership.user && m.organization === workspace.organization,
      );
      if (!inOrg) {
        throw new Error(
          `${membership.user} is in workspace ${workspace.key} without an organization membership`,
        );
      }
    });
  }
  for (const entity of world.entities) {
    attempt(`entity ${entity.key}`, () => {
      if ('organization' in entity) index.organization(entity.organization);
      if ('workspace' in entity) {
        const workspace = index.workspace(entity.workspace);
        if (workspace.organization !== entity.organization) {
          throw new Error(`workspace ${workspace.key} is not in ${entity.organization}`);
        }
      }
      switch (entity.kind) {
        case 'budget':
          index.user(entity.createdBy);
          break;
        case 'expense': {
          index.user(entity.submittedBy);
          const budget = index.entity(entity.budget);
          if (budget.kind !== 'budget') throw new Error(`${entity.budget} is not a budget`);
          if (entity.decidedBy !== undefined) {
            index.user(entity.decidedBy);
            if (entity.decidedBy === entity.submittedBy) {
              throw new Error('an expense decider must differ from its submitter');
            }
          }
          if (entity.status !== 'submitted' && entity.decidedBy === undefined) {
            throw new Error(`a ${entity.status} expense needs a decider`);
          }
          break;
        }
        case 'calendar_event':
          index.user(entity.createdBy);
          break;
        case 'knowledge_article':
          index.user(entity.author);
          if (entity.indexed && entity.status !== 'published') {
            throw new Error('only published articles may be indexed');
          }
          break;
        case 'document':
          index.user(entity.uploader);
          break;
        case 'notification':
          index.user(entity.recipient);
          break;
        case 'agent':
          index.user(entity.owner);
          break;
        case 'policy':
          index.user(entity.createdBy);
          break;
        case 'delegation': {
          index.user(entity.grantedBy);
          const agent = index.entity(entity.agent);
          if (agent.kind !== 'agent') throw new Error(`${entity.agent} is not an agent`);
          if (entity.scope !== undefined) {
            const target = index.entity(entity.scope.entity);
            if (target.kind !== entity.scope.kind) {
              throw new Error(`scope ${entity.scope.entity} is not a ${entity.scope.kind}`);
            }
          }
          break;
        }
        default:
          break;
      }
    });
  }
  return issues;
}
