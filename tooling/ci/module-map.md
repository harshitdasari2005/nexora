# Module Map

Single source of truth for module ownership and boundaries (ENGINEERING_PLAYBOOK.md §3.1, ROADMAP.md §2.2).

Modules live in two top-level trees:

- **`domains/`** — business bounded contexts (16).
- **`platform/`** — platform capabilities (8).

| Module   | Location           | Bounded context / capability | Owner | Depends on (contracts) |
| -------- | ------------------ | ---------------------------- | ----- | ---------------------- |
| identity | `domains/identity` | Identity                     | TBD   | —                      |

> TODO(S1): complete this table for all 24 modules when `gen:module` is wired. The **DAG checker** reads this file to enforce dependency rules in CI (no cross-module internals, no cycles — ENGINEERING_PLAYBOOK.md §3.5).
