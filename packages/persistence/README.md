# @nexora/persistence

The PostgreSQL persistence layer of Nexora (PERSISTENCE.md). Implements the
domain repository interfaces with Drizzle ORM — the application container
wires these into the domain services.

## Contents

| Path                | Purpose                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| `src/schema/`       | Drizzle schema — one table per aggregate root, children as JSONB (§4)     |
| `src/repositories/` | `Pg*Repository` implementations of the identity/orgs/workspaces ports     |
| `src/hasher/`       | `ScryptPasswordHasher` — the Identity `PasswordHasher` port (node:crypto) |
| `src/db.ts`         | Drizzle client factory (`createDatabase`)                                 |
| `src/migrate.ts`    | Programmatic migration runner (`runMigrations`)                           |
| `drizzle/`          | Generated SQL migrations + meta                                           |

## Design

- **Aggregate ownership:** one table per aggregate root; child entities
  (profile, settings, branding, bindings, features) are JSONB documents
  written atomically with the root (PERSISTENCE.md §4).
- **Reconstitution:** aggregates are serialized with their `snapshot()`
  factory and rebuilt with `hydrate()` (DDD reconstitution factories added to
  the domain cores). Value objects re-validate on load, so corrupt rows fail.
- **Ports first:** repositories implement the interfaces from
  `@nexora/domain-identity`, `@nexora/domain-organizations`,
  `@nexora/domain-workspaces` — the domain never sees the database.

## Usage

```ts
import { createDatabase, PgUserRepository } from '@nexora/persistence';

const db = createDatabase('postgres://nexora:...@localhost:5433/nexora');
const users = new PgUserRepository(db);
```

## Migrations

```sh
# Generate a migration after schema changes
pnpm --filter @nexora/persistence db:generate
# Apply pending migrations
pnpm --filter @nexora/persistence db:migrate
# Or programmatically (used by apps/api at boot)
pnpm --filter @nexora/persistence exec tsx src/migrate.ts "$DATABASE_URL"
```

## Non-goals

- ❌ No HTTP, no application services, no business logic.
- ❌ No cross-module joins (PERSISTENCE.md §1: modules never read each
  other's stores).
