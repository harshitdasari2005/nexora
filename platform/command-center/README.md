# @nexora/module-command-center

The generic Command Center engine (S24 Phase 2): one reusable engine that
dynamically constructs a role-aware workspace from the Phase 1
Domain → Role → Capability catalog.

```
Authenticated User
    ↓
Organization / Workspace (trusted membership)
    ↓
Domain → Business Role (Phase 1 catalog)
    ↓
CommandCenterDefinition (widgets + actions)
    ↓
Widget data via EXISTING application services
```

## Why this module exists

Nexora must not hard-code `CEOPage.tsx` / `ManagerPage.tsx` /
`DeveloperPage.tsx`. Instead, a CommandCenterDefinition is **configuration**:
it binds one business role to a composition of widgets and actions. The same
engine renders every role, and a future domain (e.g. Legal) registers its own
command center without touching the engine.

## Concepts

| Concept                           | Contract                           | Notes                                                                     |
| --------------------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| `CommandCenterDefinition`         | `@nexora/contracts/command-center` | Binds `domainId` + `roleId` to `widgets` + `actions`                      |
| `WidgetDefinition`                | same                               | `type` (kpi/activity/attention/list) + `dataSource` reference             |
| `ActionDefinition`                | same                               | Read/navigation only in Phase 2 (`navigate`)                              |
| `CommandCenterRegistry`           | `src/registry`                     | Registration-time validation; in-memory resolution                        |
| `CommandCenterRoleResolver`       | port                               | Membership → business role; implemented in `apps/api`                     |
| `CommandCenterWidgetDataProvider` | port                               | Widget data over existing application services; implemented in `apps/api` |
| `CommandCenterApplicationService` | `src/application`                  | Composes the typed `CommandCenterDto`                                     |

## Security contract

- Command centers are **definitions only** — they grant no authorization.
- The effective business role is resolved **server-side from trusted
  membership** (the API-layer resolver), never from URL/query/body/AI/frontend
  state.
- Every widget data source keeps enforcing tenant/workspace boundaries
  through the existing application services (no second data-access layer).
- A role with no command center fails safely (`no-command-center`).

## Extending

Register a new command center for a role:

```ts
registry.register({
  id: 'legal_command_center',
  name: 'Command Center',
  domainId: 'legal',
  roleId: 'legal.general_counsel',
  widgets: [
    { id: 'contracts', type: 'list', title: 'Contracts', dataSource: 'documents.list', span: 2 },
  ],
  actions: [],
});
```

The generic engine renders it unchanged.
