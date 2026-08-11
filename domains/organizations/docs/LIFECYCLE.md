# Lifecycle Diagrams

State machines implemented by `@nexora/domain-organizations` (PSD.md CO-3).
Transitions are enforced by `OrganizationLifecyclePolicy` /
`OrganizationArchivalPolicy`; the terminal state `archived` stands in for PSD
`Retired` per the domain task naming.

## Organization

```mermaid
stateDiagram-v2
    [*] --> provisioning : Organization.create (OrganizationCreated)
    provisioning --> active : activate (OrganizationActivated)
    active --> suspended : suspend (OrganizationSuspended)
    active --> archived : archive (OrganizationArchived)
    suspended --> active : activate (OrganizationActivated)
    suspended --> archived : archive (OrganizationArchived)
    archived --> [*] : terminal in v1 (data & audit retained)
```

| From         | To                 | Allowed | Event emitted            |
| ------------ | ------------------ | ------- | ------------------------ |
| provisioning | active             | ✅      | `organization.activated` |
| provisioning | suspended/archived | ❌      | —                        |
| active       | suspended          | ✅      | `organization.suspended` |
| active       | archived           | ✅      | `organization.archived`  |
| active       | active             | ❌      | —                        |
| suspended    | active             | ✅      | `organization.activated` |
| suspended    | archived           | ✅      | `organization.archived`  |
| archived     | _any_              | ❌      | —                        |

## OrganizationMembership

```mermaid
stateDiagram-v2
    [*] --> active : addMember (organization.member_added)
    active --> active : changeRole (no event in v1)
    active --> [*] : removeMember (organization.member_removed, hard delete)
```

Membership gating by organization status:

| Organization status | addMember | changeRole / removeMember |
| ------------------- | --------- | ------------------------- |
| provisioning        | ❌        | ✅ (cleanup)              |
| active              | ✅        | ✅                        |
| suspended           | ❌        | ✅                        |
| archived            | ❌        | ❌                        |

Last-owner rule: an `owner` membership may be removed or demoted only when at
least one other `owner` remains (`MembershipPolicy.assertCanRemoveOwner`).
