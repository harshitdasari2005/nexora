/**
 * ListWorkspaces query tests: the organization → workspaces read model.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId } from '@nexora/contracts/common';

import { WorkspaceDomainService, WorkspaceMembershipService } from '@nexora/domain-workspaces';

import { WorkspaceApplicationService } from '../src/services/workspace-application-service.js';
import { ListWorkspacesHandler } from '../src/query-handlers/list-workspaces.handler.js';
import {
  InMemoryWorkspaceMembershipRepository,
  InMemoryWorkspaceRepository,
  RecordingEventPublisher,
} from './helpers.js';

const ORG = 'org_acme' as TenantId;
const ACTOR = 'usr_alice' as UserId;

async function makeSeededEnvironment() {
  const workspaces = new InMemoryWorkspaceRepository();
  const memberships = new InMemoryWorkspaceMembershipRepository();
  const publisher = new RecordingEventPublisher();

  const workspacesService = new WorkspaceDomainService({ workspaces });
  const membershipsService = new WorkspaceMembershipService({ memberships, workspaces });
  const service = new WorkspaceApplicationService({
    workspacesService,
    membershipsService,
    publisher,
  });

  for (const [name, slug, type] of [
    ['Engineering', 'engineering', 'engineering'],
    ['Finance', 'finance', 'finance'],
  ] as const) {
    const created = await service.createWorkspace({
      organizationId: ORG,
      slug,
      name,
      type,
      actorId: ACTOR,
      correlationId: 'corr_seed',
    });
    if (!created.ok) {
      throw new Error('seed failed');
    }
  }
  return { handler: new ListWorkspacesHandler(service) };
}

describe('ListWorkspacesHandler', () => {
  it('lists the workspaces of an organization', async () => {
    const { handler } = await makeSeededEnvironment();
    const result = await handler.handle({ organizationId: ORG });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((workspace) => workspace.slug).sort()).toEqual([
        'engineering',
        'finance',
      ]);
    }
  });

  it('returns an empty list for an organization with no workspaces', async () => {
    const { handler } = await makeSeededEnvironment();
    const result = await handler.handle({ organizationId: 'org_ghost' as TenantId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('returns DTOs with stable public fields', async () => {
    const { handler } = await makeSeededEnvironment();
    const result = await handler.handle({ organizationId: ORG });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const workspace = result.value[0];
      if (workspace === undefined) {
        throw new Error('expected a workspace');
      }
      expect(workspace).toMatchObject({
        organizationId: ORG,
        type: expect.any(String),
        status: 'active',
      });
      expect(workspace.id).toMatch(/^wsp_/);
      expect(workspace.slug).toMatch(/^(engineering|finance)$/);
    }
  });
});
