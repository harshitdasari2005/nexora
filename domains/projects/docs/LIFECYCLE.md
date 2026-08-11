# Projects Domain — Lifecycle

The project lifecycle is defined by DOMAIN_MODEL.md §14.2. The transition
table below is the **single authoritative definition**; the aggregate and
every policy consult `PROJECT_TRANSITIONS`.

## State machine

```mermaid
stateDiagram-v2
    [*] --> Proposed
    Proposed --> Active: charter approved (WRK-4)
    Active --> OnHold: authorized pause
    OnHold --> Active: resume
    Active --> Completed: owner closes (EVT-9)
    Completed --> Archived: retention policy
    Proposed --> Cancelled
    Active --> Cancelled: owner + approval
```

## Transition table

| From        | To          | Trigger                     | Event               |
| ----------- | ----------- | --------------------------- | ------------------- |
| `proposed`  | `active`    | Charter approved (WRK-4)    | `project.activated` |
| `proposed`  | `cancelled` | Owner withdraws the charter | `project.cancelled` |
| `active`    | `on_hold`   | Authorized pause            | `project.on_hold`   |
| `on_hold`   | `active`    | Resume                      | `project.resumed`   |
| `active`    | `completed` | Owner closes (EVT-9)        | `project.completed` |
| `active`    | `cancelled` | Owner + approval            | `project.cancelled` |
| `completed` | `archived`  | Retention policy            | `project.archived`  |

`archived` and `cancelled` are **terminal**: no outgoing transitions.

## v1 create flow

In the vertical slice the **CreateProject** use case runs
`create (proposed) → activate (active)` in one transaction:

```mermaid
sequenceDiagram
    participant C as Caller (API or AI tool)
    participant S as ProjectApplicationService
    participant D as ProjectDomainService
    participant P as Project aggregate
    participant R as ProjectRepository
    C->>S: CreateProjectCommand{org, name, description}
    S->>S: validate (name/description)
    S->>D: create(proposed)
    D->>P: Project.create → project.created
    D->>R: save
    S->>D: activate(active)
    D->>P: activate → project.activated
    D->>R: save
    S->>P: publish(created + activated)
    S-->>C: ok{project: active, events}
```

The aggregate still exposes the full lifecycle (`hold`, `resume`, `complete`,
`archive`, `cancel`) so future workflows can transition projects without
domain changes.
