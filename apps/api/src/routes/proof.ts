/**
 * @nexora/app-api — the safety checks, as last run.
 *
 *   GET /api/proof   a plain summary of the newest evaluation report
 *
 * The evaluation suite (`pnpm eval:run`) puts the assistant through a fixed
 * set of situations — being asked to cross a tenant boundary, to skip an
 * approval, to obey an instruction hidden in a document — and writes a
 * report. This route only READS the newest report and groups it into the
 * claims a person can check. It never runs anything and holds no tenant data;
 * with no report on disk it says so rather than showing numbers.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { FastifyInstance } from 'fastify';

import { requireAuth } from '../plugins/auth.js';

/** The claims the scenario categories add up to, in plain words. */
const CLAIMS: readonly { key: string; title: string; about: string; categories: string[] }[] = [
  {
    key: 'boundaries',
    title: 'It stays inside its own organization and team',
    about: 'Asked for another organization’s or another team’s data, it refuses.',
    categories: ['cross_workspace_denial', 'cross_organization_denial'],
  },
  {
    key: 'manipulation',
    title: 'It cannot be talked into breaking the rules',
    about:
      'Instructions hidden in a message, a document or a tool’s answer are treated as text, never obeyed.',
    categories: ['prompt_injection', 'malicious_tool_output', 'forged_agent_context'],
  },
  {
    key: 'approval',
    title: 'It cannot act without the right person’s approval',
    about: 'A change that needs a decision waits for it; a refusal or a policy’s “no” is final.',
    categories: [
      'approval_workflow',
      'approval_rejection',
      'approval_bypass',
      'unauthorized_mutation',
      'policy_enforcement',
      'policy_governance',
    ],
  },
  {
    key: 'delegation',
    title: 'An assistant acting for someone has only what it was given',
    about:
      'It never holds more authority than the person it works for, and loses it when it expires.',
    categories: [
      'delegation_denial',
      'delegated_execution',
      'agent_lifecycle',
      'governed_lifecycle',
    ],
  },
  {
    key: 'grounding',
    title: 'It says only what the records support',
    about:
      'Every statement in an answer is traced back to a record or a document it actually read.',
    categories: [
      'knowledge_retrieval',
      'evidence_lineage',
      'project_risk',
      'finance_budget_overrun',
      'calendar',
      'hr_operation',
      'remediation',
    ],
  },
  {
    key: 'failure',
    title: 'It fails safely and leaves a trail',
    about: 'When a step breaks it stops, says so, and what happened can be read afterwards.',
    categories: [
      'tool_failure',
      'execution_failure',
      'verification_failure',
      'runtime_observability',
    ],
  },
];

interface Report {
  dataset?: { version?: string; scenarioCount?: number };
  run?: { finishedAt?: string };
  summary?: {
    scenarios?: {
      total?: number;
      passed?: number;
      failed?: number;
      known_gap?: number;
      error?: number;
    };
    unsupportedClaimRate?: { claims?: number; unsupported?: number };
    byCategory?: Record<string, { total?: number; passed?: number }>;
  };
  gates?: { id?: string; description?: string; passed?: boolean }[];
  scenarios?: { title?: string; category?: string; status?: string }[];
}

/** What the page shows. */
export interface ProofSummary {
  ranAt: string;
  datasetVersion: string;
  total: number;
  passed: number;
  failed: number;
  claimsChecked: number;
  unsupportedClaims: number;
  gates: { description: string; passed: boolean }[];
  claims: {
    key: string;
    title: string;
    about: string;
    total: number;
    passed: number;
    examples: string[];
  }[];
}

/** Groups a raw evaluation report into the claims a person can check. */
export function summariseReport(report: Report): ProofSummary | undefined {
  const scenarios = report.summary?.scenarios;
  if (scenarios?.total === undefined || scenarios.passed === undefined) return undefined;
  const byCategory = report.summary?.byCategory ?? {};
  const grouped = new Set<string>();
  const claims = CLAIMS.map((claim) => {
    let total = 0;
    let passed = 0;
    for (const category of claim.categories) {
      grouped.add(category);
      total += byCategory[category]?.total ?? 0;
      passed += byCategory[category]?.passed ?? 0;
    }
    const examples = (report.scenarios ?? [])
      .filter(
        (scenario) =>
          scenario.category !== undefined &&
          claim.categories.includes(scenario.category) &&
          typeof scenario.title === 'string',
      )
      .slice(0, 3)
      .map((scenario) => String(scenario.title).slice(0, 160));
    return { key: claim.key, title: claim.title, about: claim.about, total, passed, examples };
  });
  // A category added to the suite later is still counted, under its own name.
  for (const [category, counts] of Object.entries(byCategory)) {
    if (grouped.has(category)) continue;
    claims.push({
      key: category,
      title: category.replace(/_/g, ' '),
      about: '',
      total: counts.total ?? 0,
      passed: counts.passed ?? 0,
      examples: [],
    });
  }
  return {
    ranAt: report.run?.finishedAt ?? '',
    datasetVersion: report.dataset?.version ?? '',
    total: scenarios.total,
    passed: scenarios.passed,
    failed: (scenarios.failed ?? 0) + (scenarios.error ?? 0),
    claimsChecked: report.summary?.unsupportedClaimRate?.claims ?? 0,
    unsupportedClaims: report.summary?.unsupportedClaimRate?.unsupported ?? 0,
    gates: (report.gates ?? []).map((gate) => ({
      description: gate.description ?? gate.id ?? '',
      passed: gate.passed === true,
    })),
    claims: claims.filter((claim) => claim.total > 0),
  };
}

/** Finds `evaluation-results/latest.json` from where the API runs, walking up. */
async function readLatestReport(): Promise<Report | undefined> {
  let directory = process.cwd();
  for (let level = 0; level < 5; level += 1) {
    try {
      const raw = await readFile(resolve(directory, 'evaluation-results', 'latest.json'), 'utf8');
      return JSON.parse(raw) as Report;
    } catch {
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return undefined;
}

/** Dependencies of the proof route. */
export interface ProofRoutesDependencies {
  /** Reads the newest evaluation report (defaults to the file the suite writes). */
  readReport?: () => Promise<Report | undefined>;
}

/** Registers the proof route. */
export function registerProofRoutes(
  app: FastifyInstance,
  dependencies: ProofRoutesDependencies = {},
): void {
  app.get('/api/proof', async (request) => {
    requireAuth(request);
    const report = await (dependencies.readReport ?? readLatestReport)();
    const summary = report === undefined ? undefined : summariseReport(report);
    return summary === undefined ? { available: false } : { available: true, summary };
  });
}
