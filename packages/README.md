# packages/

Shared libraries consumed across apps, domains, platform, and plugins. See ROADMAP.md §2.1.

| Package           | Purpose                                   | Reference                                   |
| ----------------- | ----------------------------------------- | ------------------------------------------- |
| **contracts**     | API / event / manifest type contracts     | API_CONTRACTS.md, AIR.md §3/§5, PSD.md §4   |
| **design-system** | Design tokens + component primitives      | DESIGN_SYSTEM.md §3, FRONTEND.md §11        |
| **agent-sdk**     | Agent SDK — the 14-element agent contract | AIR.md §3                                   |
| **plugin-sdk**    | Plugin SDK — the plugin manifest contract | SAD.md §7                                   |
| **config**        | Shared tooling configs                    | ENGINEERING_PLAYBOOK.md §4                  |
| **evaluation**    | Scenario dataset + evaluation framework   | ENGINEERING_PLAYBOOK.md §7.4, ROADMAP §3.13 |

Contract-first rule: packages are the source of truth for types; implementations consume them (ENGINEERING_PLAYBOOK.md §1.2).
