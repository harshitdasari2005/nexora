/**
 * ListMyWorkspaces security tests: the membership-scoped authorization query
 * behind the AI tool. Membership is the access rule — a user sees ONLY
 * workspaces they belong to, inside the trusted tenant, and nothing else.
 */

import { describe, expect, it } from 'vitest';
import { ok } from '@nexora/shared/result';
import type { TenantId, UserId } from '@nexora/contracts/common';

import {
  WorkspaceDomainService,
  WorkspaceInstallationService,
  WorkspaceMembershipService,
} from '@nexora/domain-workspaces';

import { WorkspaceApplicationService } from '../src/services/workspace-application-service.js';
import type { WorkspaceApplicationService as WorkspaceApplicationServiceType } from '../src/services/workspace-application-service.js';
import { ListMyWorkspacesHandler } from '../src/query-handlers/list-my-workspaces.handler.js';
import type { ListMyWorkspacesQuery } from '../src/queries/list-my-workspaces.query.js';
import {
  InMemoryWorkspaceInstallationRepository,
  InMemoryWorkspaceMembershipRepository,
  InMemoryWorkspaceRepository,
  RecordingEventPublisher,
} from './helpers.js';

const ORG_A = 'org_acme' as TenantId;
const ORG_B = 'org_alien' as TenantId;
const ALICE = 'usr_alice' as UserId;
const BOB = 'usr_bob' as UserId;
const CAROL = 'usr_carol' as UserId;

interface Environment {
  handler: ListMyWorkspacesHandler;
  /** Creates a workspace in the given org (owner = actor) and returns its id. */
  createWorkspace: (organizationId: TenantId, slug: string, actorId: UserId) => Promise<string>;
  /** Adds a user to an active workspace. */
  addMember: (
    workspaceId: string,
    userId: UserId,
    role: 'owner' | 'admin' | 'member',
  ) => Promise<void>;
}

async function makeEnvironment(): Promise<Environment> {
  const workspaces = new InMemoryWorkspaceRepository();
  const memberships = new InMemoryWorkspaceMembershipRepository();
  const publisher = new RecordingEventPublisher();

  const workspacesService = new WorkspaceDomainService({ workspaces });
  const membershipsService = new WorkspaceMembershipService({ memberships, workspaces });
  const installationsService = new WorkspaceInstallationService({
    installations: new InMemoryWorkspaceInstallationRepository(),
    workspaces,
  });
  const service = new WorkspaceApplicationService({
    workspacesService,
    membershipsService,
    installationsService,
    publisher,
  });

  return {
    handler: new ListMyWorkspacesHandler(service),
    async createWorkspace(organizationId, slug, actorId) {
      const created = await service.createWorkspace({
        organizationId,
        slug,
        name: slug,
        type: 'engineering',
        actorId,
        correlationId: 'corr_seed',
      });
      if (!created.ok) {
        throw new Error('seed workspace failed');
      }
      return created.value.workspace.id;
    },
    async addMember(workspaceId, userId, role) {
      const added = await membershipsService.addMember(workspaceId as never, userId, role, {
        actor: { kind: 'user', id: userId },
        correlationId: 'corr_seed',
        organizationId: ORG_A,
      });
      if (!added.ok) {
        throw new Error('seed membership failed');
      }
    },
  };
}

describe('ListMyWorkspacesHandler (authorization)', () => {
  it('returns only the workspaces the user is a member of', async () => {
    const env = await makeEnvironment();
    // Alice owns two workspaces in ORG_A.
    await env.createWorkspace(ORG_A, 'engineering', ALICE);
    await env.createWorkspace(ORG_A, 'finance', ALICE);
    // Bob owns one (Alice is not a member).
    await env.createWorkspace(ORG_A, 'bobs-private', BOB);

    const result = await env.handler.handle({ userId: ALICE, organizationId: ORG_A });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const slugs = result.value.map((workspace) => workspace.slug).sort();
      expect(slugs).toEqual(['engineering', 'finance']);
    }
  });

  it('never returns another member-only workspace', async () => {
    const env = await makeEnvironment();
    await env.createWorkspace(ORG_A, 'engineering', ALICE);
    const bobOnly = await env.createWorkspace(ORG_A, 'bobs-private', BOB);

    const result = await env.handler.handle({ userId: ALICE, organizationId: ORG_A });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.some((workspace) => workspace.id === bobOnly)).toBe(false);
    }
  });

  it('never crosses the tenant boundary even with a foreign membership (cross-tenant isolation)', async () => {
    const env = await makeEnvironment();
    const foreign = await env.createWorkspace(ORG_B, 'alien-ws', BOB);
    // A poisoned/foreign membership exists for Alice in ORG_B's workspace.
    await env.addMember(foreign, ALICE, 'member');

    // Within ORG_A, the foreign workspace must never surface.
    const result = await env.handler.handle({ userId: ALICE, organizationId: ORG_A });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('returns a member workspace only under its own tenant', async () => {
    const env = await makeEnvironment();
    const inA = await env.createWorkspace(ORG_A, 'engineering', ALICE);
    const inB = await env.createWorkspace(ORG_B, 'alien-ws', ALICE);

    const resultA = await env.handler.handle({ userId: ALICE, organizationId: ORG_A });
    const resultB = await env.handler.handle({ userId: ALICE, organizationId: ORG_B });
    expect(resultA.ok && resultB.ok).toBe(true);
    if (resultA.ok && resultB.ok) {
      expect(resultA.value.map((workspace) => workspace.id)).toContain(inA);
      expect(resultA.value.map((workspace) => workspace.id)).not.toContain(inB);
      expect(resultB.value.map((workspace) => workspace.id)).toContain(inB);
      expect(resultB.value.map((workspace) => workspace.id)).not.toContain(inA);
    }
  });

  it('returns an empty list for a user with no memberships', async () => {
    const env = await makeEnvironment();
    await env.createWorkspace(ORG_A, 'engineering', ALICE);
    const result = await env.handler.handle({ userId: BOB, organizationId: ORG_A });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('returns an empty list for a workspace-less organization scope', async () => {
    const env = await makeEnvironment();
    await env.createWorkspace(ORG_A, 'engineering', ALICE);
    const result = await env.handler.handle({
      userId: ALICE,
      organizationId: 'org_ghost' as TenantId,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('does not depend on the caller-supplied scope: results are membership + tenant bound', async () => {
    const env = await makeEnvironment();
    await env.createWorkspace(ORG_A, 'engineering', ALICE);
    // Even if a caller demanded a foreign org, nothing of Alice's leaks out
    // of ORG_A and nothing of ORG_B leaks in.
    const result = await env.handler.handle({ userId: ALICE, organizationId: ORG_B });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('returns DTOs with stable public fields (no internal aggregate leakage)', async () => {
    const env = await makeEnvironment();
    await env.createWorkspace(ORG_A, 'engineering', ALICE);
    const result = await env.handler.handle({ userId: ALICE, organizationId: ORG_A });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const workspace = result.value[0];
      expect(workspace).toBeDefined();
      expect(Object.keys(workspace ?? {}).sort()).toEqual(
        ['createdAt', 'id', 'name', 'organizationId', 'slug', 'status', 'type'].sort(),
      );
    }
  });

  it('role never grants or hides visibility: plain members see exactly their workspaces', async () => {
    const env = await makeEnvironment();
    const ws1 = await env.createWorkspace(ORG_A, 'engineering', ALICE);
    const ws2 = await env.createWorkspace(ORG_A, 'finance', BOB);
    await env.addMember(ws1, BOB, 'member');
    await env.addMember(ws2, CAROL, 'member');

    const bob = await env.handler.handle({ userId: BOB, organizationId: ORG_A });
    const carol = await env.handler.handle({ userId: CAROL, organizationId: ORG_A });
    expect(bob.ok && carol.ok).toBe(true);
    if (bob.ok && carol.ok) {
      expect(bob.value.map((workspace) => workspace.id).sort()).toEqual([ws1, ws2].sort());
      expect(carol.value.map((workspace) => workspace.id)).toEqual([ws2]);
    }
  });

  it('membership is not transitive: sharing one workspace never reveals another', async () => {
    const env = await makeEnvironment();
    // ALICE owns `shared`, BOB is a member; BOB owns `bobs-private`, CAROL is
    // a member. Creating a workspace auto-adds the creator as owner.
    const shared = await env.createWorkspace(ORG_A, 'shared', ALICE);
    const bobsPrivate = await env.createWorkspace(ORG_A, 'bobs-private', BOB);
    await env.addMember(shared, BOB, 'member');
    await env.addMember(bobsPrivate, CAROL, 'member');

    const alice = await env.handler.handle({ userId: ALICE, organizationId: ORG_A });
    const bob = await env.handler.handle({ userId: BOB, organizationId: ORG_A });
    const carol = await env.handler.handle({ userId: CAROL, organizationId: ORG_A });
    expect(alice.ok && bob.ok && carol.ok).toBe(true);
    if (alice.ok && bob.ok && carol.ok) {
      // BOB belongs to both; ALICE and CAROL see ONLY their own workspace —
      // sharing `shared` with BOB never reveals BOB's private workspace, and
      // sharing `bobs-private` with CAROL never reveals `shared`.
      expect(bob.value.map((workspace) => workspace.id).sort()).toEqual(
        [shared, bobsPrivate].sort(),
      );
      expect(alice.value.map((workspace) => workspace.id)).toEqual([shared]);
      expect(carol.value.map((workspace) => workspace.id)).toEqual([bobsPrivate]);
    }
  });

  it('forwards the trusted query identity unchanged to the application service', async () => {
    const received: ListMyWorkspacesQuery[] = [];
    const service = {
      listMyWorkspaces: async (userId: UserId, organizationId: TenantId) => {
        received.push({ userId, organizationId });
        return ok([]);
      },
    } as unknown as WorkspaceApplicationServiceType;
    const handler = new ListMyWorkspacesHandler(service);

    await handler.handle({ userId: ALICE, organizationId: ORG_A });
    expect(received).toEqual([{ userId: ALICE, organizationId: ORG_A }]);
  });
});
