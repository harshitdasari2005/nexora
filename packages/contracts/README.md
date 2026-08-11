# @nexora/contracts

The canonical contract package for the Nexora platform. This is the **single
source of truth for all cross-module contracts** — every domain, platform
module, application, plugin, and AI agent depends on these types.

> **Rule:** no duplicate contract definitions anywhere else in the
> repository. If a type describes a boundary between modules, it lives here
> (ENGINEERING_PLAYBOOK.md §1.2 — contract-first).

## Principles

- **Type-only.** The package ships types and literal-union declarations.
  It has **zero runtime dependencies**, so it is safe at the root of the
  dependency graph. The one runtime surface is `@nexora/contracts/guards`
  (dependency-free type guards and envelope validation) — everything else
  is erased at compile time.
- **Runtime values stay in `@nexora/shared`.** Constant _values_ (e.g.
  `ERROR_CODES`, `SIDE_EFFECT_CLASSES`) and ID factories (`prefixedId`)
  live in `@nexora/shared`; contracts declares the canonical _type_ surface
  and documents the pairing. When both exist, they must stay in sync.
- **Subpath imports.** Consume narrow contracts via subpaths, e.g.
  `import type { EventEnvelope } from '@nexora/contracts/events';`

## Modules

| Subpath                          | Contents                                                               |
| -------------------------------- | ---------------------------------------------------------------------- |
| `@nexora/contracts/common`       | Branded IDs, timestamps, pagination, sorting, filtering                |
| `@nexora/contracts/api`          | Request/response envelopes, error body, correlation, idempotency       |
| `@nexora/contracts/events`       | Event envelope, metadata, versioning, categories, priorities, delivery |
| `@nexora/contracts/commands`     | Base command, context, metadata, result, idempotency                   |
| `@nexora/contracts/queries`      | Base query, filtering, sorting, pagination, projection                 |
| `@nexora/contracts/messages`     | Message envelope, channels, targets, status                            |
| `@nexora/contracts/ai`           | Agent/skill/capability/tool manifests, reasoning, explainability       |
| `@nexora/contracts/workflow`     | Definitions, steps, context, result, compensation, approvals           |
| `@nexora/contracts/plugin`       | Plugin manifest, lifecycle, permissions, compatibility, marketplace    |
| `@nexora/contracts/approval`     | Approval request, decision, context, history                           |
| `@nexora/contracts/notification` | Notification, channels, targets, priorities, status                    |
| `@nexora/contracts/identity`     | Principal, claims, roles, scopes, permissions                          |
| `@nexora/contracts/registry`     | Capability / agent / plugin / tool / workflow registries               |
| `@nexora/contracts/versioning`   | Contract version, compatibility, deprecation, migration                |

## Source documents

These contracts realize the normative catalogs in:

- `API_CONTRACTS.md` — API categories, error taxonomy (§10), pagination (§11)
- `PRODUCT_SPEC.md` §4 / `SAD.md` §11 — event model, EVT-* catalog
- `SAD.md` §7 / `AIR.md` §3, §5 — plugin and agent manifests
- `SAD.md` §12 / `AIR.md` §12 — workflow and approval contracts
- `PERSISTENCE.md` §13 — audit actor/event metadata
