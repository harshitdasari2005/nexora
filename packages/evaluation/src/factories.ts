/**
 * @nexora/evaluation — reusable, deterministic world factories.
 *
 * {@link WorldBuilder} assembles a {@link ScenarioWorld} from stable keys.
 * Ids are derived from `<namespace>/<key>` ({@link deterministicId}) using the
 * SAME prefixes the platform's own aggregates use (`org_`, `wsp_`, `usr_`,
 * `prj_`, …), so seeded rows are indistinguishable from real ones.
 *
 * A scenario extends a shared base world with its own fixtures through
 * {@link extendWorld}: the extension's ids are namespaced by the scenario id,
 * so fixtures from different scenarios can never collide — even when every
 * scenario is seeded into the same PostgreSQL database.
 */

import { deterministicId } from './ids.js';
import type {
  AgentFixture,
  BudgetFixture,
  CalendarEventFixture,
  ConnectorFixture,
  DelegationFixture,
  DocumentFixture,
  EmployeeFixture,
  EntityFixture,
  ExpenseFixture,
  KnowledgeArticleFixture,
  MeasurementFixture,
  MembershipTier,
  WorkspaceMembershipTier,
  PolicyFixture,
  NotificationFixture,
  OrganizationFixture,
  OrganizationMembershipFixture,
  ProjectFixture,
  ScenarioWorld,
  UserFixture,
  WorkspaceFixture,
  WorkspaceMembershipFixture,
} from './scenario.js';

/** Fluent, deterministic builder for a {@link ScenarioWorld}. */
export class WorldBuilder {
  readonly #id: string;
  readonly #namespace: string;
  readonly #referenceTime: string;
  readonly #organizations: OrganizationFixture[];
  readonly #workspaces: WorkspaceFixture[];
  readonly #users: UserFixture[];
  readonly #organizationMemberships: OrganizationMembershipFixture[];
  readonly #workspaceMemberships: WorkspaceMembershipFixture[];
  readonly #entities: EntityFixture[];

  /**
   * @param id            - the world id (also the id namespace of a base world).
   * @param referenceTime - the fixed ISO-8601 instant fixtures derive from.
   */
  constructor(id: string, referenceTime: string, base?: ScenarioWorld, namespace?: string) {
    this.#id = id;
    this.#namespace = namespace ?? id;
    this.#referenceTime = referenceTime;
    this.#organizations = [...(base?.organizations ?? [])];
    this.#workspaces = [...(base?.workspaces ?? [])];
    this.#users = [...(base?.users ?? [])];
    this.#organizationMemberships = [...(base?.organizationMemberships ?? [])];
    this.#workspaceMemberships = [...(base?.workspaceMemberships ?? [])];
    this.#entities = [...(base?.entities ?? [])];
  }

  /** The deterministic id of `key` under this builder's namespace. */
  idFor(prefix: string, key: string): string {
    return deterministicId(prefix, `${this.#namespace}/${key}`);
  }

  organization(key: string, input: Omit<OrganizationFixture, 'key' | 'id'>): this {
    this.#organizations.push({ key, id: this.idFor('org', key), ...input });
    return this;
  }

  workspace(key: string, input: Omit<WorkspaceFixture, 'key' | 'id'>): this {
    this.#workspaces.push({ key, id: this.idFor('wsp', key), ...input });
    return this;
  }

  user(key: string, input: Omit<UserFixture, 'key' | 'id'>): this {
    this.#users.push({ key, id: this.idFor('usr', key), ...input });
    return this;
  }

  organizationMember(user: string, organization: string, tier: MembershipTier): this {
    this.#organizationMemberships.push({ user, organization, tier });
    return this;
  }

  workspaceMember(
    user: string,
    workspace: string,
    tier: WorkspaceMembershipTier,
    expectedRole: string,
  ): this {
    this.#workspaceMemberships.push({ user, workspace, tier, expectedRole });
    return this;
  }

  project(key: string, input: Omit<ProjectFixture, 'kind' | 'key' | 'id'>): this {
    return this.#entity({ kind: 'project', key, id: this.idFor('prj', key), ...input });
  }

  employee(key: string, input: Omit<EmployeeFixture, 'kind' | 'key' | 'id'>): this {
    return this.#entity({ kind: 'employee', key, id: this.idFor('emp', key), ...input });
  }

  budget(key: string, input: Omit<BudgetFixture, 'kind' | 'key' | 'id'>): this {
    return this.#entity({ kind: 'budget', key, id: this.idFor('bud', key), ...input });
  }

  expense(key: string, input: Omit<ExpenseFixture, 'kind' | 'key' | 'id'>): this {
    return this.#entity({ kind: 'expense', key, id: this.idFor('exp', key), ...input });
  }

  calendarEvent(key: string, input: Omit<CalendarEventFixture, 'kind' | 'key' | 'id'>): this {
    return this.#entity({ kind: 'calendar_event', key, id: this.idFor('cal', key), ...input });
  }

  article(key: string, input: Omit<KnowledgeArticleFixture, 'kind' | 'key' | 'id'>): this {
    return this.#entity({ kind: 'knowledge_article', key, id: this.idFor('art', key), ...input });
  }

  document(key: string, input: Omit<DocumentFixture, 'kind' | 'key' | 'id'>): this {
    return this.#entity({ kind: 'document', key, id: this.idFor('doc', key), ...input });
  }

  notification(key: string, input: Omit<NotificationFixture, 'kind' | 'key'>): this {
    return this.#entity({ kind: 'notification', key, ...input });
  }

  measurements(key: string, input: Omit<MeasurementFixture, 'kind' | 'key'>): this {
    return this.#entity({ kind: 'measurements', key, ...input });
  }

  connector(key: string, input: Omit<ConnectorFixture, 'kind' | 'key'>): this {
    return this.#entity({ kind: 'connector', key, ...input });
  }

  agent(key: string, input: Omit<AgentFixture, 'kind' | 'key' | 'id'>): this {
    return this.#entity({ kind: 'agent', key, id: this.idFor('agt', key), ...input });
  }

  delegation(key: string, input: Omit<DelegationFixture, 'kind' | 'key' | 'id'>): this {
    return this.#entity({ kind: 'delegation', key, id: this.idFor('dlg', key), ...input });
  }

  policy(key: string, input: Omit<PolicyFixture, 'kind' | 'key'>): this {
    return this.#entity({ kind: 'policy', key, ...input });
  }

  /** Adds a pre-shaped entity (id already resolved). */
  entity(entity: EntityFixture): this {
    return this.#entity(entity);
  }

  /** Builds the immutable world. */
  build(): ScenarioWorld {
    return {
      id: this.#id,
      referenceTime: this.#referenceTime,
      organizations: [...this.#organizations],
      workspaces: [...this.#workspaces],
      users: [...this.#users],
      organizationMemberships: [...this.#organizationMemberships],
      workspaceMemberships: [...this.#workspaceMemberships],
      entities: [...this.#entities],
    };
  }

  #entity(entity: EntityFixture): this {
    this.#entities.push(entity);
    return this;
  }
}

/**
 * Extends a base world with scenario-specific fixtures. New ids are
 * namespaced by `scenarioId`, so extensions never collide across scenarios;
 * the base world's fixtures are shared verbatim.
 */
export function extendWorld(
  base: ScenarioWorld,
  scenarioId: string,
  extend: (builder: WorldBuilder) => WorldBuilder,
): ScenarioWorld {
  const builder = new WorldBuilder(
    `${base.id}+${scenarioId}`,
    base.referenceTime,
    base,
    `${base.id}/${scenarioId}`,
  );
  return extend(builder).build();
}

// ---------------------------------------------------------------------------
// World lookups (used by the runner, the seeders, and the evaluator)
// ---------------------------------------------------------------------------

/** Keyed lookups over a world; throws on an unknown key (fixture bugs fail loudly). */
export class WorldIndex {
  readonly world: ScenarioWorld;

  constructor(world: ScenarioWorld) {
    this.world = world;
  }

  organization(key: string): OrganizationFixture {
    return required(
      this.world.organizations.find((o) => o.key === key),
      `organization "${key}"`,
    );
  }

  workspace(key: string): WorkspaceFixture {
    return required(
      this.world.workspaces.find((w) => w.key === key),
      `workspace "${key}"`,
    );
  }

  user(key: string): UserFixture {
    return required(
      this.world.users.find((u) => u.key === key),
      `user "${key}"`,
    );
  }

  entity(key: string): EntityFixture {
    return required(
      this.world.entities.find((e) => e.key === key),
      `entity "${key}"`,
    );
  }

  /** The id an entity is referenced by (notifications/measurements/connectors have none). */
  entityId(key: string): string {
    const entity = this.entity(key);
    if (!('id' in entity)) {
      throw new Error(`Entity "${key}" (${entity.kind}) has no id`);
    }
    return entity.id;
  }

  /**
   * Every human-meaningful value in the world (names, titles), tagged with
   * its organization — the vocabulary the grounding checker uses to spot
   * entity mentions a response makes.
   */
  namedValues(): readonly { value: string; organization: string; key: string }[] {
    const values: { value: string; organization: string; key: string }[] = [];
    for (const org of this.world.organizations) {
      values.push({ value: org.name, organization: org.key, key: org.key });
    }
    for (const workspace of this.world.workspaces) {
      values.push({
        value: workspace.name,
        organization: workspace.organization,
        key: workspace.key,
      });
    }
    for (const entity of this.world.entities) {
      const named = entityName(entity);
      if (named !== undefined && 'organization' in entity) {
        values.push({ value: named, organization: entity.organization, key: entity.key });
      }
    }
    return values;
  }
}

/** The display name/title of a named entity. */
export function entityName(entity: EntityFixture): string | undefined {
  switch (entity.kind) {
    case 'project':
    case 'employee':
    case 'budget':
      return entity.name;
    case 'calendar_event':
    case 'knowledge_article':
    case 'document':
      return entity.title;
    default:
      return undefined;
  }
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Unknown ${label} in scenario world`);
  }
  return value;
}
