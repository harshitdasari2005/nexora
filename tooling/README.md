# tooling/

Developer tooling and shared configs. Owned by the Platform team (ROADMAP.md §2.3).

| Path    | Purpose                                                           |
| ------- | ----------------------------------------------------------------- |
| `lint/` | Shared ESLint base configs                                        |
| `ci/`   | CI pipeline definitions and checks (mirrors `.github/workflows/`) |

Planned tools (Roadmap S1–S2, ROADMAP.md §7 Wave A/B):

- **DAG checker** — enforces module dependency boundaries (no cross-module internals, no cycles; ENGINEERING_PLAYBOOK.md §3.5).
- **Contract-test runner** — pins API/event/plugin/agent contracts (ENGINEERING_PLAYBOOK.md §7.1).
- **`gen:module`** — scaffolds a compliant module skeleton (hexagonal layout).

Mostly placeholders at scaffold time — wiring arrives with the first packages.
