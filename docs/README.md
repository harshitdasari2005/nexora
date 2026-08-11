# docs/

The Nexora specification stack — twelve mutually consistent documents, vision to first commit.

| #   | Document                     | Role                    |
| --- | ---------------------------- | ----------------------- |
| 1   | `../PRD.md`                  | Why — product intent    |
| 2   | `../PRODUCT_SPEC.md`         | What — behavioral spec  |
| 3   | `../ARCHITECTURE.md`         | How it's architected    |
| 4   | `../DOMAIN_MODEL.md`         | Business domain model   |
| 5   | `../AI_RUNTIME.md`           | AI runtime & agents     |
| 6   | `../BACKEND.md`              | Backend blueprint       |
| 7   | `../API_CONTRACTS.md`        | Logical API contracts   |
| 8   | `../PERSISTENCE.md`          | Database & persistence  |
| 9   | `../FRONTEND.md`             | Frontend & UX blueprint |
| 10  | `../DESIGN_SYSTEM.md`        | Design language         |
| 11  | `../ENGINEERING_PLAYBOOK.md` | How engineers build it  |
| 12  | `../ROADMAP.md`              | Master execution plan   |

- `architecture/` — module guides and ADRs (new ADRs follow SAD.md §17 format).
- `engineering/` — engineering-run docs (runbooks, eval guides).

Rule: architecture docs cite normative IDs (FR-_, EVT-_, AIX-_, WRK-_, ADR-*) — no ID, no claim (ENGINEERING_PLAYBOOK.md §9.2).
