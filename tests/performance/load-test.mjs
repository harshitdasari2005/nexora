#!/usr/bin/env node
/**
 * NEXORA S22 — repeatable load-test harness (ROADMAP.md §22, PLAYBOOK §11.1).
 *
 * Measures the critical read paths (and optional write probes) against a
 * REAL stack (real API + real PostgreSQL + real Keycloak) with REAL session
 * authentication, and reports p50/p95/p99 latency, throughput, and error
 * rate in both machine-readable (JSON) and human-readable forms.
 *
 * SAFETY:
 * - Reads only, by default. Write probes are opt-in (--scenario writes) and
 *   use unique names — the harness never mutates or deletes existing data.
 * - Uses the authenticated dev user's own org/workspace; no destructive ops.
 * - Concurrency and duration are configurable; defaults model pilot scale
 *   (10 concurrent users, 60s per scenario).
 *
 * USAGE:
 *   node tests/performance/load-test.mjs [--concurrency N] [--duration S]
 *       [--requests N] [--scenarios a,b,c] [--base-url URL] [--writes]
 *
 * Exit code 0 on success; 1 if the error rate exceeds 1% or a scenario
 * fails to authenticate (so it can gate CI).
 */

import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const DEFAULT_BASE_URL = 'http://localhost:3001';
const USER = process.env.NEXORA_PERF_USER ?? 'alex';
const PASSWORD = process.env.NEXORA_PERF_PASSWORD ?? 'nexora123';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    return true; // boolean flag (or last arg)
  }
  return value;
}

const CONCURRENCY = Number(flag('concurrency', 10));
const DURATION_S = Number(flag('duration', 60));
const REQUESTS = flag('requests', null) === null ? null : Number(flag('requests', null));
const BASE_URL = flag('base-url', DEFAULT_BASE_URL);
const WITH_WRITES = flag('writes', false) === true;
// Optional p95 budget in ms: when set, every scenario's p95 must be below
// it or the run exits non-zero (CI budget gate, PLAYBOOK §11.1).
const BUDGET_MS = flag('budget-ms', null) === null ? null : Number(flag('budget-ms', null));

// The read scenarios = the critical product surfaces (measured for the p95
// interactive-read budget < 200 ms). Placeholders filled after auth.
const READ_SCENARIOS = [
  { name: 'dashboard', path: () => '/api/dashboard' },
  { name: 'workspaces', path: () => '/api/workspaces?organizationId=' },
  { name: 'projects', path: () => '/api/projects?organizationId=' },
  { name: 'employees', path: () => '/api/employees?organizationId=' },
  { name: 'documents', path: () => '/api/documents?organizationId=&workspaceId=' },
  {
    name: 'knowledge-articles',
    path: () => '/api/knowledge/articles?organizationId=&workspaceId=',
  },
  { name: 'calendar-events', path: () => '/api/calendar/events?organizationId=&workspaceId=' },
  { name: 'notifications', path: () => '/api/notifications' },
  { name: 'webhooks', path: () => '/api/integrations/webhooks?organizationId=&workspaceId=' },
  {
    name: 'email-outbox',
    path: () => '/api/integrations/email/outbox?organizationId=&workspaceId=',
  },
];

const WRITE_SCENARIOS = [
  {
    name: 'create-project',
    body: (i) => ({ organizationId: null, name: `Perf Probe ${i}` }),
  },
  {
    name: 'create-employee',
    body: (i) => ({ organizationId: null, name: `Perf Employee ${i}` }),
  },
];

// ---------------------------------------------------------------------------
// Real OIDC login (Keycloak): login -> form -> callback -> session cookie
// ---------------------------------------------------------------------------
async function login() {
  const jar = [];
  const login = await requestNoCookie(`${BASE_URL}/api/auth/login`, { method: 'GET' }, jar);
  const form = await requestNoCookie(login.location, { method: 'GET' }, jar);
  const action = (form.bodyText.match(/action="[^"]+"/) ?? [''])[0].slice(8, -1);
  const posted = await rawRequest(
    action.replaceAll('&amp;', '&'),
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `username=${encodeURIComponent(USER)}&password=${encodeURIComponent(PASSWORD)}&credentialId=`,
    },
    jar,
  );
  const callbackUrl = posted.headers.get('location') ?? undefined;
  if (callbackUrl === undefined) {
    throw new Error('Keycloak login failed: no callback redirect (bad credentials?)');
  }
  const callback = await requestNoCookie(callbackUrl, { method: 'GET' }, jar);
  if (callback.status >= 400) {
    throw new Error(`OIDC callback failed: ${callback.status} ${callback.bodyText}`);
  }
  const sessionCookie = jar.find((c) => c.name.includes('nexora_session'));
  if (sessionCookie === undefined) {
    throw new Error('No session cookie issued by the callback');
  }
  return `${sessionCookie.name}=${sessionCookie.value}`;
}

async function requestNoCookie(url, options, jar) {
  const response = await rawRequest(url, options, jar);
  const bodyText = await response.text();
  return {
    status: response.status,
    bodyText,
    location: response.headers.get('location') ?? undefined,
  };
}

async function rawRequest(url, options, jar) {
  const headers = { ...(options.headers ?? {}) };
  const cookie = jar.map((c) => `${c.name}=${c.value}`).join('; ');
  if (cookie.length > 0) {
    headers['cookie'] = cookie;
  }
  const response = await fetch(url, { ...options, headers, redirect: 'manual' });
  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const setCookie of setCookies) {
    const [pair] = setCookie.split(';');
    const [name, value] = pair.split('=');
    jar.push({ name, value });
  }
  return response;
}

async function readBody(response) {
  const text = await response.text();
  return { bodyText: text, status: response.status, headers: Object.fromEntries(response.headers) };
}

// ---------------------------------------------------------------------------
// Scenario runner (bounded concurrency, measures latency percentiles)
// ---------------------------------------------------------------------------
function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function summarize(latencies, startMs, endMs, errors, statuses) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const totalMs = endMs - startMs;
  const requests = latencies.length;
  const seconds = totalMs / 1000;
  return {
    requests,
    throughputPerSec: requests / seconds,
    p50Ms: Math.round(percentile(sorted, 50)),
    p95Ms: Math.round(percentile(sorted, 95)),
    p99Ms: Math.round(percentile(sorted, 99)),
    errorRatePct: Number(((errors / Math.max(requests, 1)) * 100).toFixed(2)),
    statuses: Object.fromEntries(
      Object.entries(statuses)
        .map(([code, count]) => [code, count])
        .sort((a, b) => b[1] - a[1]),
    ),
  };
}

async function runScenario(name, requestFactory, concurrency, requestsOrNull, session) {
  const latencies = [];
  const errors = [];
  const statuses = {};
  let nextIndex = 0;
  const deadline = requestsOrNull === null ? performance.now() + DURATION_S * 1000 : Infinity;

  async function worker() {
    while (true) {
      if (requestsOrNull === null && performance.now() >= deadline) {
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      if (requestsOrNull !== null && index >= requestsOrNull) {
        return;
      }
      const request = requestFactory(index);
      const start = performance.now();
      try {
        const response = await fetch(request.url, {
          method: request.method ?? 'GET',
          headers: { cookie: session, ...(request.headers ?? {}) },
          body: request.body,
        });
        const elapsed = performance.now() - start;
        latencies.push(elapsed);
        statuses[response.status] = (statuses[response.status] ?? 0) + 1;
        if (response.status >= 400) {
          errors.push(response.status);
        }
      } catch (error) {
        latencies.push(performance.now() - start);
        errors.push(0);
      }
    }
  }

  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const end = performance.now();
  return { name, ...summarize(latencies, start, end, errors.length, statuses) };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`NEXORA S22 load test — ${BASE_URL}`);
  console.log(
    `concurrency=${CONCURRENCY} duration=${DURATION_S}s requests=${REQUESTS ?? 'unbounded'}`,
  );
  console.log('authenticating (real Keycloak)…');
  const session = await login();
  console.log('authenticated ✓\n');

  // Resolve the perf scope (dev user's org + first workspace).
  const me = await fetch(`${BASE_URL}/api/me`, { headers: { cookie: session } });
  const meBody = await me.json();
  const organizationId = meBody.organizations?.[0]?.id;
  if (organizationId === undefined) {
    throw new Error('No organization available for the perf user');
  }
  const wsResponse = await fetch(`${BASE_URL}/api/workspaces?organizationId=${organizationId}`, {
    headers: { cookie: session },
  });
  const wsBody = await wsResponse.json();
  const workspaceId = wsBody.workspaces?.[0]?.id;
  const scope = { organizationId, workspaceId };
  console.log(`scope: org=${organizationId} ws=${workspaceId ?? '(none)'}\n`);

  const results = [];
  const scenarios = flag('scenarios', null);
  const wanted = scenarios === null ? null : new Set(String(scenarios).split(','));

  for (const scenario of READ_SCENARIOS) {
    if (wanted !== null && !wanted.has(scenario.name)) {
      continue;
    }
    const path = scenario
      .path()
      .replaceAll('organizationId=', `organizationId=${organizationId}`)
      .replaceAll('workspaceId=', `workspaceId=${workspaceId ?? ''}`);
    const result = await runScenario(
      scenario.name,
      () => ({ url: `${BASE_URL}${path}` }),
      CONCURRENCY,
      REQUESTS,
      session,
    );
    results.push(result);
    printRow(result);
  }

  if (WITH_WRITES) {
    console.log('\nwrite probes (unique names, low concurrency):');
    for (const scenario of WRITE_SCENARIOS) {
      if (wanted !== null && !wanted.has(scenario.name)) {
        continue;
      }
      const url = scenario.name === 'create-project' ? '/api/projects' : '/api/employees';
      const run = await runScenario(
        scenario.name,
        (i) => ({
          url: `${BASE_URL}${url}`,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...scenario.body(i),
            organizationId,
          }),
        }),
        Math.max(1, Math.min(CONCURRENCY, 4)),
        Math.min(REQUESTS ?? 50, 50),
        session,
      );
      results.push(run);
      printRow(run);
    }
  }

  console.log('\n=== machine-readable ===');
  console.log(
    JSON.stringify(
      { baseUrl: BASE_URL, concurrency: CONCURRENCY, durationS: DURATION_S, results },
      null,
      2,
    ),
  );

  // Gate 1: error rate <= 1% per scenario.
  const failing = results.filter((result) => result.errorRatePct > 1);
  if (failing.length > 0) {
    console.error(`\nFAIL: ${failing.map((f) => f.name).join(', ')} exceeded 1% error rate`);
    process.exit(1);
  }
  // Gate 2 (optional): p95 <= budget for every scenario (PLAYBOOK §11.1).
  if (BUDGET_MS !== null) {
    const overBudget = results.filter((result) => result.p95Ms > BUDGET_MS);
    if (overBudget.length > 0) {
      console.error(
        `\nBUDGET FAIL: ${overBudget
          .map((f) => `${f.name} p95=${f.p95Ms}ms > ${BUDGET_MS}ms`)
          .join(', ')}`,
      );
      process.exit(1);
    }
    console.log(
      `\nOK: all scenarios within the ${BUDGET_MS} ms p95 budget and 1% error-rate gate.`,
    );
    return;
  }
  console.log('\nOK: all scenarios within the 1% error-rate gate.');
}

function printRow(result) {
  const line =
    `${result.name.padEnd(20)} req=${String(result.requests).padStart(6)} ` +
    `rps=${result.throughputPerSec.toFixed(1).padStart(7)} ` +
    `p50=${String(result.p50Ms).padStart(5)}ms p95=${String(result.p95Ms).padStart(5)}ms ` +
    `p99=${String(result.p99Ms).padStart(5)}ms err=${String(result.errorRatePct).padStart(5)}%`;
  console.log(line);
}

main().catch((error) => {
  console.error(`load test failed: ${error.message}`);
  process.exit(2);
});
