# scripts/

Development scripts (invoked via `pnpm run` at the root or directly).

| Script                                         | Purpose                                          | Status                                                   |
| ---------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| `dev`                                          | Start all dev tasks (turbo)                      | configured (root package.json)                           |
| `dev:local` (`scripts/dev-local.sh`)           | One-command start: infra + API + Web (see below) | configured (root package.json)                           |
| `dev:local:down` (`scripts/dev-local-down.sh`) | One-command stop: API/Web + infra (volumes kept) | configured                                               |
| `test`                                         | Run all tests (turbo)                            | configured                                               |
| `gen:module` (`scripts/gen-module.mjs`)        | Scaffold a new module skeleton                   | placeholder — Roadmap S1                                 |
| `db:migrate`                                   | Database migrations                              | placeholder — Roadmap S3+ (PERSISTENCE.md §4)            |
| `eval:run`                                     | Run AI evaluation suites                         | placeholder — Roadmap S13 (ENGINEERING_PLAYBOOK.md §7.4) |

## `pnpm dev:local` / `pnpm dev:local:down`

The one-command local development workflow:

```bash
pnpm dev:local        # infra (compose) -> health checks -> API (:3001) + Web (:5173), logs in one terminal
pnpm dev:local:down   # stop the managed API/Web processes + `docker compose down` (volumes preserved)
```

- `dev:local` always uses the MinIO port override file, so host port 9000
  (owned by an unrelated process) is never touched; MinIO S3 = `:9002`,
  console = `:9003`. Set `S3_PORT=9002` in `.env` to match.
- Ctrl+C in the `dev:local` terminal stops the API/Web servers only;
  infrastructure containers keep running (restart is fast).
- Fail-safe: Docker missing, occupied ports, or an unhealthy service are
  reported with a clear message — the launcher never kills an occupying
  process (including unrelated projects).
- Ports are overridable: `NEXORA_API_PORT=3100 NEXORA_WEB_PORT=5174 pnpm dev:local`.
- Browser auto-open is a convenience only; disable with `--no-open` or
  `NEXORA_OPEN_BROWSER=0`.

All scripts follow the conventions in ENGINEERING_PLAYBOOK.md §8. No business logic lives here.
