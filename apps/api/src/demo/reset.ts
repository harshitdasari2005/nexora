/**
 * @nexora/app-api — scoped data reset shared by the scenario tooling and the
 * Demo World.
 *
 * Reset deletes ONLY the rows an explicit {@link ResetScope} owns (its
 * organizations, workspaces and users). The table plan is derived from the
 * Drizzle schema itself ({@link planScopedReset}); a table the plan cannot
 * classify is an ERROR, never silently skipped — a test pins this so a new
 * table can't escape reset.
 */

import { getTableColumns, getTableName, inArray, or, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@nexora/persistence/schema';
import type { NexoraDatabase } from '@nexora/persistence';

/** Every id a reset owns. */
export interface ResetScope {
  organizationIds: readonly string[];
  workspaceIds: readonly string[];
  userIds: readonly string[];
}

/** How one table is cleared. */
export interface TableResetRule {
  table: string;
  /** Scope columns (Drizzle keys) matched against the scope's ids. */
  by: readonly (
    | 'id:organization'
    | 'id:user'
    | 'tenantId'
    | 'organizationId'
    | 'workspaceId'
    | 'userId'
    | 'planId'
  )[];
}

/** All Drizzle tables in the persistence schema. */
export function schemaTables(): readonly PgTable[] {
  return Object.values(schema).filter(isPgTable);
}

/**
 * Derives the reset rule of every table from its columns. Throws when a
 * table has no column that ties it to a tenant, workspace, user, or plan.
 */
export function planScopedReset(
  tables: readonly PgTable[] = schemaTables(),
): readonly TableResetRule[] {
  const rules: TableResetRule[] = [];
  const unclassified: string[] = [];
  for (const table of tables) {
    const name = getTableName(table);
    const columns = getTableColumns(table);
    if (name === 'organizations') {
      rules.push({ table: name, by: ['id:organization'] });
      continue;
    }
    if (name === 'users') {
      rules.push({ table: name, by: ['id:user'] });
      continue;
    }
    const by: TableResetRule['by'][number][] = [];
    for (const key of ['tenantId', 'organizationId', 'workspaceId', 'userId', 'planId'] as const) {
      if (key in columns) by.push(key);
    }
    if (by.length === 0) unclassified.push(name);
    else rules.push({ table: name, by });
  }
  if (unclassified.length > 0) {
    throw new Error(
      `Scoped reset cannot scope table(s) ${unclassified.join(', ')} — add a rule in apps/api/src/demo/reset.ts`,
    );
  }
  // Plan-scoped children first (their scope resolves through the plans
  // table); delegations before agents (agent_delegations.agent_id is a FK
  // with ON DELETE RESTRICT — history is never cascaded away).
  const rank = (rule: TableResetRule) =>
    rule.table === 'agent_delegations' ? 2 : rule.by.includes('planId') ? 1 : 0;
  return rules.sort((a, b) => rank(b) - rank(a));
}

function scopeCondition(
  tx: Pick<NexoraDatabase, 'select'>,
  rule: TableResetRule,
  table: PgTable,
  scope: ResetScope,
): SQL {
  const columns = getTableColumns(table) as Record<string, Parameters<typeof inArray>[0]>;
  const conditions: SQL[] = [];
  for (const key of rule.by) {
    if (key === 'id:organization')
      conditions.push(inArray(columns['id']!, [...scope.organizationIds]));
    else if (key === 'id:user') conditions.push(inArray(columns['id']!, [...scope.userIds]));
    else if (key === 'tenantId' || key === 'organizationId') {
      conditions.push(inArray(columns[key]!, [...scope.organizationIds]));
    } else if (key === 'workspaceId')
      conditions.push(inArray(columns[key]!, [...scope.workspaceIds]));
    else if (key === 'userId') conditions.push(inArray(columns[key]!, [...scope.userIds]));
    else if (key === 'planId') {
      const plans = tx
        .select({ id: schema.remediationPlans.id })
        .from(schema.remediationPlans)
        .where(inArray(schema.remediationPlans.tenantId, [...scope.organizationIds]));
      conditions.push(inArray(columns[key]!, plans));
    }
  }
  return (conditions.length === 1 ? conditions[0] : or(...conditions)) as SQL;
}

/** Deletes every row the scope owns (one transaction). Returns rows deleted per table. */
export async function resetScopedData(
  db: NexoraDatabase,
  scope: ResetScope,
): Promise<Record<string, number>> {
  const tables = new Map(schemaTables().map((table) => [getTableName(table), table]));
  const plan = planScopedReset([...tables.values()]);
  const deleted: Record<string, number> = {};
  await db.transaction(async (tx) => {
    for (const rule of plan) {
      const table = tables.get(rule.table) as PgTable;
      const result = await tx
        .delete(table)
        .where(scopeCondition(tx, rule, table, scope))
        .returning();
      deleted[rule.table] = result.length;
    }
  });
  return deleted;
}

/** Counts the rows the scope owns, per table (only non-empty tables). Read-only. */
export async function countScopedRows(
  db: NexoraDatabase,
  scope: ResetScope,
): Promise<Record<string, number>> {
  const tables = new Map(schemaTables().map((table) => [getTableName(table), table]));
  const counts: Record<string, number> = {};
  for (const rule of planScopedReset([...tables.values()])) {
    const table = tables.get(rule.table) as PgTable;
    const rows = await db
      .select()
      .from(table)
      .where(scopeCondition(db, rule, table, scope));
    if (rows.length > 0) counts[rule.table] = rows.length;
  }
  return counts;
}

function isPgTable(value: unknown): value is PgTable {
  if (value === null || typeof value !== 'object') return false;
  try {
    getTableName(value as PgTable);
    return Object.keys(getTableColumns(value as PgTable)).length > 0;
  } catch {
    return false;
  }
}
