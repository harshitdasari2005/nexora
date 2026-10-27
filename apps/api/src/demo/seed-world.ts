/**
 * @nexora/app-api — scenario world seeder.
 *
 * Materializes a {@link ScenarioWorld} into a {@link RepositorySet} through
 * the REAL domain aggregates (create → snapshot → hydrate with the fixture's
 * deterministic id and the world's reference instant). The same code seeds
 * the in-memory evaluation harness and PostgreSQL (`pnpm scenarios:seed`),
 * so a demo database and an evaluation run always start from identical
 * state.
 *
 * Seeding writes state only — it publishes NO domain events. Events would
 * fan out into notifications/activity/webhooks and change the very state the
 * scenarios assert on (e.g. an unread "project created" notification would
 * trip the project-attention signal in every scenario).
 *
 * Every save is an upsert keyed by a deterministic id, so re-seeding the
 * same world is idempotent.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';
import { Document } from '@nexora/domain-documents';
import { Employee } from '@nexora/domain-hr';
import { PasswordHash, User } from '@nexora/domain-identity';
import { KnowledgeArticle, KnowledgeSource } from '@nexora/domain-knowledge';
import {
  Organization,
  OrganizationMembership,
  OrganizationSlug,
  OrganizationStatus,
  OrganizationType,
} from '@nexora/domain-organizations';
import { Project } from '@nexora/domain-projects';
import {
  Workspace,
  WorkspaceMembership,
  WorkspaceSlug,
  WorkspaceStatus,
  WorkspaceType,
} from '@nexora/domain-workspaces';
import { deterministicId, fingerprint, WorldIndex, type ScenarioWorld } from '@nexora/evaluation';
import { CalendarEntry } from '@nexora/module-calendar';
import { Budget, Expense } from '@nexora/module-finance';
import { Notification } from '@nexora/module-notifications';

import type { RepositorySet } from '../container.js';

/**
 * The home tenant of locally provisioned accounts — the SAME bootstrap
 * tenant OIDC just-in-time provisioning uses
 * (`@nexora/application-identity` PLATFORM_TENANT_ID); organization access
 * is carried by memberships, never by the user row.
 */
const PLATFORM_TENANT_ID = 'tnt_platform' as TenantId;

/** What a seed run did (and deliberately did not) write. */
export interface SeedSummary {
  worldId: string;
  counts: Record<string, number>;
  /** Fixtures intentionally not applied to this target, with the reason. */
  skipped: readonly string[];
}

/** An optional capability of an in-memory measurement repository. */
interface SeedableMeasurements {
  seed(tenantId: TenantId, snapshot: unknown): void;
}

/** Seeds a world into a repository set (idempotent). */
export async function seedWorld(
  repos: RepositorySet,
  world: ScenarioWorld,
  options: {
    skipOrganizationPolicy?: boolean;
    /**
     * The external OIDC identity (issuer + subject) to bind each seeded user to,
     * by fixture key (AUTH-009). Deterministic by construction. Absent = the
     * seeded users stay unbound (they bind at their first OIDC login).
     */
    oidcIdentity?: (userKey: string) => { issuer: string; subject: string } | undefined;
  } = {},
): Promise<SeedSummary> {
  const index = new WorldIndex(world);
  const at = world.referenceTime;
  const system = { kind: 'system' as const, id: 'scenario-seed' };
  const correlationId = `scenario-seed:${world.id}`;
  const counts: Record<string, number> = {};
  const skipped: string[] = [];
  const count = (kind: string) => {
    counts[kind] = (counts[kind] ?? 0) + 1;
  };
  const orgId = (key: string) => index.organization(key).id as TenantId;
  const wsId = (key: string) => index.workspace(key).id as never;
  const userId = (key: string) => index.user(key).id as UserId;

  for (const org of world.organizations) {
    const created = Organization.create(
      {
        slug: OrganizationSlug.create(org.slug),
        name: org.name,
        type: OrganizationType.startup(),
        status: OrganizationStatus.active(),
      },
      { actor: system, correlationId },
      at,
    );
    await repos.organizations.save(
      Organization.hydrate({ ...Organization.snapshot(created), id: org.id as never }),
    );
    count('organization');
  }

  for (const workspace of world.workspaces) {
    const organizationId = orgId(workspace.organization);
    const created = Workspace.create(
      {
        organizationId,
        slug: WorkspaceSlug.create(workspace.slug),
        name: workspace.name,
        type: WorkspaceType.from(workspace.type),
        status: WorkspaceStatus.active(),
      },
      { actor: system, correlationId, organizationId },
      at,
    );
    await repos.workspaces.save(
      Workspace.hydrate({ ...Workspace.snapshot(created), id: workspace.id as never }),
    );
    count('workspace');
  }

  for (const user of world.users) {
    await repos.users.save(
      User.hydrate({
        id: user.id as UserId,
        tenantId: PLATFORM_TENANT_ID,
        email: user.email,
        username: user.email.split('@')[0] ?? user.key,
        // Accounts authenticate through the IdP (OIDC) only — the local hash
        // is a non-verifiable marker, never a usable password.
        passwordHash: PasswordHash.create(
          'scrypt',
          `scenario-fixture:${user.key}:no-local-password`,
        ),
        status: 'active',
        ...(options.oidcIdentity?.(user.key) === undefined
          ? {}
          : {
              oidcIssuer: options.oidcIdentity(user.key)?.issuer,
              oidcSubject: options.oidcIdentity(user.key)?.subject,
            }),
        profile: {
          displayName: user.displayName,
          ...(user.title === undefined ? {} : { title: user.title }),
          updatedAt: at,
        },
        roles: [],
        createdAt: at,
        updatedAt: at,
        version: 1,
      }),
    );
    count('user');
  }

  for (const membership of world.organizationMemberships) {
    const organizationId = orgId(membership.organization);
    const created = OrganizationMembership.create(
      {
        organizationId: organizationId as never,
        userId: userId(membership.user),
        role: membership.tier,
      },
      { actor: system, correlationId, tenantId: organizationId },
      at,
    );
    await repos.memberships.save(
      OrganizationMembership.hydrate({
        ...OrganizationMembership.snapshot(created),
        // Keyed by the membership's NATURAL key (organization + user), not the
        // world: extension worlds re-declare the base memberships, and the
        // database enforces one membership per (organization, user) — so
        // every world must upsert the same row.
        id: deterministicId('mbr', `org/${organizationId}/${userId(membership.user)}`),
      }),
    );
    count('organization_membership');
  }

  for (const membership of world.workspaceMemberships) {
    const workspace = index.workspace(membership.workspace);
    const created = WorkspaceMembership.create(
      { workspaceId: wsId(workspace.key), userId: userId(membership.user), role: membership.tier },
      { actor: system, correlationId, organizationId: orgId(workspace.organization) },
      at,
    );
    await repos.workspaceMemberships.save(
      WorkspaceMembership.hydrate({
        ...WorkspaceMembership.snapshot(created),
        // Natural key (workspace + user) — see the organization membership above.
        id: deterministicId('mbr', `ws/${workspace.id}/${userId(membership.user)}`),
      }),
    );
    count('workspace_membership');
  }

  for (const entity of world.entities) {
    switch (entity.kind) {
      case 'project':
        await repos.projects.save(
          Project.hydrate({
            id: entity.id as never,
            organizationId: orgId(entity.organization),
            name: entity.name,
            ...(entity.description === undefined ? {} : { description: entity.description }),
            status: entity.status,
            createdAt: at,
            updatedAt: at,
            version: 1,
          }),
        );
        break;
      case 'employee':
        await repos.employees.save(
          Employee.hydrate({
            id: entity.id as never,
            organizationId: orgId(entity.organization),
            name: entity.name,
            status: entity.status,
            createdAt: at,
            updatedAt: at,
            version: 1,
          }),
        );
        break;
      case 'budget':
        await repos.budgets.save(
          Budget.hydrate({
            id: entity.id as never,
            organizationId: orgId(entity.organization),
            workspaceId: wsId(entity.workspace),
            createdBy: userId(entity.createdBy),
            name: entity.name,
            allocatedMinorUnits: entity.allocatedMinorUnits,
            currency: entity.currency,
            periodStart: entity.periodStart,
            periodEnd: entity.periodEnd,
            status: entity.status,
            createdAt: at,
            updatedAt: at,
            version: 1,
          }),
        );
        break;
      case 'expense':
        await repos.expenses.save(
          Expense.hydrate({
            id: entity.id as never,
            organizationId: orgId(entity.organization),
            workspaceId: wsId(entity.workspace),
            budgetId: index.entityId(entity.budget) as never,
            submittedBy: userId(entity.submittedBy),
            description: entity.description,
            amountMinorUnits: entity.amountMinorUnits,
            currency: entity.currency,
            // The fixture vocabulary says `submitted`; the domain's pending state is `pending`.
            status: entity.status === 'submitted' ? 'pending' : entity.status,
            decidedBy: entity.decidedBy === undefined ? undefined : userId(entity.decidedBy),
            decidedAt: entity.decidedBy === undefined ? undefined : at,
            createdAt: at,
            updatedAt: at,
            version: 1,
          }),
        );
        break;
      case 'calendar_event':
        await repos.calendarEvents.save(
          CalendarEntry.hydrate({
            id: entity.id as never,
            organizationId: orgId(entity.organization),
            workspaceId: wsId(entity.workspace),
            createdBy: userId(entity.createdBy),
            title: entity.title,
            startsAt: entity.startsAt,
            endsAt: entity.endsAt,
            status: 'scheduled',
            createdAt: at,
            updatedAt: at,
            version: 1,
          }),
        );
        break;
      case 'knowledge_article': {
        const tenantId = orgId(entity.organization);
        const workspaceId = wsId(entity.workspace);
        await repos.knowledgeArticles.save(
          KnowledgeArticle.hydrate({
            id: entity.id as never,
            tenantId,
            workspaceId,
            title: entity.title,
            body: entity.body,
            status: entity.status,
            contentVersion: 1,
            author: userId(entity.author),
            createdAt: at,
            updatedAt: at,
            version: 1,
          }),
        );
        if (entity.indexed) {
          // The SAME index entry shape the knowledge application service's
          // indexArticle writes (id = scope id = article id, kind `article`).
          await repos.searchIndex.put({
            id: entity.id,
            tenantId,
            workspaceId,
            scopeId: entity.id,
            kind: 'article',
            title: entity.title,
            text: entity.body,
            version: 1,
            indexedAt: at,
          });
        }
        break;
      }
      case 'document': {
        const tenantId = orgId(entity.organization);
        const workspaceId = wsId(entity.workspace);
        await repos.documents.save(
          Document.hydrate({
            id: entity.id as never,
            organizationId: tenantId,
            workspaceId,
            uploaderId: userId(entity.uploader),
            title: entity.title,
            contentType: 'text/plain',
            contentRef: `content://${entity.id}/1`,
            status: 'available',
            contentVersion: 1,
            createdAt: at,
            updatedAt: at,
            version: 1,
          }),
        );
        // Natural key: one knowledge source per document (a DB-enforced unique
        // index) — derived from the document id, never from the world.
        const sourceId = deterministicId('ksrc', `document/${entity.id}`);
        await repos.knowledgeSources.save(
          KnowledgeSource.hydrate({
            id: sourceId as never,
            tenantId,
            workspaceId,
            documentId: entity.id,
            title: entity.title,
            text: entity.text,
            version: 1,
            indexedAt: at,
          }),
        );
        await repos.searchIndex.put({
          id: sourceId,
          tenantId,
          workspaceId,
          scopeId: entity.id,
          kind: 'document',
          title: entity.title,
          text: entity.text,
          version: 1,
          indexedAt: at,
        });
        break;
      }
      case 'notification':
        await repos.notifications.save(
          Notification.hydrate({
            // Natural key = the DB idempotency key (tenant, source event, recipient).
            id: deterministicId(
              'ntf',
              `notification/${orgId(entity.organization)}/${entity.sourceEventId}/${userId(entity.recipient)}`,
            ),
            recipientId: userId(entity.recipient),
            tenantId: orgId(entity.organization),
            workspaceId: wsId(entity.workspace),
            type: entity.type,
            category: entity.category as never,
            title: entity.title,
            body: entity.body,
            priority: 'normal',
            status: 'unread',
            sourceEventId: entity.sourceEventId,
            correlationId,
            createdAt: at,
            version: 1,
          }),
        );
        break;
      case 'measurements': {
        const seedable = repos.measurements as unknown as Partial<SeedableMeasurements>;
        if (typeof seedable.seed !== 'function') {
          skipped.push(
            `measurements "${entity.key}": PostgreSQL derives workflow health from real workflow rows (no fixture table)`,
          );
          continue;
        }
        const tenantId = orgId(entity.organization);
        seedable.seed(tenantId, {
          tenantId,
          generatedAt: at,
          workflowHealth: entity.workflowHealth,
          onboarding: [],
          auditCompleteness: {
            traceableShare: 100,
            totalEvents: 0,
            tracedEvents: 0,
            untracedTypes: [],
          },
          overview: {
            users: 0,
            workspaces: 0,
            projects: 0,
            documents: 0,
            knowledgeSources: 0,
            calendarEvents: 0,
          },
        });
        break;
      }
      case 'policy': {
        if (options.skipOrganizationPolicy === true || repos.policySettings === undefined) {
          skipped.push(
            `policy "${entity.key}": not persisted (organization-level configuration would apply to every scenario sharing this tenant)`,
          );
          continue;
        }
        // Policy settings are an append-only version log; re-seeding an
        // unchanged configuration must not add a version (idempotent).
        const existing = await repos.policySettings.current(
          orgId(entity.organization),
          entity.policyId,
        );
        if (
          existing !== undefined &&
          existing.enabled !== false &&
          fingerprint(existing.config) === fingerprint(entity.config)
        ) {
          break;
        }
        await repos.policySettings.append({
          organizationId: orgId(entity.organization),
          policyId: entity.policyId,
          config: entity.config,
          createdBy: userId(entity.createdBy),
          at: new Date(at),
        });
        break;
      }
      case 'agent': {
        if (repos.agents === undefined) {
          skipped.push(`agent "${entity.key}": this repository set has no agent store`);
          continue;
        }
        await repos.agents.save({
          id: entity.id,
          organizationId: orgId(entity.organization),
          workspaceId: index.workspace(entity.workspace).id,
          definitionId: entity.definition,
          name: entity.name,
          description: `${entity.name} (scenario fixture)`,
          status: entity.status,
          ownerUserId: userId(entity.owner),
          createdBy: userId(entity.owner),
          createdAt: at,
          updatedAt: at,
        });
        break;
      }
      case 'delegation': {
        const agentFixture = index.entity(entity.agent);
        if (agentFixture.kind !== 'agent') {
          throw new Error(`delegation "${entity.key}": ${entity.agent} is not an agent`);
        }
        if (repos.agentDelegations === undefined) {
          skipped.push(`delegation "${entity.key}": this repository set has no delegation store`);
          continue;
        }
        await repos.agentDelegations.save({
          id: entity.id,
          agentId: agentFixture.id,
          organizationId: orgId(agentFixture.organization),
          workspaceId: index.workspace(agentFixture.workspace).id,
          grantedByUserId: userId(entity.grantedBy),
          capabilityId: entity.capability,
          ...(entity.scope === undefined
            ? {}
            : {
                resourceScope: {
                  kind: entity.scope.kind,
                  id: index.entityId(entity.scope.entity),
                },
              }),
          status: entity.revoked === true ? 'revoked' : 'active',
          createdAt: at,
          ...(entity.expiresAt === undefined ? {} : { expiresAt: entity.expiresAt }),
          ...(entity.revoked === true
            ? {
                revokedAt: at,
                revokedBy: userId(agentFixture.owner),
                revokeReason: 'scenario fixture',
              }
            : {}),
        });
        break;
      }
      case 'connector':
        skipped.push(
          `connector "${entity.key}": not persisted (simulated provider connections are wired by the evaluation harness)`,
        );
        continue;
    }
    count(entity.kind);
  }

  return { worldId: world.id, counts, skipped };
}
