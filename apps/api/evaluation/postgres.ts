/**
 * @nexora/app-api — PostgreSQL seeding and reset for the scenario dataset.
 *
 * Seeding materializes every distinct scenario world through the SAME
 * {@link seedWorld} the in-memory harness uses (real aggregates → the real
 * Pg repositories), so a demo database starts from exactly the state the
 * evaluation runs against. Re-seeding is idempotent (deterministic ids,
 * upserts).
 *
 * Reset deletes ONLY what the dataset owns: rows scoped to the dataset's
 * own organizations/workspaces (deterministic `org_`/`wsp_` ids derived from
 * the dataset namespace — they can never equal a real tenant's random ids),
 * its own users, and their sessions. The table plan is derived from the
 * Drizzle schema itself ({@link planScenarioReset}); a table the plan cannot
 * classify is an ERROR, never silently skipped — a test pins this so a new
 * table can't escape reset.
 */

import { Email } from '@nexora/domain-identity';
import { OrganizationMembership } from '@nexora/domain-organizations';
import { WorkspaceMembership } from '@nexora/domain-workspaces';
import type { TenantId, UserId } from '@nexora/contracts/common';
import {
  deterministicId,
  WorldIndex,
  type ScenarioDataset,
  type ScenarioWorld,
} from '@nexora/evaluation';
import type { NexoraDatabase } from '@nexora/persistence';

import { buildPgRepositories } from '../src/app.js';
import type { ApiConfig } from '../src/config.js';
import type { RepositorySet } from '../src/container.js';
import { seedWorld, type SeedSummary } from '../src/demo/seed-world.js';
import {
  planScopedReset,
  resetScopedData,
  schemaTables,
  type ResetScope,
  type TableResetRule,
} from '../src/demo/reset.js';

export { schemaTables, type TableResetRule };

/** @see planScopedReset */
export const planScenarioReset = planScopedReset;
/** @see resetScopedData */
export const resetScenarioData = resetScopedData;

/** Every id the dataset owns, across all of its worlds. */
export type ScenarioScope = ResetScope;

/** The distinct worlds of a dataset (scenarios share the base world). */
export function distinctWorlds(dataset: ScenarioDataset): readonly ScenarioWorld[] {
  const worlds = new Map<string, ScenarioWorld>();
  for (const scenario of dataset.scenarios) worlds.set(scenario.world.id, scenario.world);
  return [...worlds.values()];
}

/** The dataset's owned ids. */
export function scenarioScope(dataset: ScenarioDataset): ScenarioScope {
  const organizations = new Set<string>();
  const workspaces = new Set<string>();
  const users = new Set<string>();
  for (const world of distinctWorlds(dataset)) {
    world.organizations.forEach((o) => organizations.add(o.id));
    world.workspaces.forEach((w) => workspaces.add(w.id));
    world.users.forEach((u) => users.add(u.id));
  }
  return {
    organizationIds: [...organizations].sort(),
    workspaceIds: [...workspaces].sort(),
    userIds: [...users].sort(),
  };
}

/** Seeds every distinct world of the dataset into PostgreSQL (idempotent). */
export async function seedScenarioDataset(
  db: NexoraDatabase,
  dataset: ScenarioDataset,
): Promise<{ repositories: RepositorySet; summaries: readonly SeedSummary[] }> {
  // Documents are indexed from their fixture text; no binary is stored, so
  // the in-memory document storage fallback (no S3 config) is correct here.
  const repositories = buildPgRepositories(db, { s3: undefined } as unknown as ApiConfig);
  const summaries: SeedSummary[] = [];
  for (const world of distinctWorlds(dataset)) {
    summaries.push(await seedWorld(repositories, world, { skipOrganizationPolicy: true }));
  }
  return { repositories, summaries };
}

/**
 * Gives an EXISTING account (e.g. the Keycloak demo user, after one login)
 * the same organization/workspace memberships as a world persona, so a human
 * can sign in and see the scenario tenant exactly as that persona does —
 * the persona's role then resolves for them through the normal membership
 * path (no role is ever assigned directly).
 */
export async function attachUserAsPersona(
  repositories: RepositorySet,
  world: ScenarioWorld,
  email: string,
  personaKey: string,
): Promise<{ userId: string; memberships: number }> {
  const index = new WorldIndex(world);
  index.user(personaKey);
  const user = await repositories.users.findByEmail(Email.create(email));
  if (user === undefined) {
    throw new Error(
      `No account for ${email}. Sign in once through the web app first (OIDC provisions the account).`,
    );
  }
  const at = world.referenceTime;
  const system = { kind: 'system' as const, id: 'scenario-seed' };
  const correlationId = `scenario-attach:${personaKey}`;
  let memberships = 0;
  for (const membership of world.organizationMemberships.filter((m) => m.user === personaKey)) {
    const organizationId = index.organization(membership.organization).id as TenantId;
    const created = OrganizationMembership.create(
      { organizationId: organizationId as never, userId: user.id as UserId, role: membership.tier },
      { actor: system, correlationId, tenantId: organizationId },
      at,
    );
    await repositories.memberships.save(
      OrganizationMembership.hydrate({
        ...OrganizationMembership.snapshot(created),
        id: deterministicId('mbr', `${world.id}/attach/${user.id}/org/${membership.organization}`),
      }),
    );
    memberships += 1;
  }
  for (const membership of world.workspaceMemberships.filter((m) => m.user === personaKey)) {
    const workspace = index.workspace(membership.workspace);
    const created = WorkspaceMembership.create(
      { workspaceId: workspace.id as never, userId: user.id as UserId, role: membership.tier },
      {
        actor: system,
        correlationId,
        organizationId: index.organization(workspace.organization).id as TenantId,
      },
      at,
    );
    await repositories.workspaceMemberships.save(
      WorkspaceMembership.hydrate({
        ...WorkspaceMembership.snapshot(created),
        id: deterministicId('mbr', `${world.id}/attach/${user.id}/ws/${membership.workspace}`),
      }),
    );
    memberships += 1;
  }
  return { userId: user.id, memberships };
}
