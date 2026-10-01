/**
 * @nexora/app-api — policy administration + approval governance state checks
 * (Prompt 8, dataset 1.7.0).
 *
 * Every check reads what the REAL platform did: the recorded outcome of a
 * real HTTP call a scenario step made as a world user, the append-only
 * policy-version store, the approval store, or the tool catalogs the real
 * AI / MCP surfaces expose. Nothing here constructs an expectation or
 * fabricates state; a check that cannot observe its subject FAILS.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ObservedApproval, ObservedCheck, StateCheck } from '@nexora/evaluation';
import { fingerprintOf } from '@nexora/module-lineage';

import type { ScenarioApp } from './harness.js';

/** What an `http` / `decide` lifecycle step observed. */
export interface StepOutcome {
  status: number;
  errorCode?: string;
  /** The raw response body (asserted only through `probe` checks). */
  body: string;
}

type GovernanceCheck = Extract<
  StateCheck,
  { kind: 'probe' | 'probe_history' | 'policy_versions' | 'approval' | 'tool_catalog' }
>;

/** Evaluates one policy-administration / approval-governance check. */
export async function evaluateGovernanceCheck(
  harness: ScenarioApp,
  check: GovernanceCheck,
  outcomes: ReadonlyMap<string, StepOutcome>,
  approvals: readonly ObservedApproval[],
): Promise<ObservedCheck> {
  switch (check.kind) {
    case 'probe':
      return probe(check, outcomes, approvals);
    case 'probe_history':
      return probeHistory(check, outcomes);
    case 'policy_versions':
      return policyVersions(harness, check);
    case 'approval':
      return approvalState(harness, check, approvals);
    case 'tool_catalog':
      return toolCatalog(harness, check);
  }
}

function probe(
  check: Extract<GovernanceCheck, { kind: 'probe' }>,
  outcomes: ReadonlyMap<string, StepOutcome>,
  approvals: readonly ObservedApproval[],
): ObservedCheck {
  const outcome = outcomes.get(check.label);
  const expectedStatus = Array.isArray(check.status) ? check.status : [check.status];
  const description = `step ${check.label} answered HTTP ${expectedStatus.join('|')}${check.errorCode === undefined ? '' : ` ${check.errorCode}`}${check.bodyExcludes === undefined ? '' : ` without echoing ${check.bodyExcludes.length} value(s)`}${check.bodyIncludes === undefined ? '' : ` naming ${check.bodyIncludes.length} value(s)`}`;
  if (outcome === undefined) {
    return { description, passed: false, actual: 'the step never ran' };
  }
  // `{approval}` = the id of the approval the run opened (a value the scenario
  // observed, never a literal id in the dataset).
  const approvalId = approvals.find((approval) => approval.id !== undefined)?.id;
  const resolve = (text: string) =>
    approvalId === undefined ? text : text.replaceAll('{approval}', approvalId);
  const echoed = (check.bodyExcludes ?? []).filter((text) => outcome.body.includes(resolve(text)));
  const missing = (check.bodyIncludes ?? []).filter(
    (text) => !outcome.body.includes(resolve(text)),
  );
  const passed =
    expectedStatus.includes(outcome.status) &&
    (check.errorCode === undefined || outcome.errorCode === check.errorCode) &&
    echoed.length === 0 &&
    missing.length === 0;
  return {
    description,
    passed,
    actual: `HTTP ${outcome.status}${outcome.errorCode === undefined ? '' : ` ${outcome.errorCode}`}${echoed.length === 0 ? '' : ` (echoed ${echoed.length} value(s))`}${missing.length === 0 ? '' : ` (missing ${missing.length} value(s))`}`,
  };
}

interface HistoryBody {
  versions?: { version: number }[];
}

function history(outcome: StepOutcome | undefined): HistoryBody | undefined {
  if (outcome === undefined || outcome.status !== 200) return undefined;
  try {
    return JSON.parse(outcome.body) as HistoryBody;
  } catch {
    return undefined;
  }
}

function probeHistory(
  check: Extract<GovernanceCheck, { kind: 'probe_history' }>,
  outcomes: ReadonlyMap<string, StepOutcome>,
): ObservedCheck {
  const description = `history read ${check.later} keeps every version of ${check.earlier} byte-identical`;
  const earlier = history(outcomes.get(check.earlier))?.versions;
  const later = history(outcomes.get(check.later))?.versions;
  if (earlier === undefined || later === undefined || earlier.length === 0) {
    return { description, passed: false, actual: 'a history read failed or was empty' };
  }
  const changed = earlier.filter((version) => {
    const now = later.find((candidate) => candidate.version === version.version);
    return now === undefined || JSON.stringify(now) !== JSON.stringify(version);
  });
  return {
    description,
    passed: changed.length === 0 && later.length >= earlier.length,
    actual: `earlier=${earlier.length} later=${later.length} changed=${changed.length}`,
  };
}

async function policyVersions(
  harness: ScenarioApp,
  check: Extract<GovernanceCheck, { kind: 'policy_versions' }>,
): Promise<ObservedCheck> {
  const organizationId = harness.world.organization(check.organization).id;
  const versions = await harness.repos.policySettings!.history(organizationId, check.policyId);
  const description = `${check.organization} ${check.policyId} stored versions = ${check.equals}${check.integrity === true ? ' (consecutive, hash matches config)' : ''}`;
  let integrity = true;
  if (check.integrity === true) {
    integrity = versions.every(
      (record, index) =>
        record.version === index + 1 && record.configHash === fingerprintOf(record.config),
    );
  }
  return {
    description,
    passed: versions.length === check.equals && integrity,
    actual: `${versions.length}${integrity ? '' : ' (integrity violated)'}`,
  };
}

async function approvalState(
  harness: ScenarioApp,
  check: Extract<GovernanceCheck, { kind: 'approval' }>,
  approvals: readonly ObservedApproval[],
): Promise<ObservedCheck> {
  const id = approvals.find((approval) => approval.id !== undefined)?.id;
  const attrs = Object.entries(check)
    .filter(([key, value]) => key !== 'kind' && value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
  const description = `approval store [${attrs}]`;
  if (id === undefined) return { description, passed: false, actual: 'no approval was opened' };
  const record = await harness.approvals.byId(id);
  if (record === undefined) return { description, passed: false, actual: 'approval not found' };
  const rules = record.policy?.rules ?? [];
  const failures: string[] = [];
  if (check.status !== undefined && record.status !== check.status)
    failures.push(`status ${record.status}`);
  if (check.decided !== undefined && (record.decidedBy !== undefined) !== check.decided)
    failures.push(`decided ${record.decidedBy !== undefined}`);
  if (check.decidedBy !== undefined && record.decidedBy !== harness.world.user(check.decidedBy).id)
    failures.push('decidedBy differs');
  if (
    check.requiredApproverRoleId !== undefined &&
    record.requiredApproverRoleId !== check.requiredApproverRoleId
  )
    failures.push(`requiredApproverRoleId ${record.requiredApproverRoleId ?? 'none'}`);
  if (
    check.separationOfDuties !== undefined &&
    record.separationOfDuties !== check.separationOfDuties
  )
    failures.push(`separationOfDuties ${record.separationOfDuties}`);
  if (
    check.policyRulesInclude !== undefined &&
    !rules.some((rule) => rule.includes(check.policyRulesInclude as string))
  )
    failures.push(`rules lack ${check.policyRulesInclude}`);
  if (
    check.policyRulesExclude !== undefined &&
    rules.some((rule) => rule.includes(check.policyRulesExclude as string))
  )
    failures.push(`rules name ${check.policyRulesExclude}`);
  if (check.expired !== undefined) {
    const due = Date.parse(record.expiresAt) <= harness.approvalNow().getTime();
    if (due !== check.expired) failures.push(`expiry due=${due}`);
  }
  return {
    description,
    passed: failures.length === 0,
    actual: failures.length === 0 ? record.status : `${record.status}: ${failures.join(', ')}`,
  };
}

async function toolCatalog(
  harness: ScenarioApp,
  check: Extract<GovernanceCheck, { kind: 'tool_catalog' }>,
): Promise<ObservedCheck> {
  const world = harness.world;
  const organization = world.workspace(check.workspace).organization;
  const organizationId = world.organization(organization).id;
  const workspaceId = world.workspace(check.workspace).id;
  const description = `AI + MCP tool catalogs expose no ${check.forbiddenFragments.join('|')} tool${check.attempt === undefined ? '' : ` and refuse ${check.attempt.length} guessed tool(s)`}`;
  const ids: string[] = [];

  const agent = await harness.request(
    check.actor,
    'GET',
    `/api/agent?organizationId=${organizationId}&workspaceId=${workspaceId}`,
  );
  if (agent.statusCode !== 200) {
    return { description, passed: false, actual: `agent catalog HTTP ${agent.statusCode}` };
  }
  const capabilities = (agent.json() as { capabilities?: { id: string }[] }).capabilities ?? [];
  ids.push(...capabilities.map((capability) => capability.id));

  if (!harness.app.server.listening) await harness.app.listen({ port: 0, host: '127.0.0.1' });
  const address = harness.app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`), {
    requestInit: {
      headers: { cookie: harness.sessionCookie(check.actor), 'x-nexora-workspace': workspaceId },
    },
  });
  const client = new Client({ name: 'nexora-scenario-runner', version: '1.0.0' });
  let accepted = 0;
  try {
    await client.connect(transport);
    ids.push(...(await client.listTools()).tools.map((tool) => tool.name));
    for (const name of check.attempt ?? []) {
      try {
        const result = (await client.callTool({ name, arguments: {} })) as { isError?: boolean };
        if (result.isError !== true) accepted += 1;
      } catch {
        // A protocol-level refusal of an unknown tool is the expected outcome.
      }
    }
  } finally {
    await client.close().catch(() => undefined);
  }
  const forbidden = ids.filter((id) =>
    check.forbiddenFragments.some((prefix) => id.toLowerCase().includes(prefix.toLowerCase())),
  );
  return {
    description,
    passed: ids.length > 0 && forbidden.length === 0 && accepted === 0,
    actual: `catalog=${ids.length} forbidden=${forbidden.length} accepted=${accepted}`,
  };
}
