# tests/

Cross-module test suites (unit/integration/contract tests live with their modules — ENGINEERING_PLAYBOOK.md §7).

| Path           | Purpose                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `e2e/`         | End-to-end: flagship workflows via UI + AI + backend (PRD.md §20.4)      |
| `workflow/`    | Workflow engine failure-path tests (WRK-*, SAD.md §12)                   |
| `security/`    | Tenant-isolation, permission-boundary, AI red-team suites                |
| `performance/` | Latency-budget load tests + budgets (ENGINEERING_PLAYBOOK.md §11.1, S22) |
| `ai-eval/`     | Golden datasets + AI evaluation harness (ENGINEERING_PLAYBOOK.md §7.4)   |

## Performance (S22)

- `tests/performance/load-test.mjs` — the repeatable load harness: real
  Keycloak auth, configurable concurrency/duration/requests, p50/p95/p99 +
  throughput + error rate, machine-readable JSON output, 1% error gate and
  optional `--budget-ms` p95 gate (CI-gateable). Run with `pnpm perf:load`.
- `tests/performance/BUDGETS.md` — the S22 latency budgets (PLAYBOOK §11.1,
  PRD NFR-1/2), the measured baseline (local development measurement), and
  the bottleneck before/after measurements.

`ai-eval/` remains a scaffold placeholder.
