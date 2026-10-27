# scripts/

Development scripts (invoked via `pnpm run` at the root or directly).

| Script                                         | Purpose                                          | Status                                            |
| ---------------------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| `dev`                                          | Start all dev tasks (turbo)                      | configured (root package.json)                    |
| `dev:local` (`scripts/dev-local.sh`)           | One-command start: infra + API + Web (see below) | configured (root package.json)                    |
| `dev:local:down` (`scripts/dev-local-down.sh`) | One-command stop: API/Web + infra (volumes kept) | configured                                        |
| `test`                                         | Run all tests (turbo)                            | configured                                        |
| `gen:module` (`scripts/gen-module.mjs`)        | Scaffold a new module skeleton                   | placeholder — Roadmap S1                          |
| `db:migrate`                                   | Database migrations                              | placeholder — Roadmap S3+ (PERSISTENCE.md §4)     |
| `eval:run` (`apps/api/evaluation/cli.ts`)      | Run the scenario evaluation → JSON report        | configured — see `packages/evaluation/README.md`  |
| `scenarios:seed` / `scenarios:reset`           | Deterministic scenario seed / reset (PostgreSQL) | configured (`apps/api/scripts/seed-scenarios.ts`) |

## `pnpm dev:local` / `pnpm dev:local:down`

The one-command local development workflow:

```bash
pnpm dev:local        # infra (compose) -> health checks -> API (:3001) + Web (:5173), logs in one terminal
pnpm dev:local:down   # stop the managed API/Web processes + `docker compose down` (volumes preserved)
```

- `dev:local` needs a repo-root `.env` (`cp .env.example .env`). MinIO is
  published on `S3_PORT` from `.env` (default `:9000`, console one above), so
  the API and MinIO always agree — change `S3_PORT` if that port is taken.
- Ctrl+C in the `dev:local` terminal stops the API/Web servers only;
  infrastructure containers keep running (restart is fast).
- Fail-safe: Docker missing, occupied ports, or an unhealthy service are
  reported with a clear message — the launcher never kills an occupying
  process (including unrelated projects).
- Ports are overridable: `NEXORA_API_PORT=3100 NEXORA_WEB_PORT=5174 pnpm dev:local`
  (sign-in through Keycloak is registered for the default ports 3001/5173 only).
- Browser auto-open is a convenience only; disable with `--no-open` or
  `NEXORA_OPEN_BROWSER=0`.

All scripts follow the conventions in ENGINEERING_PLAYBOOK.md §8. No business logic lives here.
