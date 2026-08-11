# platform/

Platform capabilities — not business domains (SAD.md §5). These are the horizontal services every domain depends on. **8 modules.**

| Module          | Platform capability                                                | Reference                       | Phase |
| --------------- | ------------------------------------------------------------------ | ------------------------------- | ----- |
| `ai-runtime`    | AI Platform — EAO, planner, policy, approval, memory, AI Studio    | AIR.md §1–15                    | MVP   |
| `workflow`      | Journaled workflow engine                                          | SAD.md §12                      | MVP   |
| `event-bus`     | Event backbone (publish/subscribe, DLQ, replay, ordering)          | SAD.md §11, BKD.md §7           | MVP   |
| `policy`        | Policy evaluation (deny-wins), single authorization decision point | API_CONTRACTS.md §8, AIR.md §13 | MVP   |
| `search`        | Unified search + knowledge indexes                                 | PERSISTENCE.md §12              | MVP   |
| `configuration` | 5-level configuration hierarchy                                    | BKD.md §11                      | MVP   |
| `notifications` | Inbox, toasts, approvals, AI alerts, delivery                      | FRONTEND.md §10                 | MVP   |
| `observability` | Logs, metrics, traces, timeline surfaces, health                   | BKD.md §15, SAD.md §16          | MVP   |

**Module layout** (hexagonal, per module): `api/ application/ domain/ infrastructure/ ai/ contracts/` — see ENGINEERING_PLAYBOOK.md §3.3.

All modules are scaffold placeholders (Roadmap Wave C, ROADMAP.md §7). No business logic yet.
