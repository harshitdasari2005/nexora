# scripts/

Development scripts (invoked via `pnpm run` at the root or directly).

| Script                                  | Purpose                        | Status                                                   |
| --------------------------------------- | ------------------------------ | -------------------------------------------------------- |
| `dev`                                   | Start all dev tasks (turbo)    | configured (root package.json)                           |
| `test`                                  | Run all tests (turbo)          | configured                                               |
| `gen:module` (`scripts/gen-module.mjs`) | Scaffold a new module skeleton | placeholder — Roadmap S1                                 |
| `db:migrate`                            | Database migrations            | placeholder — Roadmap S3+ (PERSISTENCE.md §4)            |
| `eval:run`                              | Run AI evaluation suites       | placeholder — Roadmap S13 (ENGINEERING_PLAYBOOK.md §7.4) |

All scripts follow the conventions in ENGINEERING_PLAYBOOK.md §8. No business logic lives here.
