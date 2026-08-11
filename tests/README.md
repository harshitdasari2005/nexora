# tests/

Cross-module test suites (unit/integration/contract tests live with their modules — ENGINEERING_PLAYBOOK.md §7).

| Path           | Purpose                                                                |
| -------------- | ---------------------------------------------------------------------- |
| `e2e/`         | End-to-end: flagship workflows via UI + AI + backend (PRD.md §20.4)    |
| `workflow/`    | Workflow engine failure-path tests (WRK-*, SAD.md §12)                 |
| `security/`    | Tenant-isolation, permission-boundary, AI red-team suites              |
| `performance/` | Latency-budget tests (ENGINEERING_PLAYBOOK.md §11.1)                   |
| `ai-eval/`     | Golden datasets + AI evaluation harness (ENGINEERING_PLAYBOOK.md §7.4) |

All placeholders at scaffold time.
