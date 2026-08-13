# Nexora Performance Budgets (S22)

S22 (ROADMAP.md §22) success criterion: **p95 budgets met under pilot
load**. The budgets below are the REPOSITORY-SPECIFIED targets
(ENGINEERING_PLAYBOOK.md §11.1, PRD NFR-1/NFR-2); the measured rows are the
S22 baseline. All measurements are **local development measurements**
(laptop, real PostgreSQL + Keycloak, dev data volumes) unless stated —
they are labeled accordingly and are not production claims.

## Budgets (source: ENGINEERING_PLAYBOOK.md §11.1, PRD NFR-1/2)

| Surface                        | p50 | p95                             | p99 | Error | Source                                       |
| ------------------------------ | --- | ------------------------------- | --- | ----- | -------------------------------------------- |
| Interactive read (API)         | —   | **< 200 ms**                    | —   | < 1%  | PLAYBOOK §11.1                               |
| Command / write (API)          | —   | **< 400 ms**                    | —   | < 1%  | PLAYBOOK §11.1                               |
| Search result window           | —   | **< 300 ms**                    | —   | < 1%  | PLAYBOOK §11.1                               |
| AI plan generation             | —   | **< 8 s**                       | —   | —     | PLAYBOOK §11.1 (streaming first token < 1 s) |
| Conversational response        | —   | **≤ 2 s** (excl. LLM streaming) | —   | —     | PRD NFR-1                                    |
| Action execution               | —   | **≤ 5 s**                       | —   | —     | PRD NFR-1                                    |
| Workflow orchestration per hop | —   | **≤ 500 ms**                    | —   | —     | PRD NFR-2                                    |

p50/p99 are reported for observability; the enforceable gate is p95 + error
rate (the gate script fails when any scenario exceeds its p95 budget or a
1% error rate).

## Measured baseline (local development measurement — 2026-08-13)

Real stack (API :3001, PostgreSQL, Keycloak), 15 concurrent users, 200
requests per scenario, dev data volumes. The API p95 read budget is
200 ms — every scenario is an order of magnitude under it.

| Scenario                | Throughput (rps) | p50   | p95   | p99   | Error |
| ----------------------- | ---------------- | ----- | ----- | ----- | ----- |
| dashboard               | 729              | 17 ms | 39 ms | 43 ms | 0%    |
| workspaces              | 1 209            | 11 ms | 19 ms | 25 ms | 0%    |
| projects                | 1 258            | 12 ms | 16 ms | 21 ms | 0%    |
| documents               | 923              | 14 ms | 34 ms | 40 ms | 0%    |
| knowledge-articles      | 1 090            | 13 ms | 17 ms | 19 ms | 0%    |
| calendar-events         | 1 236            | 12 ms | 16 ms | 19 ms | 0%    |
| notifications           | 1 357            | 11 ms | 14 ms | 16 ms | 0%    |
| webhooks                | 1 512            | 9 ms  | 15 ms | 17 ms | 0%    |
| email-outbox            | 1 320            | 11 ms | 14 ms | 17 ms | 0%    |
| create-project (write)  | 428              | 8 ms  | 19 ms | 19 ms | 0%    |
| create-employee (write) | 442              | 9 ms  | 11 ms | 11 ms | 0%    |

Write budget 400 ms: comfortably met. Search budget 300 ms: the lexical
search is served by the knowledge search path (AI-tool surface; the
underlying query is measured below).

## Bottleneck fixes (before → after, controlled-volume measurements)

The read paths were already fast at small data; the real cost was hidden in
the per-request authorization reads and the search ORDER BY at volume. Both
were fixed with database indexes (migration `0013_s22_authz_and_search_indexes`).

| Query                                                                                       | Volume    | BEFORE                         | AFTER                                   | Plan change |
| ------------------------------------------------------------------------------------------- | --------- | ------------------------------ | --------------------------------------- | ----------- |
| `workspace_memberships WHERE user_id = ?` (runs on EVERY protected request)                 | 100k rows | **4.706 ms** (Seq Scan)        | **0.077 ms** (Bitmap Index Scan)        | 61×         |
| `knowledge_sources WHERE tenant+workspace ORDER BY indexed_at DESC LIMIT 5` (search window) | 50k rows  | **8.960 ms** (Seq Scan + Sort) | **0.041 ms** (Index Scan, order served) | 218×        |
| `organization_memberships WHERE user_id = ?` (per-request org read)                         | 100k rows | Seq Scan                       | Index Scan                              | plan change |

The membership reads were **full table scans on the hottest path** — every
workspace-scoped request ran them for authorization. The user-leading
indexes (`org_membership_user_idx`, `ws_membership_user_idx`) convert them
to index scans; the search index now serves the ORDER BY directly
(`knowledge_sources_tenant_idx` extended with `indexed_at DESC`).

## How the gate runs

```bash
pnpm perf:load                                # full read suite, 15 users, 60 s
pnpm perf:load -- --concurrency 25 --duration 120   # pilot-scale override
pnpm perf:load -- --scenarios dashboard,projects    # focused run
pnpm perf:load -- --writes                     # include write probes
```

The harness asserts the 1% error-rate gate and exits non-zero on failure
(CI-gateable). Budget assertion: run scenarios with `--requests N`, compare
the reported p95 against the tables above (a `--budget-ms` flag is
available to assert a specific p95 in CI).

## Honest limitations

- All numbers are **local development measurements** on a laptop; they prove
  the shapes (plans, queries) and orders of magnitude, not production
  capacity. Production pilot numbers must be re-measured in the S23 pilot
  environment.
- AI plan latency (8 s budget) and frontend FCP/TTI budgets are NOT measured
  here — they need the model provider (Groq) and a browser harness; see
  Deferred in the S22 report.
- "Pilot scale" here = 15–25 concurrent users on dev data volumes; the
  S23 pilot-load run should re-verify at pilot tenant volumes.
