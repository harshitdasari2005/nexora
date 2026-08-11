/**
 * Contract smoke tests: these compile-time assertions pin the shape of the
 * canonical contracts. If a contract breaks, this file fails to typecheck.
 */

import { describe, expect, it } from 'vitest';
import { prefixedId } from '@nexora/shared/ids';

import type { EntityId, TenantId, UserId } from '../src/common/index.js';
import type { ApiResponse, ApiSuccess } from '../src/api/index.js';
import type { AgentManifest } from '../src/ai/index.js';
import type { EventEnvelope, EventMetadata } from '../src/events/index.js';
import type { PluginManifest } from '../src/plugin/index.js';
import type { WorkflowDefinition } from '../src/workflow/index.js';
import type { ApprovalRequest } from '../src/approval/index.js';
import type { Principal, RoleDefinition } from '../src/identity/index.js';
import type { CapabilityRegistryEntry } from '../src/registry/index.js';

describe('canonical contracts', () => {
  it('produces branded entity ids via the shared generator', () => {
    const id: EntityId<'employee'> = prefixedId('emp') as EntityId<'employee'>;

    expect(id.startsWith('emp_')).toBe(true);
  });

  it('shapes an API response as a discriminated envelope', () => {
    const success: ApiResponse<string> = { ok: true, data: 'ok' };
    const narrowed: ApiSuccess<string> = success;

    expect(narrowed.data).toBe('ok');
  });

  it('shapes an event envelope with required audit fields and metadata', () => {
    const metadata: EventMetadata = {
      version: 1,
      category: 'hr',
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    };
    const envelope: EventEnvelope<'employee.created', { employeeId: string }> = {
      id: 'evt_1',
      type: 'employee.created',
      version: 1,
      occurredAt: '2026-08-08T00:00:00.000Z',
      tenantId: prefixedId('tenant') as TenantId,
      correlationId: 'corr_1',
      actor: { kind: 'agent', id: 'agt_hr' },
      metadata,
      payload: { employeeId: 'emp_1' },
    };

    expect(envelope.actor.kind).toBe('agent');
    expect(envelope.payload.employeeId).toBe('emp_1');
    expect(envelope.metadata?.category).toBe('hr');
  });

  it('shapes an agent manifest with skills and tools', () => {
    const manifest: AgentManifest = {
      identity: { id: 'agt_hr', name: 'hr', displayName: 'HR Agent' },
      version: '1.0.0',
      skills: [],
      tools: [],
      knowledgeScopes: ['hr.public'],
      policyIds: ['p_hr'],
      emittedEventTypes: ['employee.created'],
      subscribedEventTypes: [],
      updatedAt: '2026-08-08T00:00:00.000Z',
    };

    expect(manifest.identity.name).toBe('hr');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('shapes a plugin manifest with install contract fields', () => {
    const manifest: PluginManifest = {
      id: 'com.nexora.projects',
      name: 'Projects',
      version: '1.0.0',
      capabilities: [],
      permissions: { required: [], granted: [] },
      events: { emits: [], subscribes: [] },
      compatibility: {
        platformApiVersion: '1.0.0',
        sdkVersion: '0.1.0',
      },
    };

    expect(manifest.id).toBe('com.nexora.projects');
    expect(manifest.permissions.granted).toEqual([]);
    expect(manifest.compatibility.platformApiVersion).toBe('1.0.0');
  });

  it('shapes a workflow definition with steps and approval points', () => {
    const definition: WorkflowDefinition = {
      id: 'wfd_1',
      key: 'hr.onboarding',
      version: 1,
      startStepId: 'start',
      steps: [],
      approvalPoints: {},
      timeoutMs: 86_400_000,
      status: 'active',
    };

    expect(definition.startStepId).toBe('start');
    expect(definition.status).toBe('active');
  });

  it('shapes an approval request with timeout and delegation', () => {
    const request: ApprovalRequest = {
      id: 'apr_1',
      sourceId: 'wfi_1',
      summary: 'Approve leave for J. Doe',
      context: { employeeId: 'emp_1' },
      approverRoles: ['hr.approver'],
      status: 'pending',
      createdAt: '2026-08-08T00:00:00.000Z',
      timeoutMs: 86_400_000,
      delegatable: true,
    };

    expect(request.status).toBe('pending');
    expect(request.delegatable).toBe(true);
  });

  it('shapes a role definition with level, permissions, and approver flag', () => {
    const role: RoleDefinition = {
      name: 'workspace.admin',
      level: 'workspace',
      permissions: ['projects.create', 'projects.close_sprint'],
      approver: true,
      description: 'Full project administration',
    };

    expect(role.level).toBe('workspace');
    expect(role.approver).toBe(true);
  });

  it('shapes a principal with resolved identity and roles', () => {
    const principal: Principal = {
      userId: prefixedId('user') as UserId,
      tenantId: prefixedId('tenant') as TenantId,
      roles: ['workspace.admin'],
      mfaVerified: true,
      issuedAt: '2026-08-08T00:00:00.000Z',
    };

    expect(principal.roles).toContain('workspace.admin');
  });

  it('shapes a capability registry entry', () => {
    const entry: CapabilityRegistryEntry = {
      id: 'cap_1',
      registry: 'capability',
      version: '1.0.0',
      owner: 'com.nexora.projects',
      active: true,
      registeredAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
      capability: {
        id: 'projects.create_project',
        name: 'Create Project',
        description: 'Creates a project in the Projects app',
        skillId: 'projects.create_project_skill',
        sideEffectClass: 'state_change',
      },
    };

    expect(entry.registry).toBe('capability');
    expect(entry.capability.sideEffectClass).toBe('state_change');
  });
});
