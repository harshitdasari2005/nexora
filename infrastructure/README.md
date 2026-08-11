# infrastructure/

Deployment and local infrastructure (BKD.md §16, ROADMAP.md §3 TDR).

| Path          | Purpose                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `compose/`    | Local development infrastructure (PostgreSQL, Redis, MinIO, Keycloak) — see `compose/docker-compose.yml` |
| `iactooling/` | Infrastructure-as-Code templates (dev environment first; production per BKD.md §16.2 topology)           |

Local quick start:

```bash
cp .env.example .env   # adjust credentials
docker compose -f infrastructure/compose/docker-compose.yml up -d
```

NOTE: the application container is intentionally absent until Phase 1 (ROADMAP.md §7 Wave A). Event backbone, search, and vector planes are Phase 1–2 additions (TDR 3.7/3.8/3.9).
