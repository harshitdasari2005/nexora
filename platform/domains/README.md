# @nexora/module-domains

**The Domain → Role → Capability definition registry** (S24 Phase 1) — the
domain-agnostic, role-aware foundation of the Nexora AI business operating
system.

> The core platform is **domain agnostic**. It understands
> `DomainDefinition`, `RoleDefinition`, `CapabilityDefinition` — never
> individual departments or job titles. A future domain (e.g. Legal) is a
> registration, not a platform change.

## What it is

- **DomainDefinition** — an organizational operating domain (e.g.
  `executive`, `finance`, `technology`, `legal`) that owns roles.
- **RoleDefinition** — a business role (e.g. `technology.cto`) belonging to
  exactly one domain. Roles are **business context**, never authorization
  (ROLE ≠ PERMISSION).
- **CapabilityDefinition** — the stable, machine-readable operation
  vocabulary (e.g. `projects.read`), registered globally so roles and
  domains can reference it.

Definitions are **code/config registered** (no database tables in Phase 1):
deterministic at startup, validated at registration time, resolved from
memory (no per-request scans — S22 budgets preserved). The design leaves
room for future Marketplace-installed domains: an installed domain registers
into the same registries without changing the core.

## Security contract

- The existing authorization system (identity roles / memberships /
  `PermissionDomainService`) remains the **single authority** for access.
- Nothing in this module grants access. A role may _reference_ capabilities
  as business affinity; it never _grants_ them.
- The server, never the model or the client, resolves identity, scope, role,
  and capability. This module exposes read-only definitions only.

## Module layout

| Path           | Contents                                                                         |
| -------------- | -------------------------------------------------------------------------------- |
| `registry/`    | `DomainRegistry`, `RoleRegistry`, `CapabilityRegistry` (validated, in-memory)    |
| `validation/`  | Deterministic registration + catalog-integrity rules (S24 rules 1–8)             |
| `seed/`        | `INITIAL_DOMAINS`, `INITIAL_ROLES`, `INITIAL_CAPABILITIES` + catalog composition |
| `application/` | Read-only `DomainApplicationService` / `GetDomainCatalogHandler`                 |

## Quick start

```ts
import { createInitialCatalog, DomainApplicationService } from '@nexora/module-domains';

const catalog = createInitialCatalog(); // validates + registers the seed
const view = new DomainApplicationService(catalog).getCatalogView();
// view.domains[0].roles  → the domain's roles
// view.capabilities      → the global capability vocabulary
```

Adding a domain (e.g. Legal) requires only registrations:

```ts
const catalog = createEmptyCatalog();
catalog.capabilities.register({ id: 'contracts.read', name: 'Read Contracts' });
catalog.domains.register({ id: 'legal', name: 'Legal', roleIds: ['legal.general_counsel'] });
catalog.roles.register({
  id: 'legal.general_counsel',
  name: 'General Counsel',
  domainId: 'legal',
  capabilityIds: ['contracts.read'],
});
assertCatalogIntegrity(catalog);
```

No core registry code changes.

## Development

```bash
pnpm --filter @nexora/module-domains build
pnpm --filter @nexora/module-domains typecheck
pnpm --filter @nexora/module-domains lint
pnpm --filter @nexora/module-domains test
```
