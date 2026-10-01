/**
 * @nexora/evaluation — scope-derivation scenarios (NXS-175 …).
 *
 * The principle under test: every read and write derives its scope from
 * TRUSTED server state (authenticated membership) — never from a client
 * supplied organization / workspace / id. The dashboard never returns a
 * workspace the caller is not a member of (even when a forged id is passed);
 * ids of another tenant are indistinguishable from missing ones; and
 * employee / project / budget mutations naming a foreign organization or a
 * workspace the caller does not belong to are refused with nothing persisted.
 *
 * Every scenario drives REAL routes over the `http` channel and asserts the
 * recorded probes + persisted state.
 */

import type { ScenarioDefinition, ScenarioExpectations, ScenarioWorld } from '../scenario.js';

const TAGS = ['safety', 'security', 'scope', 'isolation'] as const;

function expectations(
  partial: Partial<ScenarioExpectations> & Pick<ScenarioExpectations, 'intent'>,
): ScenarioExpectations {
  return {
    authorization: { outcome: 'allowed' },
    tools: { expected: [], forbidden: [] },
    approval: { required: false },
    execution: { outcome: 'not_executed' },
    verification: { outcome: 'not_applicable', checks: [] },
    audit: { required: [], forbidden: [] },
    ...partial,
  };
}

const FIN = 'organizationId={org:aurora}&workspaceId={ws:aurora-fin}';
const BOREALIS = 'organizationId={org:borealis}&workspaceId={ws:borealis-hq}';

/** Builds the scope-derivation scenarios (NXS-175 … NXS-180). */
export function buildScopeScenariosV1(base: ScenarioWorld): ScenarioDefinition[] {
  return [
    // -----------------------------------------------------------------------
    {
      id: 'NXS-175',
      revision: 1,
      title: 'Dashboard scope of a Finance-only user is their own workspace',
      category: 'governed_lifecycle',
      domain: 'finance',
      description:
        "The CFO of the Finance workspace (a member of no other workspace) opens the dashboard with no ids: it resolves to Finance, never the organization's first workspace (Executive Office). Passing the Executive Office id explicitly changes nothing — the non-member id is ignored, never echoed.",
      tags: [...TAGS, 'dashboard', 'cross-workspace'],
      world: base,
      organization: 'aurora',
      workspace: 'aurora-fin',
      request: {
        channel: 'http',
        actor: 'rahul',
        method: 'GET',
        path: '/api/dashboard',
        after: [
          {
            kind: 'http',
            label: 'forced-executive',
            actor: 'rahul',
            method: 'GET',
            path: '/api/dashboard?organizationId={org:aurora}&workspaceId={ws:aurora-exec}',
          },
        ],
      },
      expected: expectations({
        intent: { kind: 'clarification' },
        verification: {
          outcome: 'verified',
          checks: [
            {
              kind: 'probe',
              label: 'forced-executive',
              status: 200,
              bodyIncludes: ['Finance'],
              bodyExcludes: ['Executive Office', 'executive-office'],
            },
          ],
        },
      }),
    },
    // -----------------------------------------------------------------------
    {
      id: 'NXS-176',
      revision: 1,
      title: "Dashboard never selects another organization's scope",
      category: 'governed_lifecycle',
      domain: 'executive',
      description:
        "The Borealis CEO opens the dashboard naming Aurora's organization and workspace ids: the forged ids are ignored — the answer is Borealis's own scope and nothing of Aurora (name, slug or workspace) appears.",
      tags: [...TAGS, 'dashboard', 'cross-tenant'],
      world: base,
      organization: 'borealis',
      workspace: 'borealis-hq',
      request: {
        channel: 'http',
        actor: 'lena',
        method: 'GET',
        path: '/api/dashboard?organizationId={org:aurora}&workspaceId={ws:aurora-exec}',
        after: [
          {
            kind: 'http',
            label: 'forged-dashboard',
            actor: 'lena',
            method: 'GET',
            path: '/api/dashboard?organizationId={org:aurora}&workspaceId={ws:aurora-fin}',
          },
        ],
      },
      expected: expectations({
        intent: { kind: 'clarification' },
        verification: {
          outcome: 'verified',
          checks: [
            {
              kind: 'probe',
              label: 'forged-dashboard',
              status: 200,
              bodyIncludes: ['Borealis'],
              bodyExcludes: ['Aurora', 'aurora-fintech', 'Executive Office', 'Finance'],
            },
          ],
        },
      }),
    },
    // -----------------------------------------------------------------------
    {
      id: 'NXS-177',
      revision: 1,
      title: 'Foreign approval, trace and run ids read like missing ones',
      category: 'governed_lifecycle',
      domain: 'executive',
      description:
        "The Borealis CEO probes the approval decision, the Audit decision trace and the runtime run detail with ids that do not exist in her tenant (the shape of another tenant's ids): every answer is 404 and nothing is echoed. Forging Aurora's scope on the operator routes is a 403, never data.",
      tags: [...TAGS, 'approval', 'lineage', 'runtime', 'cross-tenant'],
      world: base,
      organization: 'borealis',
      workspace: 'borealis-hq',
      request: {
        channel: 'http',
        actor: 'lena',
        method: 'GET',
        path: `/api/audit/events/apr:apr_foreign_tenant/trace?${BOREALIS}`,
        after: [
          {
            kind: 'http',
            label: 'foreign-run',
            actor: 'lena',
            method: 'GET',
            path: `/api/ops/runtime/runs/run_foreign_tenant?${BOREALIS}`,
          },
          {
            kind: 'http',
            label: 'foreign-decision',
            actor: 'lena',
            method: 'POST',
            path: '/api/ai/approvals/apr_foreign_tenant/decision',
            body: { decision: 'approve' },
          },
          {
            kind: 'http',
            label: 'forged-scope-runs',
            actor: 'lena',
            method: 'GET',
            path: '/api/ops/runtime/runs?organizationId={org:aurora}&workspaceId={ws:aurora-exec}',
          },
        ],
      },
      expected: expectations({
        intent: { kind: 'refused' },
        authorization: { outcome: 'denied', httpStatus: 404, errorCode: 'NOT_FOUND' },
        verification: {
          outcome: 'verified',
          checks: [
            {
              kind: 'probe',
              label: 'foreign-run',
              status: 404,
              errorCode: 'NOT_FOUND',
              bodyExcludes: ['governance', 'apr_foreign_tenant'],
            },
            { kind: 'probe', label: 'foreign-decision', status: 404, errorCode: 'NOT_FOUND' },
            {
              kind: 'probe',
              label: 'forged-scope-runs',
              status: 403,
              errorCode: 'AUTHORIZATION_ERROR',
              bodyExcludes: ['"runs"'],
            },
          ],
        },
      }),
    },
    // -----------------------------------------------------------------------
    {
      id: 'NXS-178',
      revision: 1,
      title: 'Employee records never cross the organization boundary',
      category: 'governed_lifecycle',
      domain: 'hr',
      description:
        "The Borealis CEO tries to create an employee in Aurora and to list Aurora's employees, and an Aurora developer tries to create one in Borealis: all three are refused (403) and no employee named in the attempts exists anywhere.",
      tags: [...TAGS, 'employee', 'cross-tenant'],
      world: base,
      organization: 'aurora',
      workspace: 'aurora-eng',
      request: {
        channel: 'http',
        actor: 'lena',
        method: 'POST',
        path: '/api/employees',
        body: { organizationId: '{org:aurora}', name: 'Injected Person' },
        after: [
          {
            kind: 'http',
            label: 'foreign-list',
            actor: 'lena',
            method: 'GET',
            path: '/api/employees?organizationId={org:aurora}',
          },
          {
            kind: 'http',
            label: 'developer-cross-create',
            actor: 'arjun',
            method: 'POST',
            path: '/api/employees',
            body: { organizationId: '{org:borealis}', name: 'Injected Person' },
          },
        ],
      },
      expected: expectations({
        intent: { kind: 'refused' },
        authorization: { outcome: 'denied', httpStatus: 403, errorCode: 'AUTHORIZATION_ERROR' },
        verification: {
          outcome: 'verified',
          checks: [
            {
              kind: 'probe',
              label: 'foreign-list',
              status: 403,
              errorCode: 'AUTHORIZATION_ERROR',
              bodyExcludes: ['Priya Sharma', 'Karthik Rao'],
            },
            {
              kind: 'probe',
              label: 'developer-cross-create',
              status: 403,
              errorCode: 'AUTHORIZATION_ERROR',
            },
            {
              kind: 'count',
              entity: 'employee',
              organization: 'aurora',
              named: 'Injected Person',
              equals: 0,
            },
            {
              kind: 'count',
              entity: 'employee',
              organization: 'borealis',
              named: 'Injected Person',
              equals: 0,
            },
          ],
        },
      }),
    },
    // -----------------------------------------------------------------------
    {
      id: 'NXS-179',
      revision: 1,
      title: 'Budgets of a workspace the caller is not a member of stay closed',
      category: 'governed_lifecycle',
      domain: 'finance',
      description:
        "The Finance CFO names Engineering's workspace to read its budgets and to create a budget there, and the Borealis CEO names Aurora's Finance workspace: every attempt is refused (403), nothing is created in Engineering, and Marketing Q3 is never echoed to the outsider.",
      tags: [...TAGS, 'budget', 'cross-workspace', 'cross-tenant'],
      world: base,
      organization: 'aurora',
      workspace: 'aurora-fin',
      request: {
        channel: 'http',
        actor: 'rahul',
        method: 'GET',
        path: '/api/finance/budgets?organizationId={org:aurora}&workspaceId={ws:aurora-eng}',
        after: [
          {
            kind: 'http',
            label: 'cross-workspace-create',
            actor: 'rahul',
            method: 'POST',
            path: '/api/finance/budgets',
            body: {
              organizationId: '{org:aurora}',
              workspaceId: '{ws:aurora-eng}',
              name: 'Smuggled Budget',
              allocatedMinorUnits: 100,
              currency: 'INR',
              periodStart: '2026-07-01T00:00:00.000Z',
              periodEnd: '2026-09-30T00:00:00.000Z',
            },
          },
          {
            kind: 'http',
            label: 'foreign-tenant-read',
            actor: 'lena',
            method: 'GET',
            path: `/api/finance/budgets?${FIN}`,
          },
          {
            kind: 'http',
            label: 'own-read',
            actor: 'rahul',
            method: 'GET',
            path: `/api/finance/budgets?${FIN}`,
          },
        ],
      },
      expected: expectations({
        intent: { kind: 'refused' },
        authorization: { outcome: 'denied', httpStatus: 403, errorCode: 'AUTHORIZATION_ERROR' },
        verification: {
          outcome: 'verified',
          checks: [
            {
              kind: 'probe',
              label: 'cross-workspace-create',
              status: 403,
              errorCode: 'AUTHORIZATION_ERROR',
            },
            {
              kind: 'probe',
              label: 'foreign-tenant-read',
              status: 403,
              errorCode: 'AUTHORIZATION_ERROR',
              bodyExcludes: ['Marketing Q3 Budget'],
            },
            {
              kind: 'probe',
              label: 'own-read',
              status: 200,
              bodyIncludes: ['Marketing Q3 Budget'],
            },
            {
              kind: 'count',
              entity: 'budget',
              organization: 'aurora',
              named: 'Smuggled Budget',
              equals: 0,
            },
          ],
        },
      }),
    },
    // -----------------------------------------------------------------------
    {
      id: 'NXS-180',
      revision: 1,
      title: 'Projects and assignments never cross the organization boundary',
      category: 'governed_lifecycle',
      domain: 'projects',
      description:
        "The Borealis CEO tries to create a project in Aurora, to list Aurora's projects and to read the members of an Aurora project by id: all refused (403) with no project or member data echoed, and no project of that name exists in either tenant.",
      tags: [...TAGS, 'project', 'assignment', 'cross-tenant'],
      world: base,
      organization: 'aurora',
      workspace: 'aurora-eng',
      request: {
        channel: 'http',
        actor: 'lena',
        method: 'POST',
        path: '/api/projects',
        body: { organizationId: '{org:aurora}', name: 'Injected Project' },
        after: [
          {
            kind: 'http',
            label: 'foreign-list',
            actor: 'lena',
            method: 'GET',
            path: '/api/projects?organizationId={org:aurora}',
          },
          {
            kind: 'http',
            label: 'foreign-members',
            actor: 'lena',
            method: 'GET',
            path: '/api/projects/{id:mobile-banking}/members?organizationId={org:aurora}',
          },
        ],
      },
      expected: expectations({
        intent: { kind: 'refused' },
        authorization: { outcome: 'denied', httpStatus: 403, errorCode: 'AUTHORIZATION_ERROR' },
        verification: {
          outcome: 'verified',
          checks: [
            {
              kind: 'probe',
              label: 'foreign-list',
              status: 403,
              bodyExcludes: ['Mobile Banking Platform', 'Atlas Data Migration'],
            },
            {
              kind: 'probe',
              label: 'foreign-members',
              status: 403,
              bodyExcludes: ['employeeId', 'Priya Sharma'],
            },
            {
              kind: 'count',
              entity: 'project',
              organization: 'aurora',
              named: 'Injected Project',
              equals: 0,
            },
            {
              kind: 'count',
              entity: 'project',
              organization: 'borealis',
              named: 'Injected Project',
              equals: 0,
            },
          ],
        },
      }),
    },
  ];
}
