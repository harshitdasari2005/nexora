# Lifecycle — Workspaces

## Workspace status lifecycle

```mermaid
stateDiagram-v2
    [*] --> provisioning : Workspace.create
    provisioning --> active : activate
    active --> suspended : suspend(reason)
    suspended --> active : activate
    active --> archived : archive(reason)
    suspended --> archived : archive(reason)
    archived --> [*] : terminal (immutable)
```

Rules enforced by `WORKSPACE_TRANSITIONS` (single authoritative table):

| From           | To                      |
| -------------- | ----------------------- |
| `provisioning` | `active`                |
| `active`       | `suspended`, `archived` |
| `suspended`    | `active`, `archived`    |
| `archived`     | — (terminal)            |

Execution eligibility: only `active` workspaces may execute workflows; a
suspended workspace is frozen; an archived workspace is immutable and
rejects every mutation.

## Membership lifecycle

```mermaid
stateDiagram-v2
    [*] --> member : addMember (workspace active)
    member --> [*] : removeMember (hard delete, not last owner)
    member --> member : changeRole (owner/admin/member)
```

## Installation lifecycle

```mermaid
stateDiagram-v2
    [*] --> installed : installPlugin (workspace active)
    installed --> [*] : removePlugin (hard delete)
```

## Event emission map

| Transition              | Event                                                           |
| ----------------------- | --------------------------------------------------------------- |
| create                  | `workspace.created`                                             |
| activate                | `workspace.activated`                                           |
| suspend                 | `workspace.suspended`                                           |
| archive                 | `workspace.archived`                                            |
| member add              | `workspace.member_added`                                        |
| member remove           | `workspace.member_removed`                                      |
| plugin install          | `workspace.plugin_installed`                                    |
| plugin remove           | `workspace.plugin_removed`                                      |
| agent bind/unbind       | `workspace.agent_bound` / `workspace.agent_unbound`             |
| knowledge attach/detach | `workspace.knowledge_attached` / `workspace.knowledge_detached` |
| workflow attach/detach  | `workspace.workflow_attached` / `workspace.workflow_detached`   |
| search provider         | `workspace.search_provider_attached`                            |
| notification provider   | `workspace.notification_provider_attached`                      |
| settings update         | `workspace.settings_updated`                                    |
| branding update         | `workspace.branding_updated`                                    |

All events ride the shared envelope with category `platform` (Tenancy =
DOM-01 Generic) and carry `actor`, `correlationId`, `organizationId`, and the
workspace id.
