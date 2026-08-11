# domains/

Business bounded contexts (DDD). **16 modules = 16 business domains** (DOMAIN_MODEL.md §2). Each domain owns its data, rules, events, and AI agent. Platform capabilities live in `../platform`.

| Domain           | Bounded context | Agent             | Phase   |
| ---------------- | --------------- | ----------------- | ------- |
| `identity`       | Identity        | —                 | MVP     |
| `organizations`  | Organizations   | —                 | MVP     |
| `workspaces`     | Workspaces      | —                 | MVP     |
| `projects`       | Projects        | Projects Agent    | MVP     |
| `hr`             | Human Resources | HR Agent          | MVP     |
| `knowledge`      | Knowledge       | Knowledge Agent   | MVP     |
| `documents`      | Documents       | Documents Agent   | MVP     |
| `marketplace`    | Marketplace     | —                 | MVP     |
| `administration` | Administration  | —                 | MVP     |
| `crm`            | CRM             | CRM Agent         | Phase 1 |
| `finance`        | Finance         | Finance Agent     | Phase 1 |
| `inventory`      | Inventory       | Inventory Agent   | Phase 1 |
| `sales`          | Sales           | Sales Agent       | Phase 1 |
| `procurement`    | Procurement     | Procurement Agent | Phase 1 |
| `analytics`      | Analytics       | Analytics Agent   | Phase 1 |
| `calendar`       | Calendar        | Calendar Agent    | Phase 1 |

**Module layout** (hexagonal, per module): `api/ application/ domain/ infrastructure/ ai/ contracts/` — see ENGINEERING_PLAYBOOK.md §3.3.

All modules are scaffold placeholders (Roadmap Wave C, ROADMAP.md §7). No business logic yet.
