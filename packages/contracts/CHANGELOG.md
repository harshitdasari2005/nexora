# Changelog

All notable changes to `@nexora/contracts` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Canonical contracts package** replacing the scaffold placeholder and
  absorbing the former `@nexora/types` package (now deleted; no consumers).
- **`common`** — branded `EntityId`/`TenantId`/`WorkspaceId`/`UserId`,
  `Timestamp`, `CorrelationId`, `SemVer`, `VersionedValue`, pagination
  (`PageRequest`/`Page`), sorting, filtering, `EntityMeta`, `Maybe`.
- **`api`** — `ApiSuccess`/`ApiFailure`/`ApiResponse` envelopes,
  `ApiErrorBody`, `ApiFieldError`, `ApiPage`, `IdempotencyHeader`, `ApiAck`,
  canonical `ApiErrorCode` literal union.
- **`events`** — `EventEnvelope`, `EventActor`, `EventMetadata`,
  `EventVersion`, `EventCategory` (+ `EVENT_CATEGORIES`), `EventPriority`
  (+ `EVENT_PRIORITIES`), `EventDeliverySemantics` (+ `EVENT_DELIVERY_SEMANTICS`),
  `EventSubscription`, `EventDeliveryStatus`.
- **`commands`** — `BaseCommand`, `CommandContext`, `CommandMetadata`,
  `CommandResult`, `CommandEnvelope`, idempotency contract.
- **`queries`** — `BaseQuery`, `QueryFilters`, `QuerySorting`,
  `QueryPagination`, `QueryProjection`, `QueryResult`.
- **`messages`** — `MessageEnvelope`, `MessageChannel`, `MessageTarget`,
  `MessagePriority`, `MessageStatus`.
- **`ai`** — `AgentIdentity`, `AgentManifest`, `AgentSkill`, `AgentTool`,
  `SkillContract`, `CapabilityDeclaration`, `ToolContract`,
  `ReasoningMetadata`, `ExecutionMetadata`, `DecisionMetadata`,
  `ExplanationRecord`, `AutonomyTier`, canonical `SideEffectClass` union.
- **`workflow`** — `WorkflowDefinition`, `WorkflowStep`, `WorkflowContext`,
  `WorkflowResult`, `CompensationSpec`, `ApprovalPoint`, `WorkflowInstance`,
  step/instance status unions.
- **`plugin`** — `PluginManifest`, `PluginLifecycleState` (+
  `PLUGIN_LIFECYCLE_STATES`), `PluginDescriptor`, `PluginCapability`,
  `PluginPermissionDeclaration`, `PluginEventRegistration`,
  `PluginNavigationRegistration`, `PluginDependency`, `PluginCompatibility`,
  `MarketplaceMetadata`.
- **`approval`** — `ApprovalRequest`, `ApprovalDecision`, `ApprovalContext`,
  `ApprovalHistoryEntry`, `ApprovalStatus`.
- **`notification`** — `Notification`, `NotificationChannel`,
  `NotificationTarget`, `NotificationPriority`, `NotificationStatus`.
- **`identity`** — `Principal`, `IdentityClaims`, `SessionToken`,
  `SessionInfo`, `MfaMethod`, `Role`, `Scope`, `Permission`,
  `PermissionDecision`.
- **`registry`** — `RegistryEntry` base plus capability / agent / plugin /
  tool / workflow registry entries and `RegistryType`.
- **`versioning`** — `ContractVersion`, `CompatibilityLevel`,
  `DeprecationMetadata`, `MigrationMetadata`, `CompatibilityRule`.
- **`guards`** — runtime type guards for the literal-union contracts
  (`isEventCategory`, `isEventPriority`, `isContractVersion`, …).

### Changed

- `packages/types` merged into this package and **deleted** (it had zero
  consumers). All contract types are re-exported from their new homes.
- `EventEnvelope.metadata` is optional so the canonical envelope stays
  structurally compatible with the runtime factory in `@nexora/shared`;
  `createEventEnvelope` now populates metadata with sensible defaults so
  every emitted event honors the vocabulary contract.
- `EventVersion` wired into `VersionedEvent` (versioning module) instead of
  lying unused; `RoleDefinition` and `RoleLevel` added to identity;
  `NotificationTarget.id` documented as a plain string (the `kind` field
  discriminates).
- `@nexora/shared/events` comment updated to point at the canonical
  contract.
