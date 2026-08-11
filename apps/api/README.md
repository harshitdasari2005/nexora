# @nexora/app-api

The Fastify modular-monolith application container (BACKEND.md §2,
ROADMAP.md §7). Wires `@nexora/persistence` (Drizzle/PostgreSQL), the domain
cores, and the application layers into the onboarding API surface.

## Routes (v1 slice)

| Method | Route                | Auth    | Purpose                                      |
| ------ | -------------------- | ------- | -------------------------------------------- |
| GET    | `/api/health`        | public  | liveness                                     |
| GET    | `/api/auth/login`    | public  | redirect to Keycloak (OIDC)                  |
| GET    | `/api/auth/callback` | public  | code exchange → session cookie               |
| GET    | `/api/auth/logout`   | session | end session + redirect home                  |
| GET    | `/api/me`            | session | current user + organizations                 |
| POST   | `/api/organizations` | session | create + provision an organization           |
| GET    | `/api/organizations` | session | list the user's organizations                |
| POST   | `/api/workspaces`    | session | create + provision a workspace               |
| GET    | `/api/workspaces`    | session | list a member organization's workspaces      |
| GET    | `/api/dashboard`     | session | user + org + workspace + empty apps/activity |

Authentication is the OIDC authorization-code flow against Keycloak; the
browser follows redirects, the session token lives in an `HttpOnly` cookie,
and the SPA never sees tokens.

## Run locally

```bash
# 1. Infra (PostgreSQL, Redis, MinIO, Keycloak with the nexora realm import)
docker compose up -d          # or: pnpm dev:infra

# 2. API
pnpm dev:api                  # tsx watch, loads .env from the repo root
```

Migrations run automatically at boot (`DATABASE_AUTO_MIGRATE=true`); disable
with `DATABASE_AUTO_MIGRATE=false` and run `pnpm --filter @nexora/persistence
exec drizzle-kit migrate` manually.

## Environment

See `.env.example`. The critical values:

- `DATABASE_URL` — PostgreSQL connection string.
- `OIDC_ISSUER_URL` — Keycloak realm issuer (e.g. `http://localhost:8080/realms/nexora`).
- `OIDC_CLIENT_ID` / `OIDC_REDIRECT_URI` — must match the Keycloak client
  (`nexora-web` in `infrastructure/keycloak/realm-nexora.json`).
- `WEB_ORIGIN` — the SPA origin; the post-login redirect target.

## Known limitations (v1 slice)

- **Session tokens at rest.** The session token is stored in PostgreSQL as
  issued. Hashing tokens (store only a digest, look up by digest) is the
  hardening for a later milestone — see ROADMAP.md security phase.
- **Command idempotency.** The contracts define idempotency keys
  (`@nexora/contracts/commands`), but the onboarding routes do not enforce
  them yet; retried POSTs can create duplicates. Slug uniqueness returns a
  `CONFLICT` on the retry path, but a full idempotency-key store is future
  work (BKD.md §8.2).

## Testing

`pnpm --filter @nexora/app-api test` — the whole onboarding slice is tested
with `fastify.inject` and in-memory repository fakes (no Docker needed),
including an end-to-end login → organization → workspace → dashboard walk.
