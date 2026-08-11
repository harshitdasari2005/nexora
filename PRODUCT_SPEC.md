# Nexora — Product Specification (PSD)

**Product:** Nexora — _Work. Orchestrated by AI._
**Document Type:** Product Specification Document (PSD)
**Version:** 1.0
**Owner:** Product Architecture
**Audience:** Software Architects, Engineering Leads, Product Managers, Design, QA, Security
**Supersedes / Extends:** PRD v1.0 (this document is the software blueprint; the PRD remains the source of product intent)
**Status:** Draft for review

---

## 1. Purpose & Conventions

### 1.1 Purpose

This Product Specification translates the **Nexora PRD v1.0** into an unambiguous software blueprint. It defines **what the system must do** — product behavior, business logic, system capabilities, and software specifications — so that architecture design can begin without open product questions.

**Scope boundaries (from the PRD, enforced here):**

- This document contains **no implementation code**, no programming languages, no frameworks, no databases, and no cloud providers.
- Every statement is about **behavior and business logic**, not technology choices.

### 1.2 Relationship to the PRD

| Document                         | Role                                                                  | Authority                                                 |
| -------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| PRD v1.0                         | Product intent: vision, problems, goals, personas, metrics, roadmap   | Source of intent; final authority on _why_                |
| PSD v1.0 (this)                  | Behavioral specification: what, when, in what order, under what rules | Final authority on _what the system does_ for engineering |
| (Future) Architecture Design Doc | Technology: how it is built                                           | Out of scope for this document                            |

**Consistency rule:** the PSD shall never contradict the PRD. Where this document introduces new concepts (Workspaces, system Apps, the Event Model, AI platform components), §18 records how each maps to PRD concepts and why the addition preserves the long-term vision. All PRD requirement IDs (FR-1…FR-39, NFR-1…NFR-15, AI-1…AI-12, BW-1…BW-8) remain valid and are referenced where applicable.

### 1.3 Specification conventions

- **Normative language:** "**shall**" (mandatory), "**should**" (recommended), "**may**" (optional).
- **Stable identifiers:** every specifiable element carries a permanent ID used across design, tests, and support:
  - `PRN-*` Core product principles (§2)
  - `CO-*` Company model (§3) · `WS-*` Workspace model (§4) · `APP-*` Application model & catalog (§5–6)
  - `AIX-*` AI platform components (§7) · `EVT-*` Event model (§8)
  - `USR-*` User model (§9) · `PRM-*` Permission model (§10)
  - `WRK-*` Business workflows (§11) · `BR-*` Business rules (§12) · `EC-*` Edge cases (§13)
  - `ER-*` Error handling (§14) · `AUD-*` Auditability (§15) · `OBS-*` Observability (§16)
  - `V1-*` Version 1 scope (§17)
- **Traceability:** each section lists the PRD requirements it realizes (e.g., "Realizes: FR-9, FR-10").
- **Terms defined inline:** the first use of a capitalized domain term (e.g., _Workspace_, _Skill_, _Event Broker_) is its definition.

---

## 2. Product Overview

### 2.1 What Nexora is

Nexora is an **AI-Native Enterprise Operating System** — not a traditional ERP. Companies install **Applications** (Apps) as needed; every App owns an **AI Agent**; a central **Enterprise AI Orchestrator** coordinates multiple agents to execute business workflows. The **AI is the primary interface**: users describe outcomes in natural language, and Nexora plans, executes, verifies, and reports. Applications exist to support the AI — not the other way around. (PRD §1, §13.)

The system is **conversational-first, workflow-driven, event-driven, and governed**. Consequential actions always require human approval; every action is auditable and explainable; deterministic screens remain available as the power-user fallback (PRD FR-8).

### 2.2 The 14 Core Product Principles

These 14 principles govern every product and engineering decision. They consolidate and extend the PRD's nine philosophy principles (PRD §4); the PRD's conflict-resolution rule is preserved and restated in PRN-15.

| ID     | Principle                            | Definition (behavioral)                                                                                                                                                                                                        |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PRN-1  | **AI First**                         | The primary interface is conversational. Every capability is designed to be completable via natural language; deterministic UI is the fallback and the power layer. Every feature asks: _"Could an agent do this?"_ (PRD §4-1) |
| PRN-2  | **Human Always In Control**          | Humans authorize, pause, override, and undo. Consequential actions never execute without human approval. No autonomy tier may be granted to the AI by the AI (PRD NG-4, AI-12).                                                |
| PRN-3  | **Everything Is An App**             | All domain capability ships as installable Applications. The platform core contains no domain logic; even Notifications and Administration are Apps (system Apps).                                                             |
| PRN-4  | **Every App Owns An AI Agent**       | Each App registers exactly one primary agent owning its domain. Agents expose typed **Skills**; only agents act on app data on behalf of users.                                                                                |
| PRN-5  | **Every Action Is Auditable**        | Every user and agent action is recorded with actor, subject, timestamp, approval history, and reason (PRD FR-33, §15 of this document).                                                                                        |
| PRN-6  | **Modular By Default**               | Apps are independent, installable, and uninstallable without affecting other Apps or the platform (PRD §6-2, FR-14).                                                                                                           |
| PRN-7  | **Multi-Tenant First**               | The platform is multi-tenant by design: isolated Companies, shared infrastructure, configurable residency (PRD §6-3, NFR-9).                                                                                                   |
| PRN-8  | **Secure By Design**                 | Zero-trust, least privilege, encryption everywhere, and security decisions cannot be weakened by configuration (PRD §6-8, NFR-5/6/7).                                                                                          |
| PRN-9  | **API First**                        | Every capability is reachable through defined interfaces: conversational, deterministic UI, and public APIs (REST + webhooks). APIs are never secondary (PRD FR-38).                                                           |
| PRN-10 | **AI Must Explain Every Decision**   | Every AI-generated plan, action, refusal, and answer is explainable in human terms and traceable to sources (PRD AI-10, FR-36).                                                                                                |
| PRN-11 | **Event Driven**                     | Apps communicate only through defined interfaces and events. State changes publish events; cross-app awareness is event-driven (PRD §13.2, §8 of this document).                                                               |
| PRN-12 | **Extensible Platform**              | New Apps — internal or third-party — install without changing the platform architecture (PRD FR-16). The App Contract (§5.3) is frozen at v1.                                                                                  |
| PRN-13 | **Enterprise Grade**                 | Security, audit, compliance, SSO, RBAC, and SLAs are table stakes, never optional (PRD §6-5, NFR-3/6/7/8).                                                                                                                     |
| PRN-14 | **Configuration Over Customization** | Companies, Workspaces, and Apps differ through configuration, templates, and workflows — never code forks (PRD §8, §15).                                                                                                       |
| PRN-15 | **Decision rule**                    | When principles conflict, resolve: **Secure → Enterprise Grade → Trust (Explainability/Audit) → Human Control → AI First → Modular → Scalable → Workflow Driven → Extensible → Conversational** (extends PRD §4).              |

### 2.3 Non-negotiables (v1 hard constraints)

These cannot be relaxed by tenant configuration, AI behavior, or app behavior:

1. Consequential actions (money movement, people changes, contracts, data deletion, external commitments) **require human approval** (PRD AI-12).
2. An agent **never exceeds the authority of its invoking user**, further constrained by tenant and Workspace policy (PRD §14.3-4).
3. All AI claims cite sources; **no fabricated facts or unverified "done" claims** (PRD §12.3).
4. The audit log is **append-only and tamper-evident** (PRD NFR-8).
5. No cross-tenant data access under any configuration (PRD FR-1).
6. The App Contract (PRN-12) is frozen; no future App may require platform changes.

### 2.4 Top-level system anatomy (logical)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CONVERSATIONAL LAYER                        │
│   Conversational Console · Plan & Confirm · Work Inbox · Search     │
├─────────────────────────────────────────────────────────────────────┤
│                         INTELLIGENCE LAYER                          │
│   Enterprise AI Orchestrator · Planner · Reasoner · Memory          │
│   Agent Registry · Tool Registry · Knowledge Base · Context Mgr     │
│   Approval Engine · Explainability · AI Monitoring · AI Studio      │
├─────────────────────────────────────────────────────────────────────┤
│                        ORCHESTRATION LAYER                          │
│   Workflow Engine · Task Planner · Event Broker · Notifications     │
├─────────────────────────────────────────────────────────────────────┤
│                         APPLICATION LAYER                           │
│   HR · Projects · CRM · Finance · Sales · Inventory · Procurement   │
│   Documents · Analytics · Calendar · Knowledge Base                 │
│   (system) Notifications · Administration                           │
├─────────────────────────────────────────────────────────────────────┤
│                        GOVERNANCE LAYER                             │
│   Identity & Access (orgs, companies, workspaces, users, roles)     │
│   Permission Engine · Policy Engine · Audit · Residency             │
└─────────────────────────────────────────────────────────────────────┘
```

This is a **logical** anatomy for specifying behavior, not a technology architecture.

---

## 3. Company Model

Realizes: PRD FR-1, FR-2, FR-3, §8, §15.

### 3.1 Concepts

| ID   | Concept                 | Definition                                                                                                                                                                                                                                                                                                 |
| ---- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CO-1 | **Organization**        | Optional top-level legal/group entity owning one or more Companies (e.g., a holding group, a brand portfolio, a government ministry). Enables consolidated administration and cross-Company reporting _where explicitly permitted_; default installs have no Organization (a single Company stands alone). |
| CO-2 | **Company**             | The multi-tenant **tenant** unit (PRD "tenant" ⇔ PSD "Company"). Owns identity, settings, App subscriptions, Workspaces, data, policies, and audit logs. A Company maps to one legal/customer entity.                                                                                                      |
| CO-3 | **Company lifecycle**   | States: `Provisioning → Active → Suspended → Retired`. Supported transitions with retention per policy (FR-3).                                                                                                                                                                                             |
| CO-4 | **Industry-neutrality** | The platform core contains **no industry-specific logic**. Industry fit is achieved solely through the Apps a Company installs and the workflow templates it enables (PRD §8.2, NG-3).                                                                                                                     |

### 3.2 Company-level behaviors

- **CO-B1.** On provisioning, a Company receives a default Workspace (see §4) and the two system Apps (Notifications, Administration).
- **CO-B2.** A Company enables domain Apps per its needs (e.g., a retailer enables Inventory, Sales, Procurement, Finance; a software firm enables Projects, HR, Documents). Disabling an App is governed by §5.5.
- **CO-B3.** A Company shall be able to configure: identity providers (SSO/MFA), data residency, retention, approval defaults, AI configuration (budgets, model tiers), and audit export schedules (PRD FR-18, FR-35, NFR-10, NFR-14).
- **CO-B4.** A Company shall never observe another Company's data, events, or audit records (FR-1). Cross-Company collaboration (multi-tenant B2B workflows) is explicitly out of v1 scope (PRD §20.3; V1-7).

---

## 4. Workspace Model

**New concept introduced by this specification (see §18.4 for rationale).** Realizes: PRD FR-19/20 (scoping), FR-29 (shared Work Inbox), §7 personas, §14 role scoping.

### 4.1 Definition

- **WS-1. Workspace** — a scoped operational container **inside a Company**. Workspaces let a Company partition its operations (e.g., Engineering, Human Resources, Finance, Sales, Executive, Operations) so that each part owns its own Apps, AI Agents, permissions, knowledge, and workflows — while remaining one Company on one plan, one identity, and one audit trail.

### 4.2 What a Workspace owns

| Owner           | Scope            | Detail                                                                                                                                                                |
| --------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apps**        | App _instances_  | Which Apps are enabled in this Workspace, with their Workspace-level configuration. A Company installs an App once; each Workspace decides whether and how to use it. |
| **AI Agents**   | Agent enablement | Which application agents are active in the Workspace, their autonomy tier, and Workspace-specific agent policies.                                                     |
| **Permissions** | Roles & scopes   | Workspace roles, memberships, and data scoping rules (§10).                                                                                                           |
| **Knowledge**   | KB scope         | Its own Knowledge Base articles and Documents libraries (a record belongs to exactly one Workspace by default).                                                       |
| **Workflows**   | Templates & runs | Its own workflow templates, triggers, approvals chains, and execution history.                                                                                        |

### 4.3 Workspace rules

- **WS-R1. Default Workspace.** Every Company starts with one default Workspace ("Company Default", type _Operations_). A Company that wants a single flat environment uses only the default — this preserves SMB simplicity and the PRD's single-tenant-equals-company mental model.
- **WS-R2. Membership.** A user belongs to one Company and may belong to multiple Workspaces, each membership carrying its own roles (§10). A user's effective authority in a conversation is evaluated in the Workspace in which the conversation occurs.
- **WS-R3. Workspace context.** Every conversation, record, workflow run, and event is scoped to exactly one Workspace (its `workspaceId`). Cross-Workspace visibility requires explicit sharing or a role spanning Workspaces — never implicit leakage.
- **WS-R4. Workspace types are templates.** Types (Engineering, HR, Finance, Sales, Executive, Operations, or custom) are preconfigured template packs (Apps + roles + starter workflows). They carry **no special behavior** in the platform; a "Finance Workspace" is not treated differently by the core (PRN-14).
- **WS-R5. Workspace lifecycle.** `Provisioned → Active → Archived`. Archiving suspends triggers and agents, retains data and audit, and can be reversed by Company admins. Deleting a Workspace requires export confirmation and preserves audit records.
- **WS-R6. Administration.** Workspace administration is delegated to a **Workspace Admin** role (PRM-§10); Company admins retain override authority.

### 4.4 Workspace ↔ PRD mapping

| PRD concept                             | PSD treatment                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Tenant (§1, FR-1/2)                     | ⇔ **Company** (CO-2). Workspaces are _inside_ a tenant, so FR-1/2 isolation guarantees are unchanged.          |
| "Department" scoping in roles (§14.3-2) | Formalized as Workspace + Team scoping (§10).                                                                  |
| Pilot-in-a-department rollout (Risk R2) | Enabled natively: an enterprise can pilot Nexora in one Workspace (e.g., "Sales") before company-wide rollout. |

---

## 5. Application Model

Realizes: PRD FR-14, FR-15, FR-16, FR-17, §13.2.

### 5.1 Application definition

- **APP-1. Application (App)** — an independently installable unit of domain capability. Apps are the only source of domain behavior. The platform core contains **no domain logic** (PRN-3).

### 5.2 Application anatomy — every App contains

| Component          | Specification                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Business Logic** | Domain rules, validations, and state transitions owned by the App (e.g., "an invoice cannot be paid before approval"). Encapsulated behind the App's interfaces. |
| **Data**           | The App's own data model and records. No App reads or writes another App's data directly (PRN-11, §8).                                                           |
| **UI**             | Deterministic screens and forms for that App (the power layer, PRD FR-8).                                                                                        |
| **Permissions**    | App-level roles, capabilities, and resource scoping (PRD §14.2; §10 of this document).                                                                           |
| **Tools**          | The executable actions the App exposes to agents (typed **Skills**, §7.7) and to integrations (APIs/webhooks).                                                   |
| **AI Agent**       | The App's own agent (PRN-4). The agent is the sole executor of the App's tools.                                                                                  |
| **Events**         | The business events the App publishes and the events it subscribes to (§8).                                                                                      |
| **Knowledge**      | App-owned content that contributes to the Company/Workspace knowledge graph for RAG (e.g., HR policies, project wikis).                                          |
| **Configuration**  | Install-time and runtime settings (enabled features, thresholds, defaults, approval defaults).                                                                   |

### 5.3 App Contract (frozen at v1 — PRN-12)

The **App Contract** is the set of interfaces by which Apps interact with the platform and each other. It is frozen so future Apps (PRD §13.2: Field Service, Legal, ITSM, Payroll connectors, etc.) install **without platform changes** (FR-16).

| Contract element       | Requirement                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration manifest  | App ID, name, versions, required scopes/permissions, agent definition, skills, events, UI entry points, configuration schema                   |
| Agent interface        | App registers exactly one primary agent with typed Skills (name, input/output schema, permission requirements, idempotency, side-effect class) |
| Data interface         | App exposes read/write capabilities only through defined APIs + agent Skills; no direct cross-App data access                                  |
| Event interface        | App declares published and subscribed event types (versioned, §8)                                                                              |
| Lifecycle hooks        | `onInstall`, `onUpdate`, `onUninstall`, `onDisable` behaviors (pure housekeeping; no cross-App side effects)                                   |
| Permission declaration | Every Skill and capability declares the permissions it requires; enforcement is by the platform permission engine, not the App                 |

### 5.4 App types

- **Marketplace Apps** — domain Apps (HR, Projects, CRM, Finance, …). Installed per Company, used per Workspace.
- **System Apps** — platform-provided Apps (Notifications APP-12, Administration APP-13). Always present; cannot be uninstalled; can be restricted per Workspace.

### 5.5 App lifecycle (behavior)

| Lifecycle event     | Required behavior                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Install**         | Admin reviews declared permissions/scopes → approves → App registers agent, skills, events, data model, UI (FR-15). No platform downtime.                                                               |
| **Enable/Disable**  | Per-Workspace. Disabling: no new executions; in-flight executions complete or pause per policy; data retained; agents idle.                                                                             |
| **Update**          | Versioned; update preview shows changed permissions/skills/events; admin approves; rollback to previous version supported (FR-17).                                                                      |
| **Uninstall**       | Requires export confirmation for App data; audit records retained; dependent workflow templates referencing the App are quarantined (EC-6).                                                             |
| **Dependency rule** | An App may declare _read_ dependencies on other Apps (e.g., Finance reads Projects for billing) but may never execute another App's tools (PRD §13.2). Coordination is via the Orchestrator and events. |

---

## 6. Application Catalog & Feature Breakdown

Realizes: PRD §13, §11.2. **v1 status** follows PRD MVP (§20) plus the system Apps. Every App row below is a full behavioral breakdown.

### 6.1 APP-01 — HR · HR Agent

**v1 status:** v1 ✅ · **Purpose:** People operations: hire, onboard, offboard, manage employment records and leave.

| Field                 | Specification                                                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Capabilities**      | Employee records; hiring pipeline (applicant → offer → hire); onboarding checklists; offboarding; leave requests & balances; org chart; job titles/departments/teams; employee documents (with Documents App); policy links (with Knowledge Base).                                                                 |
| **User Actions**      | Create/view/update employee; submit leave request; approve leave; assign onboarding tasks; view org chart; request offboarding; record compensation fields (Finance-owned: compensation values are HR _input_, Finance _consumes_).                                                                                |
| **AI Capabilities**   | HR Agent Skills: `create_employee`, `update_employee`, `search_employee`, `create_offer`, `approve_offer`, `create_onboarding_checklist`, `submit_leave`, `approve_leave`, `check_balance`, `initiate_offboarding`, `org_lookup`. RAG over HR policies from KB. Explains every hire/leave decision against policy. |
| **Dependencies**      | Read: Documents (employee files), Knowledge Base (policies), Projects (assignments), Finance (compensation/payroll sync).                                                                                                                                                                                          |
| **Permissions**       | Global: any Member with People scope. App roles: HR Admin, Recruiter, People Manager, Employee (§14.2).                                                                                                                                                                                                            |
| **Generated Events**  | `EmployeeCreated`, `EmployeeUpdated`, `OfferAccepted`, `EmployeeOnboarded`, `EmployeeOffboarded`, `LeaveRequested`, `LeaveApproved`, `LeaveRejected`, `OrgChartChanged`                                                                                                                                            |
| **Future Extensions** | Recruitment workflow engine (sourcing, interviews), compensation reviews, talent reviews, payroll integration pack (partner), performance cycles.                                                                                                                                                                  |

### 6.2 APP-02 — Projects · Projects Agent

**v1 status:** v1 ✅ · **Purpose:** Delivery management: projects, tasks, milestones, resource allocation, time, status.

| Field                 | Specification                                                                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capabilities**      | Project records; tasks & milestones; resource allocation with capacity checking; timesheets; status reporting; project teams; budgets link (Finance read).                                                                                          |
| **User Actions**      | Create project; assign/unassign resources; create tasks/milestones; log time; update status; close project; view resource load.                                                                                                                     |
| **AI Capabilities**   | Skills: `create_project`, `create_task`, `create_milestone`, `assign_resource`, `check_capacity`, `update_status`, `log_time`, `project_lookup`, `generate_status_report`. Detects conflicts (capacity, date) and proposes alternatives (PRD BW-1). |
| **Dependencies**      | Read: HR (people), Finance (budgets, billing), Documents (plans/reports), Calendar (kickoffs/milestone meetings).                                                                                                                                   |
| **Permissions**       | App roles: Portfolio Manager, Project Manager, Resource Manager, Contributor, Viewer.                                                                                                                                                               |
| **Generated Events**  | `ProjectCreated`, `ProjectUpdated`, `TaskCompleted`, `MilestoneReached`, `ResourceAssigned`, `ResourceUnassigned`, `ProjectStatusChanged`, `ProjectClosed`, `CapacityConflictDetected`                                                              |
| **Future Extensions** | Advanced scheduling/leveling, project templates, time-tracking approvals, dependency graphs, client-facing project portals (v1.x).                                                                                                                  |

### 6.3 APP-03 — CRM · CRM Agent

**v1 status:** v1.1 (Phase 1) · **Purpose:** Customer relationships: contacts, companies, deals, activities.

| Field                 | Specification                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capabilities**      | Contact & company records; deals/pipelines; activity log (calls, meetings, emails); account hierarchy; enrichment notes; handoff to Sales App.                                                           |
| **User Actions**      | Create/update contact or company; log activity; move deal stage; assign account owner; merge duplicates (with confirmation).                                                                             |
| **AI Capabilities**   | Skills: `create_contact`, `create_company`, `update_deal`, `log_activity`, `search_account`, `merge_duplicates`, `draft_followup`, `deal_summary`. Detects duplicate records and proposes merges (EC-8). |
| **Dependencies**      | Read: Sales (quotes/orders), Documents (proposals), Analytics (pipeline metrics), Calendar (meetings).                                                                                                   |
| **Permissions**       | App roles: Sales Admin, Account Owner, SDR, Viewer.                                                                                                                                                      |
| **Generated Events**  | `CustomerAdded`, `ContactCreated`, `DealCreated`, `DealStageChanged`, `DealWon`, `DealLost`, `ActivityLogged`, `AccountOwnershipChanged`                                                                 |
| **Future Extensions** | Email integration, sequence automation, territory management, customer health scoring.                                                                                                                   |

### 6.4 APP-04 — Finance · Finance Agent

**v1 status:** v1.1 (Phase 1) · **Purpose:** Money operations: invoices, expenses, budgets, payments, close tasks.

| Field                 | Specification                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capabilities**      | Invoicing; expense capture & reimbursement; budget tracking; payment scheduling; month-end close checklists; financial records (money movements are always `Consequential` — BR-13).                                               |
| **User Actions**      | Create invoice; submit expense; approve expense/invoice; approve payment; adjust budget; run close checklist; reconcile (with integrations).                                                                                       |
| **AI Capabilities**   | Skills: `create_invoice`, `submit_expense`, `approve_expense`, `schedule_payment`, `budget_check`, `close_task`, `expense_summary`, `cash_position`. Flags anomalies (duplicate invoice, over-budget) for human review (PRD BW-7). |
| **Dependencies**      | Read: Projects (billable work), CRM/Sales (orders→invoices), Procurement (PO→invoice match), HR (payroll sync), Analytics (reporting).                                                                                             |
| **Permissions**       | App roles: Finance Admin, Approver, Preparer, Viewer. Approval authority is separate from preparation authority (SoD, PRM-7).                                                                                                      |
| **Generated Events**  | `InvoiceGenerated`, `InvoiceApproved`, `InvoicePaid`, `ExpenseSubmitted`, `ExpenseApproved`, `ExpenseRejected`, `PaymentScheduled`, `BudgetExceeded`, `CloseTaskCompleted`                                                         |
| **Future Extensions** | GL connector pack, multi-currency, tax packs, audit-ready financial statements (integration, not replacement — PRD NG-6/7).                                                                                                        |

### 6.5 APP-05 — Sales · Sales Agent

**v1 status:** v1.2 (Phase 2) · **Purpose:** Revenue operations: quotes, orders, pipeline forecasting.

| Field                 | Specification                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capabilities**      | Quotes from pricebook; orders; order status; pipeline forecasting; handoff to Finance for invoicing.                                                                                                    |
| **User Actions**      | Create quote; approve quote (discount thresholds); convert quote to order; update order status; view forecast.                                                                                          |
| **AI Capabilities**   | Skills: `create_quote`, `approve_quote`, `convert_to_order`, `update_order`, `forecast_summary`, `pricebook_lookup`. Drafts quotes, proposes discount levels within policy, and explains margin impact. |
| **Dependencies**      | Read: CRM (deals), Finance (invoicing, credit), Inventory (availability for order promise), Documents (contracts), Analytics (forecast).                                                                |
| **Permissions**       | App roles: Sales Admin, Sales Manager, Sales Rep, Viewer.                                                                                                                                               |
| **Generated Events**  | `QuoteCreated`, `QuoteApproved`, `QuoteRejected`, `OrderCreated`, `OrderFulfilled`, `ForecastUpdated`                                                                                                   |
| **Future Extensions** | CPQ enhancements, subscription billing packs, renewal workflows, channel/partner sales.                                                                                                                 |

### 6.6 APP-06 — Inventory · Inventory Agent

**v1 status:** v1.1 (Phase 1) · **Purpose:** Stock operations: items, locations, stock levels, transfers, counts, reorder.

| Field                 | Specification                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capabilities**      | Item master; locations; stock levels; transfers; cycle counts; reorder points; serial/lot tracking (baseline).                                                                                                                              |
| **User Actions**      | Create item; adjust stock (with approval for negative adjustments); perform transfer; run cycle count; set reorder point.                                                                                                                   |
| **AI Capabilities**   | Skills: `create_item`, `stock_check`, `propose_reorder`, `create_transfer`, `record_count`, `adjust_stock`, `stockout_alert`. Proposes reorder quantities from demand + lead time (PRD BW-6); recommends stock transfers between locations. |
| **Dependencies**      | Read: Procurement (POs/receipts), Sales (order availability), Analytics (demand), Finance (cost).                                                                                                                                           |
| **Permissions**       | App roles: Inventory Admin, Warehouse Operator, Viewer.                                                                                                                                                                                     |
| **Generated Events**  | `StockAdjusted`, `TransferCreated`, `TransferCompleted`, `StockLevelChanged`, `ReorderProposed`, `StockoutDetected`, `CountCompleted`                                                                                                       |
| **Future Extensions** | Multi-warehouse optimization, demand forecasting packs, IoT/barcode integrations (integration, not platform IoT — PRD NG-10).                                                                                                               |

### 6.7 APP-07 — Procurement · Procurement Agent

**v1 status:** v1.1 (Phase 1) · **Purpose:** Purchasing: requisitions, purchase orders, vendors, receipts, three-way match.

| Field                 | Specification                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capabilities**      | Requisition intake; vendor registry; purchase orders; receipts; three-way match (PO ↔ receipt ↔ invoice, with Finance); approval chains by value tier.                                                                |
| **User Actions**      | Submit requisition; approve requisition/PO; create vendor; record receipt; resolve match exceptions.                                                                                                                  |
| **AI Capabilities**   | Skills: `create_requisition`, `validate_budget`, `route_approval`, `create_po`, `create_vendor`, `record_receipt`, `three_way_match`, `po_status`. Detects duplicate vendors and price drift; proposes consolidation. |
| **Dependencies**      | Read: Finance (budget, payment), Inventory (receipts→stock), Documents (contracts), Analytics (spend).                                                                                                                |
| **Permissions**       | App roles: Procurement Admin, Buyer, Requester, Approver.                                                                                                                                                             |
| **Generated Events**  | `RequisitionCreated`, `RequisitionApproved`, `RequisitionRejected`, `PurchaseOrderCreated`, `PurchaseApproved`, `PurchaseOrderSent`, `ReceiptRecorded`, `MatchExceptionDetected`                                      |
| **Future Extensions** | Sourcing/RFX, supplier self-service portal, spend analytics packs, e-invoicing networks.                                                                                                                              |

### 6.8 APP-08 — Documents · Documents Agent

**v1 status:** v1 ✅ · **Purpose:** Content: storage, versioning, templates, indexing for RAG.

| Field                 | Specification                                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capabilities**      | File & folder libraries (per Workspace); version history; templates; sharing with permission control; full-text indexing feeding the AI knowledge layer.                                                                     |
| **User Actions**      | Upload; create from template; edit/comment; request approval; share; version compare; delete (trash + retention).                                                                                                            |
| **AI Capabilities**   | Skills: `upload_document`, `create_from_template`, `draft_document`, `request_approval`, `search_documents`, `summarize_document`, `extract_fields`. Drafts documents grounded in templates and existing content (PRD AI-5). |
| **Dependencies**      | Read: Knowledge Base (index rules), all Apps (attachments via reference).                                                                                                                                                    |
| **Permissions**       | App roles: Document Admin, Editor, Reviewer, Viewer.                                                                                                                                                                         |
| **Generated Events**  | `DocumentUploaded`, `DocumentUpdated`, `DocumentApproved`, `DocumentRejected`, `DocumentShared`, `DocumentDeleted`                                                                                                           |
| **Future Extensions** | e-signature integration, OCR/intake, redaction workflows, template marketplace.                                                                                                                                              |

### 6.9 APP-09 — Analytics · Analytics Agent

**v1 status:** v1.1 (Phase 1) · **Purpose:** Insight generation: KPI catalog, narrated reports, natural-language Q&A.

| Field                 | Specification                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capabilities**      | KPI catalog (defined per Company/Workspace); dashboards; narrated reports; natural-language queries over connected data. Not a warehouse (PRD NG-5).                                      |
| **User Actions**      | Create/edit KPI; build dashboard; schedule report; ask a question; drill down; export.                                                                                                    |
| **AI Capabilities**   | Skills: `ask_kpi`, `generate_report`, `narrate_variance`, `schedule_report`, `explain_metric`. Every number is traceable to a query definition and data source (no hallucinated figures). |
| **Dependencies**      | Read: All Apps' analytics views; external connected sources via integrations.                                                                                                             |
| **Permissions**       | App roles: Analytics Admin, Creator, Viewer.                                                                                                                                              |
| **Generated Events**  | `ReportGenerated`, `ReportScheduled`, `KpiThresholdBreached`                                                                                                                              |
| **Future Extensions** | Cohort analysis, forecasting models, embeddable dashboards, board packs.                                                                                                                  |

### 6.10 APP-10 — Calendar · Calendar Agent

**v1 status:** v1.1 (Phase 1) · **Purpose:** Time coordination: events, scheduling, availability, meeting coordination.

| Field                 | Specification                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capabilities**      | Calendar per user; event creation; availability lookup; meeting coordination (suggest times); workspace events (kickoffs, reviews).                                                             |
| **User Actions**      | Create event; view availability; accept/decline; reschedule; cancel.                                                                                                                            |
| **AI Capabilities**   | Skills: `create_event`, `find_time`, `suggest_times`, `reschedule_event`, `availability_lookup`. Books meetings with internal attendees within policy (no external sends without confirmation). |
| **Dependencies**      | Read: Projects (milestone meetings), HR (onboarding intros), CRM (customer meetings).                                                                                                           |
| **Permissions**       | App roles: Calendar Admin, Member (own calendar), Viewer.                                                                                                                                       |
| **Generated Events**  | `EventCreated`, `EventRescheduled`, `EventCancelled`, `MeetingBooked`                                                                                                                           |
| **Future Extensions** | External calendar sync, scheduling pages, room/asset booking.                                                                                                                                   |

### 6.11 APP-11 — Knowledge Base · KB Agent

**v1 status:** v1 ✅ · **Purpose:** Institutional memory: articles, policies, SOPs — the grounding source for agent RAG.

| Field                 | Specification                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capabilities**      | Articles & categories (per Workspace); policies & SOPs with versions; access-controlled visibility; approval workflow for publication; full-text indexing for RAG.                            |
| **User Actions**      | Write/edit article; request publication; approve publication; archive; search; feedback on answers.                                                                                           |
| **AI Capabilities**   | Skills: `write_article`, `publish_article`, `search_kb`, `answer_from_kb`, `update_policy`. Answers are grounded in approved sources only; never exposes content the user cannot read (BR-7). |
| **Dependencies**      | Read: Documents (attachments), all Apps (linking).                                                                                                                                            |
| **Permissions**       | App roles: KB Admin, Editor, Reviewer, Viewer.                                                                                                                                                |
| **Generated Events**  | `KnowledgeUpdated`, `ArticlePublished`, `ArticleArchived`, `AnswerGenerated`                                                                                                                  |
| **Future Extensions** | Multi-language content, AI-generated draft proposals for review, content lifecycle automation.                                                                                                |

### 6.12 APP-12 — Notifications (system App)

**v1 status:** v1 ✅ (always present) · **Purpose:** Platform-wide notification and Work Inbox service.

| Field                 | Specification                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Capabilities**      | Notification delivery (in-app, email, chat channels per user preference); the unified **Work Inbox** (approvals, tasks, exceptions — PRD FR-29); digests; actionable notifications (approve/reject/comment from the notification — FR-28); quiet hours; per-Company channel configuration. |
| **User Actions**      | Configure preferences; act on notifications; batch approvals; snooze; view inbox; export my inbox.                                                                                                                                                                                         |
| **AI Capabilities**   | Notifications App has **no domain agent** (it is the AI's channel). The Orchestrator may, per user preference, summarize pending items ("You have 6 approvals: 3 expenses under $100, 2 leave requests, 1 PO above threshold").                                                            |
| **Dependencies**      | Read: all Apps (to render actionable context).                                                                                                                                                                                                                                             |
| **Permissions**       | App roles: Member (own inbox), Admin (company channel config), Auditor (read-only).                                                                                                                                                                                                        |
| **Generated Events**  | `NotificationSent`, `NotificationRead`, `ApprovalTaskCreated`, `InboxDigestDelivered`                                                                                                                                                                                                      |
| **Future Extensions** | Cross-channel routing rules, priority AI triage of inbox, escalation policy engine UI.                                                                                                                                                                                                     |

### 6.13 APP-13 — Administration (system App)

**v1 status:** v1 ✅ (always present) · **Purpose:** Platform, Company, and Workspace administration (PRD FR-37).

| Field                 | Specification                                                                                                                                                                                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capabilities**      | Company setup (identity, residency, retention, billing); Workspace administration; user/group/role management; App marketplace administration; AI configuration (budgets, model tiers, autonomy tiers per Workspace/workflow); policy engine management; audit access & export; AI monitoring dashboards (§7.19). |
| **User Actions**      | Everything in "Capabilities"; delegated admin scoping; approval-chain configuration (FR-21); event subscription visibility.                                                                                                                                                                                       |
| **AI Capabilities**   | Administration App has **no domain agent**; it exposes Skills used by the Orchestrator _on explicit admin request_ (e.g., "show me who has access to Finance Workspace", "disable app X in the Sales workspace") — always with admin confirmation (BR-16).                                                        |
| **Dependencies**      | Read: all Apps (config surface).                                                                                                                                                                                                                                                                                  |
| **Permissions**       | App roles: Super Admin, Enterprise Admin, Delegated Admin, Auditor, Workspace Admin.                                                                                                                                                                                                                              |
| **Generated Events**  | `CompanyProvisioned`, `WorkspaceProvisioned`, `AppInstalled`, `AppDisabled`, `RoleChanged`, `PolicyChanged`, `UserProvisioned`, `UserDeactivated`                                                                                                                                                                 |
| **Future Extensions** | Org-level policy packs, compliance workspace, partner administration (multi-Company admin for SIs).                                                                                                                                                                                                               |

---

## 7. AI Platform Specification

Realizes: PRD §12 (AI-1…AI-12), FR-9/10/11/12/13, FR-36, NFR-13/14.

The AI Platform is specified as **19 behavioral components**. This section defines each component's responsibility and expected behavior — not its implementation. The **Enterprise AI Orchestrator (AIX-2)** is the single coordinator; the other components are capabilities it composes and services the platform provides.

### 7.0 Behavioral model of an AI interaction

Every AI interaction follows the same behavioral pipeline, regardless of surface (chat, inline action, scheduled job):

```
Utterance/Trigger
      │
      ▼
[1] Context Manager ───► [2] Enterprise AI (intent) ──► clarify? ──yes──► ask user (loops)
      │                                          │no
      ▼                                          ▼
[3] Planner (plan) ──► [4] Explainability (plan shown) ──► Approval Engine (gates)
      │                                          │
      ▼                                          ▼
[5] Task Planner (task queue) ──► Workflow Engine (executes steps)
      │                                          │
      ▼                                          ▼
[6] Agent Registry → app agent → Tool Registry → Skill execution
      │
      ▼
[7] Reasoner (verify + narrate) ──► response with sources
```

### 7.1 AIX-1 — Enterprise AI (the system-wide AI service)

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | The platform-wide capability for understanding, generating, and grounding language. Owns no workflows itself; it is what every other AI component uses.                                                                                                                                                                                              |
| **Behavior**       | Provides intent parsing, slot extraction, generation, summarization, and grounding to all components. Every generation is grounded (§12); the service shall refuse ungrounded claims. Guarantees **cost routing**: routine requests use cheap tiers, complex reasoning escalates (PRD AI-11, NFR-14). Exposes per-Company and per-Workspace budgets. |
| **Interactions**   | Consumed by AIX-2/3/4/12; publishes `AgentExecuted`-related metrics to AIX-19.                                                                                                                                                                                                                                                                       |
| **Realizes**       | PRD AI-1, AI-11, NFR-14.                                                                                                                                                                                                                                                                                                                             |

### 7.2 AIX-2 — Enterprise AI Orchestrator (EAO)

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | The **single coordinator** of all agents and workflows (PRD §12.1). Owns the conversation, the plan, and the outcome narrative.                                                                                                                                                                                                                                                                                                                                                                                   |
| **Behavior**       | (1) Receives intent; (2) consults Agent Registry + Tool Registry; (3) delegates planning to the Planner; (4) obtains approval for consequential actions; (5) dispatches tasks to application agents via the Workflow Engine; (6) monitors execution; (7) verifies results with the Reasoner; (8) composes the final response with sources. The EAO **never performs domain actions itself** — only app agents do. The EAO shall never execute an action the invoking user could not perform (PRN-2, PRD §14.3-4). |
| **Interactions**   | Publishes `AgentExecuted`, `WorkflowCompleted`, `OrchestrationPlanProposed`. Subscribes to all domain events (to trigger reactive workflows).                                                                                                                                                                                                                                                                                                                                                                     |
| **Realizes**       | PRD FR-10, AI-3, §12.1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### 7.3 AIX-3 — Planner

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | Generates the **execution plan** for an intent: a dependency-ordered sequence of typed Skills across one or more agents (PRD AI-2).                                                                                                                                                                                                                                                                                                                              |
| **Behavior**       | Plans in terms of **Skills** (never free-form actions). Each plan step declares: target agent, skill, input values, side-effect class (Read-only / Update / Consequential), and required approvals. Plans are validated against the invoking user's permissions **before** presentation (PRM-8). The Planner supports plan templates (cached, versioned) and **replanning** on mid-execution failure (PRD AI-3). Never plans around a Prohibited action (BR-14). |
| **Interactions**   | Reads: Agent Registry, Tool Registry, Prompt Library. Writes plan to Explainability + Approval Engine. Publishes `OrchestrationPlanProposed`.                                                                                                                                                                                                                                                                                                                    |
| **Realizes**       | PRD AI-2.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### 7.4 AIX-4 — Reasoner

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Responsibility** | Deduction, verification, and narrative generation: ensures conclusions follow from data and explains outcomes.                                                                                                                                                                                                                                                                                                                 |
| **Behavior**       | (1) **Verification**: after each action, checks the resulting state (read-back) before reporting success — never reports "done" unverified (PRD AI-6); (2) **Explanation**: produces human-readable reasons for plans, actions, refusals, and answers (PRD AI-10); (3) **Narration**: builds the outcome story for the user. If verification fails, the Reasoner classifies the failure for the Error Handling layer (ER-§14). |
| **Interactions**   | Consumes step results from Workflow Engine; supplies explanations to AIX-17 and the conversational console.                                                                                                                                                                                                                                                                                                                    |
| **Realizes**       | PRD AI-6, AI-10.                                                                                                                                                                                                                                                                                                                                                                                                               |

### 7.5 AIX-5 — Memory

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | Structured persistence of conversation, user, and workflow context that improves continuity and grounding.                                                                                                                                                                                                                                                                                                                                                                                         |
| **Behavior**       | Three scopes: (1) **Conversation memory** — current session context (bound to AIX-16); (2) **User memory** — preferences, recurring entities, personal defaults (opt-in, visible to the user, deletable); (3) **Workflow memory** — facts learned during executions (e.g., "Sarah prefers email"). Memory is **per-Company and per-Workspace isolated** (FR-1); never shared across Companies. Memory never overrides permission checks or approval rules. Users can view and delete their memory. |
| **Interactions**   | Written by AIX-2 on interaction completion; read by Context Manager. Publishes `KnowledgeUpdated` when user memory changes.                                                                                                                                                                                                                                                                                                                                                                        |
| **Realizes**       | PRD AI-9 (learning loop, v1.1+), FR-7.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### 7.6 AIX-6 — Knowledge Base (platform service)

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | The grounding corpus service: indexes KB articles, Documents, and app-owned knowledge for RAG (PRD AI-5, FR-31). Distinct from the KB _App_ (APP-11), which supplies content.                                                                                                                                                                              |
| **Behavior**       | Maintains a per-Workspace index with access-controlled retrieval: a user (or agent acting for a user) may only retrieve content the user can read (BR-7). Answers cite sources with drill-down (FR-6). Index updates are event-driven (`KnowledgeUpdated`, `DocumentUploaded`). Content versioning is respected (agents cite the exact version consulted). |
| **Interactions**   | Subscribes to `KnowledgeUpdated`, `DocumentUploaded`, `DocumentApproved`. Consumed by all agents for grounding.                                                                                                                                                                                                                                            |
| **Realizes**       | PRD AI-5, FR-6, FR-31.                                                                                                                                                                                                                                                                                                                                     |

### 7.7 AIX-7 — Agent Registry

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | The catalog of every installed App's agent and its Skills (PRD FR-9).                                                                                                                                                                                                                                                                                                   |
| **Behavior**       | On App install, registers the agent and its Skills (name, input/output schema, permission requirements, idempotency flag, side-effect class, cost class). Registry is the **only** source of truth for what agents can do. The EAO plans _in terms of registered Skills_; unknown or unregistered actions are never attempted. Skill versions are tied to App versions. |
| **Interactions**   | Read by Planner and EAO. Updated on App install/update/uninstall. Publishes `AgentRegistered`, `AgentUpdated`.                                                                                                                                                                                                                                                          |
| **Realizes**       | PRD FR-9, §12.1 (Skill registry).                                                                                                                                                                                                                                                                                                                                       |

### 7.8 AIX-8 — Tool Registry

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | Catalog of **executable tools** available to agents: App Skills, platform tools (search, notifications), and configured integration tools (webhooks, connector actions).                                                                                                                                                                             |
| **Behavior**       | Enforces that tool execution passes through the permission engine (PRM-8) and policy engine (BR-14). Tracks tool health (latency, failure rates) feeding AI Monitoring (AIX-19). Disables tools on persistent failure (ER-5) without affecting other tools (NFR-13). Tools declare their side-effect class; the Approval Engine keys off that class. |
| **Interactions**   | Read by Planner/EAO; consumed by application agents. Publishes `ToolHealthChanged`.                                                                                                                                                                                                                                                                  |
| **Realizes**       | PRD FR-9, NFR-13.                                                                                                                                                                                                                                                                                                                                    |

### 7.9 AIX-9 — Workflow Engine

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | Executes workflow definitions and AI-generated plans as durable, observable runs (PRD FR-22…FR-26).                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Behavior**       | Supports triggers: event, schedule, manual, agent-initiated. Steps: agent action, human task, condition, integration, notification (FR-22). Runs are journaled and resumable (FR-26); status is real-time with pause/resume/cancel/override (FR-25); checkpoints, timeouts, escalations, and SLA deadlines are first-class (FR-24). Workflow templates are versioned; template changes require review when they alter approval logic (PRD §16.9). Every run records a **Workflow Timeline** (OBS-4). |
| **Interactions**   | Subscribes to all domain events; publishes `WorkflowStarted`, `WorkflowCompleted`, `WorkflowFailed`, `StepCompleted`.                                                                                                                                                                                                                                                                                                                                                                                |
| **Realizes**       | PRD FR-22–26, §16.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 7.10 AIX-10 — Task Planner

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | Converts a plan into an ordered, schedulable task queue for execution — the "execution half" of planning.                                                                                                                                                                                                                                                  |
| **Behavior**       | Respects dependencies and parallelizable steps; assigns each task to a target agent with a deadline and SLA; handles fan-out/fan-in of multi-agent steps; allocates human tasks to the Work Inbox with assignees and due dates. Task Planner re-queues retriable tasks (ER-2) and reports un-routable tasks (no available agent) to error handling (ER-4). |
| **Interactions**   | Consumes plans from AIX-3; hands tasks to AIX-9. Publishes `TaskScheduled`.                                                                                                                                                                                                                                                                                |
| **Realizes**       | PRD AI-3, FR-22/24.                                                                                                                                                                                                                                                                                                                                        |

### 7.11 AIX-11 — Approval Engine

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | Enforces human authorization for gated actions (PRD AI-4, FR-21, FR-28).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Behavior**       | Classifies every action by side-effect class (BR-13): **Consequential** (always approved), **Configurable** (approval per policy), **Routine** (no approval when policy allows). Supports single, multi-level, and 4-eyes chains (FR-21); delegation; batch approvals; approval with comment; SLA-driven reminders and escalation (FR-24). An approval is bound to a _specific proposed action + inputs_ — approving once never becomes a blanket authorization (BR-15). Rejections return the workflow to a defined state with reason. Concurrent approvals of the same item are resolved by first-decision-wins (EC-10). |
| **Interactions**   | Reads policy engine; routes tasks to Work Inbox (APP-12). Publishes `ApprovalRequested`, `ApprovalGranted`, `ApprovalRejected`, `ApprovalEscalated`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Realizes**       | PRD AI-4, FR-21, FR-28, AI-12.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### 7.12 AIX-12 — Context Manager

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | Assembles the context window for any AI call: who, where, what, and what's relevant — and nothing else.                                                                                                                                                                                                                                                                                                                                |
| **Behavior**       | Bundles: actor identity + effective permissions, Workspace scope, conversation history (AIX-16), user memory (AIX-5), relevant KB/Document excerpts (AIX-6, access-filtered), and relevant workflow state. Context is **minimal and permission-filtered**: it never contains content the actor cannot access (BR-7). Prevents context overflow by summarization and eviction policies. All context assembly is itself audited (AUD-3). |
| **Interactions**   | Feeds all AI generation (AIX-1/2/3/4).                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Realizes**       | PRD FR-5/6/7, AI-1.                                                                                                                                                                                                                                                                                                                                                                                                                    |

### 7.13 AIX-13 — Prompt Library

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | Governed repository of prompts (system prompts, skill instructions, policy injections) with versioning and review.                                                                                                                                                                                                                                                                                  |
| **Behavior**       | Prompts are versioned and immutable once used in an audit record (AUD-5 references prompt version). Includes: platform prompts (canonical behavior), App prompts (domain behavior, shipped with the App), and Company/Workspace prompt overrides (policy language injected by admins — e.g., "never promise delivery dates"). Changes require admin review for prompts that affect safety behavior. |
| **Interactions**   | Read by AIX-1/2/3.                                                                                                                                                                                                                                                                                                                                                                                  |
| **Realizes**       | PRD §12 trust principles.                                                                                                                                                                                                                                                                                                                                                                           |

### 7.14 AIX-14 — AI Studio

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | The admin-facing environment for configuring, testing, and tuning AI behavior (PRD FR-37).                                                                                                                                                                                                                                                                                                                                                      |
| **Behavior**       | Provides: Skill testing sandbox (with a clear "test" watermark and no side effects); prompt override editor; autonomy-tier assignment per Workspace/workflow (Assist → Confirm → Approve-with-rules → Supervised-autonomous, PRD §12.3; tiers are set by admins, never by AI); scenario testing of workflows before publication; and rollout controls (enable for a Workspace or role). AI Studio changes are themselves versioned and audited. |
| **Interactions**   | Writes AI Configuration (AIX-15) and Prompt Library (AIX-13). Publishes `PolicyChanged`.                                                                                                                                                                                                                                                                                                                                                        |
| **Realizes**       | PRD FR-37, §12.3, AI-9 (tuning).                                                                                                                                                                                                                                                                                                                                                                                                                |

### 7.15 AIX-15 — AI Configuration

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Responsibility** | Tenant-scoped configuration of AI behavior and cost.                                                                                                                                                                                                                                                                                                               |
| **Behavior**       | Settings per Company/Workspace: model tiers and routing rules, budgets and rate limits (NFR-14), grounding sources, approval defaults by side-effect class, autonomy tiers, and AI feature toggles. Configuration is validated against safety invariants — admins **cannot** configure away the human-approval guarantee for Consequential actions (PRN-2, BR-13). |
| **Interactions**   | Read by AIX-1 and AIX-11.                                                                                                                                                                                                                                                                                                                                          |
| **Realizes**       | PRD AI-11, NFR-14.                                                                                                                                                                                                                                                                                                                                                 |

### 7.16 AIX-16 — Conversation History

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | Durable, per-Workspace, per-user record of all conversational interactions (PRD FR-7).                                                                                                                                                                                                                                                                                                    |
| **Behavior**       | Stores utterances, clarifications, generated plans, approvals, executed actions, and responses with sources; supports multi-turn follow-ups; searchable by user, date, and topic. History is a **privacy surface**: retention per Company policy; users can view their own; admins can view per audit policy; it feeds the AI Timeline (OBS-3). History never crosses Company boundaries. |
| **Interactions**   | Written by AIX-2; read by AIX-12 and OBS-3. Publishes `ConversationRecorded`.                                                                                                                                                                                                                                                                                                             |
| **Realizes**       | PRD FR-7.                                                                                                                                                                                                                                                                                                                                                                                 |

### 7.17 AIX-17 — AI Explainability

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | Renders _why_ for every AI decision (PRD AI-10, FR-36).                                                                                                                                                                                                                                                                                                                                                                     |
| **Behavior**       | For each AI decision, exposes: the intent as understood, the plan (steps + skills + inputs), the sources consulted (with access-appropriate citations), the policy/approval basis, and the verification evidence. Explanations are available at three levels: quick summary, step-level detail, and full audit reference. Refusals always include a reason. Every explanation panel links to the exact audit records (AUD). |
| **Interactions**   | Reads from Reasoner, Approval Engine, audit trail.                                                                                                                                                                                                                                                                                                                                                                          |
| **Realizes**       | PRD AI-10, FR-36, §12.3.                                                                                                                                                                                                                                                                                                                                                                                                    |

### 7.18 AIX-18 — Human Approval

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | The user-facing surface and rules of the human-in-the-loop guarantee (PRD AI-4, AI-12).                                                                                                                                                                                                                                                                                                                                                                                           |
| **Behavior**       | Requests approvals with full context (what, on what record, by whom initiated, what happens after, what happens if rejected). Actionable from Work Inbox, notification, or the conversation (FR-28). Supports: approve, approve-with-changes (edits inputs), reject-with-reason, delegate, batch approve. Timeouts follow policy (EC-4). Approvals are never auto-granted. The human-approval rule **cannot be bypassed, delayed by the AI, or "learned around"** (BR-13, PRN-2). |
| **Interactions**   | Surface for AIX-11; routes to APP-12. Publishes `ApprovalGranted`, `ApprovalRejected`.                                                                                                                                                                                                                                                                                                                                                                                            |
| **Realizes**       | PRD AI-4, AI-12, FR-28.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### 7.19 AIX-19 — AI Monitoring

| Aspect             | Specification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsibility** | Continuous observation of AI behavior for quality, cost, and safety (PRD §18.3 guardrail metrics; NFR-15).                                                                                                                                                                                                                                                                                                                                                                                         |
| **Behavior**       | Tracks: success/error rates per skill and agent; verification failures; escalation-to-human rate; confirmation approval rates; cost per interaction and per tenant; latency; refusals by policy class; and guardrail metrics from PRD §18.3. Surfaces to admins via dashboards (with APP-13) and to internal SLO dashboards. **Anomaly alerting**: rising verification failures or unexpected action patterns alert platform ops and the Company admin. Monitoring data is tenant-scoped (NFR-15). |
| **Interactions**   | Consumes telemetry from all AIX components and apps. Publishes `AiAnomalyDetected`.                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Realizes**       | PRD §18.3, NFR-15.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### 7.20 AI safety taxonomy (cross-cutting)

| Class             | Definition                         | Approval default                                | Examples                                                                                                                              |
| ----------------- | ---------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Read-only**     | No state change                    | Never required                                  | Search, lookup, summarize, generate                                                                                                   |
| **Update**        | Non-consequential state change     | Per policy (usually none)                       | Update task status, log activity, edit draft                                                                                          |
| **Consequential** | Irreversible or high-impact change | **Always required** (cannot be configured away) | Money movement, hiring/termination, contract commitment, deletion, external communication, order/PO placement above threshold (BR-13) |

**Autonomy tiers** (PRD §12.3): `Assist` (drafts only) → `Confirm` (every action shown first; v1 default) → `Approve-with-rules` (routine actions auto-run under rules; consequential still approved) → `Supervised-autonomous` (Phase 2+; scheduled/proactive). Tiers are assigned per Workspace/workflow by admins via AI Studio — never self-granted by the AI.

---

## 8. Event Model

Realizes: PRD FR-32, §13.2 ("Apps communicate only through defined interfaces and events"), PRN-11.

### 8.1 Purpose

The Event Model is the **only channel for cross-App state awareness**. Apps publish events when their state changes; other Apps, the Workflow Engine, and the Orchestrator subscribe. This decoupling is what makes Apps independently installable (FR-16) and what makes workflows reactive (event-triggered).

**Coordination rule (reconciliation with PRD §13.2):** events provide _awareness_ and _triggers_; actions are still performed by **agents dispatched through the Orchestrator**, never by one App directly invoking another App's tools. A subscriber that needs action (e.g., Finance after `EmployeeCreated`) does not act on the event directly — it triggers a workflow that the Orchestrator plans and the owning App's agent executes.

### 8.2 Event envelope

Every event carries:

| Field                       | Definition                                                                     |
| --------------------------- | ------------------------------------------------------------------------------ |
| `eventId`                   | Globally unique event ID                                                       |
| `type`                      | Stable event type (e.g., `EmployeeCreated`)                                    |
| `version`                   | Schema version of the payload                                                  |
| `occurredAt`                | Timestamp (UTC)                                                                |
| `companyId` / `workspaceId` | Scope; events never cross Companies (FR-1)                                     |
| `publisher`                 | Publishing App ID + system                                                     |
| `subject`                   | Affected record reference (e.g., `employee:EMP-1042`)                          |
| `actor`                     | Who/what caused it: `user:…`, `agent:hr`, `system:workflow`, `system:schedule` |
| `correlationId`             | Links events from one workflow/conversation execution                          |
| `payload`                   | Versioned change data (before/after refs where relevant)                       |
| `traceId`                   | Distributed trace link for observability (NFR-15)                              |

### 8.3 Event catalog (normative for v1)

| ID     | Event                                                            | Publisher       | Typical subscribers / effect                                                                |
| ------ | ---------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| EVT-1  | `EmployeeCreated`                                                | HR              | Orchestrator → onboarding workflow (WRK-2); Finance (comp record); Projects (resource pool) |
| EVT-2  | `EmployeeUpdated`                                                | HR              | Analytics; dependent Apps re-derive                                                         |
| EVT-3  | `EmployeeOnboarded`                                              | HR              | Notifications (welcome); Calendar (intro meetings)                                          |
| EVT-4  | `EmployeeOffboarded`                                             | HR              | Orchestrator → offboarding workflow (WRK-3); IT access tasks                                |
| EVT-5  | `LeaveRequested` / `LeaveApproved` / `LeaveRejected`             | HR              | Approvers; Calendar (out-of-office); Projects (resource availability)                       |
| EVT-6  | `ProjectCreated`                                                 | Projects        | Analytics; Notifications; Finance (budget context)                                          |
| EVT-7  | `ProjectUpdated`                                                 | Projects        | Analytics; stakeholders                                                                     |
| EVT-8  | `TaskCompleted`                                                  | Projects        | Analytics (velocity); workflow continuations                                                |
| EVT-9  | `MilestoneReached`                                               | Projects        | Notifications; executive reporting (WRK-13)                                                 |
| EVT-10 | `ResourceAssigned` / `ResourceUnassigned`                        | Projects        | HR; Analytics; capacity views                                                               |
| EVT-11 | `CustomerAdded`                                                  | CRM             | Sales (nurture); Documents (folder); Analytics                                              |
| EVT-12 | `DealStageChanged` / `DealWon` / `DealLost`                      | CRM             | Sales (forecast); Finance (invoicing on `DealWon`); Analytics                               |
| EVT-13 | `InvoiceGenerated`                                               | Finance         | Finance approvers; Procurement (PO match); Analytics                                        |
| EVT-14 | `InvoiceApproved` / `InvoicePaid`                                | Finance         | AR ledger; Analytics; customer notifications                                                |
| EVT-15 | `ExpenseSubmitted` / `ExpenseApproved` / `ExpenseRejected`       | Finance         | Approvers; HR (reimbursement); Analytics                                                    |
| EVT-16 | `PurchaseApproved`                                               | Procurement     | Finance (commitment); Inventory (inbound expectation); Analytics                            |
| EVT-17 | `PurchaseOrderCreated` / `PurchaseOrderSent`                     | Procurement     | Vendors (integration); Inventory; Finance                                                   |
| EVT-18 | `ReceiptRecorded`                                                | Procurement     | Inventory (stock in); Finance (three-way match); Analytics                                  |
| EVT-19 | `RequisitionApproved` / `RequisitionRejected`                    | Procurement     | Requesters; Finance (budget); Work Inbox                                                    |
| EVT-20 | `StockAdjusted` / `StockLevelChanged`                            | Inventory       | Analytics; Procurement (reorder)                                                            |
| EVT-21 | `ReorderProposed`                                                | Inventory       | Orchestrator → replenishment workflow (WRK-12)                                              |
| EVT-22 | `DocumentUploaded`                                               | Documents       | Knowledge service (index); KB; workflows waiting on documents                               |
| EVT-23 | `DocumentApproved`                                               | Documents       | Workflow continuations; sharing                                                             |
| EVT-24 | `DocumentRejected`                                               | Documents       | Workflow continuations (return to author)                                                   |
| EVT-25 | `KnowledgeUpdated`                                               | KB              | Knowledge service (re-index); agents (freshness)                                            |
| EVT-26 | `AgentExecuted`                                                  | AI Platform     | Audit; AI Monitoring; Analytics (automation)                                                |
| EVT-27 | `ApprovalGranted`                                                | Approval Engine | Workflow continuation; Notifications                                                        |
| EVT-28 | `ApprovalRejected`                                               | Approval Engine | Workflow continuation (rejection path); Notifications                                       |
| EVT-29 | `NotificationSent`                                               | Notifications   | Audit; AI Monitoring                                                                        |
| EVT-30 | `WorkflowStarted` / `WorkflowCompleted` / `WorkflowFailed`       | Workflow Engine | Analytics (automation value); AI Monitoring; Notifications                                  |
| EVT-31 | `AppInstalled` / `AppDisabled` / `RoleChanged` / `PolicyChanged` | Administration  | Audit; relevant Apps (re-evaluate); AI Monitoring                                           |
| EVT-32 | `UserProvisioned` / `UserDeactivated`                            | Administration  | All Apps (access re-evaluation); Audit                                                      |
| EVT-33 | `OrchestrationPlanProposed` / `OrchestrationPlanApproved`        | AI Platform     | Audit; Conversation History                                                                 |
| EVT-34 | `AccountOwnershipChanged`                                        | CRM             | Sales; Analytics                                                                            |
| EVT-35 | `QuoteCreated` / `OrderCreated` / `OrderFulfilled`               | Sales           | CRM (deal linkage); Finance (invoicing); Inventory (availability)                           |
| EVT-36 | `ReportGenerated`                                                | Analytics       | Notifications; executive reporting                                                          |

### 8.4 Delivery & ordering guarantees

- **EVT-G1. At-least-once delivery.** Subscribers must tolerate duplicates; consumers are **idempotent** (processing an event twice yields the same state).
- **EVT-G2. Ordering.** Events for the _same subject_ (record) are delivered in occurrence order; cross-subject ordering is not guaranteed.
- **EVT-G3. Replay.** Events are retained per Company policy (7-year default aligned with NFR-8) and replayable for recovery, re-indexing, or workflow re-execution (FR-26).
- **EVT-G4. Schema versioning.** Event types are versioned; backward-compatible payload changes bump the version; breaking changes require a new event type with a deprecation window.
- **EVT-G5. No silent consumption.** Every event subscription is visible in Administration (auditability of what reacts to what).
- **EVT-G6. Scope.** All events are scoped to Company + Workspace; no cross-tenant events exist in v1 (V1-7).

---

## 9. User Model

Realizes: PRD FR-18/19/20, §14.

### 9.1 Entity hierarchy

```
Organization (optional)              e.g., Holding Group
 └─ Company (tenant)                 e.g., Acme Inc.
     └─ Workspace                   e.g., Engineering, Finance, Sales
         └─ Team                    e.g., Mobile Banking Squad
             └─ User / Group
```

### 9.2 Entities

| ID     | Entity                       | Definition & rules                                                                                                                                                                                                                          |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| USR-1  | **Organization**             | Optional grouping of Companies (CO-1). Members may hold Organization-level roles for consolidated admin/reporting only; no data access across Companies is implied (FR-1).                                                                  |
| USR-2  | **Company**                  | Tenant entity (CO-2). All users belong to exactly one Company (their home tenant).                                                                                                                                                          |
| USR-3  | **Workspace**                | Operational container (§4). Users hold memberships per Workspace; each membership carries roles (PRM-§10).                                                                                                                                  |
| USR-4  | **Team**                     | Optional grouping _within_ a Workspace for resource scoping (e.g., a project squad). Teams own memberships too; team membership is a scoping factor, not a permission grant itself.                                                         |
| USR-5  | **User**                     | A human identity. Attributes: home Company, email, name, SSO identity, status (`Invited → Active → Suspended → Deactivated`), language/timezone, notification preferences (FR-27).                                                          |
| USR-6  | **Group**                    | Reusable bundle of memberships + roles (e.g., "All Managers") for scalable assignment (least-privilege by construction, PRD §14.3).                                                                                                         |
| USR-7  | **Role**                     | Named set of permissions with a scope (Global / Workspace / App / Resource). Roles are the _only_ way permissions are granted to users/groups (PRM-1).                                                                                      |
| USR-8  | **Permission**               | The atomic grant: {resource class, action, scope, conditions} (PRM-§10).                                                                                                                                                                    |
| USR-9  | **Guest**                    | External person granted **limited, read-only, time-boxed** access to specific records (e.g., a consultant viewing a project). Guests: cannot invoke agents, cannot approve, cannot be assigned tasks; all Guest activity is audited (BR-8). |
| USR-10 | **External User — Vendor**   | Limited portal identity for vendors (e.g., PO confirmation, document upload, status visibility). Scope: only records shared with them; no internal data access; no agent invocation.                                                        |
| USR-11 | **External User — Customer** | Limited portal identity for customers (e.g., portal documents, ticket visibility in future apps). Same containment rules as Vendor.                                                                                                         |

### 9.3 Identity lifecycle rules

- **USR-R1.** Users are provisioned via SCIM or admin; deactivation immediately revokes all permissions and agent authority (BR-4, EC-1).
- **USR-R2.** A user's effective permissions are recomputed at every request; permission changes take effect on the next request (no long-lived sessions carry stale authority).
- **USR-R3.** Users may be members of multiple Workspaces; a conversation is always bound to one Workspace context (WS-R3).
- **USR-R4.** Guest/External users can never be members of a Workspace; they hold only record-level grants (USR-9/10/11).
- **USR-R5.** Self-service: users can see their own roles and permissions, and request access (routed to the appropriate admin) — visibility supports the trust principle (PRN-10).

---

## 10. Permission Model

Realizes: PRD FR-19/20/21, §14.3, PRN-2/8.

### 10.1 Six-level hierarchy

Permissions are granted and evaluated in six levels. **Higher levels are always constrained by lower levels.**

| Level              | Scope                   | Examples                                                                                      | Set by                             |
| ------------------ | ----------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| **L1 Global**      | Company-wide            | Super Admin, Enterprise Admin, Member, Auditor, Guest/Viewer (PRD §14.1)                      | Super Admin / Enterprise Admin     |
| **L2 Workspace**   | One Workspace           | Workspace Admin, Finance Workspace Member, Sales Workspace Viewer                             | Enterprise Admin / Workspace Admin |
| **L3 Application** | One App in a scope      | HR Admin, Project Manager, Approver (PRD §14.2)                                               | Delegated App Admin                |
| **L4 Resource**    | Specific records        | "view project #P-42", "edit deal #D-9", team-scoped data (own/team/dept) (PRD §14.3-2)        | Record owner / admin               |
| **L5 AI**          | Agent authority         | Which Skills a user's agent invocations may use; autonomy tier; delegation caps (PRD §14.3-4) | Admin (AI Studio)                  |
| **L6 Approval**    | Authorization authority | Who may approve which action classes; limits and chains (SoD, PRD §14.3-3, FR-21)             | Admin                              |

### 10.2 Evaluation rules

- **PRM-1.** Permissions are granted **only** via Roles (USR-7); there are no ad-hoc grants.
- **PRM-2. Inheritance.** A role at a higher level includes lower-level default permissions _unless_ overridden; App roles inherit from Global roles (PRD §14.3-1).
- **PRM-3. Explicit deny wins.** Denies at any level override allows at higher levels; deny cannot be overridden by a lower-level allow.
- **PRM-4. Least privilege.** Default = no access. Every grant is explicit and scoped.
- **PRM-5. Effective permission** = intersection of all applicable grants after deny resolution, evaluated fresh per request (USR-R2).
- **PRM-6. Segregation of duties (SoD).** The authority to _request_ an action and the authority to _approve_ it are distinct (L6); the same user cannot approve their own request unless a Company rule explicitly permits it and it is audited as a conflict.
- **PRM-7. Data scoping.** App roles are further scoped by record scope: `own` / `team` / `workspace` / `company` (PRD §14.3-2).
- **PRM-8. AI delegation.** An agent acting for a user holds exactly the invoking user's effective permissions, further intersected with the tenant's AI policy and the workflow's autonomy tier (PRN-2, PRD §14.3-4). The AI never escalates its own permissions.
- **PRM-9. Time & context conditions.** Grants may carry conditions (time windows, Workspace context, record status) — a condition that fails denies the action.
- **PRM-10. Change audit.** Every role/permission change is an audited event (`RoleChanged`, EVT-31) with before/after and reason.

### 10.3 Illustrative permission scenario

> _User asks: "Hire Sarah and assign her to the Mobile Banking project."_
> Evaluation: (L1) user holds `Member`; (L2) is a member of the **HR Workspace**; (L3) holds `Recruiter` (HR) and `Resource Manager` (Projects); (L5) AI tier = `Confirm`; (L6) approval chain for offers = 4-eyes (HR Admin + Finance Approver).
> Result: the HR Agent may create an employee draft and _request_ an offer; the offer action is gated at L6; the Projects assignment proceeds after capacity check; everything is audited with the plan shown first (AIX-17).

---

## 11. Business Workflow Library

Realizes: PRD §16 (BW-1…BW-8), FR-22…FR-26, AI-2/3/4.

Every workflow is specified with the same eight fields so engineering can model them uniformly. Workflow numbers WRK-1…WRK-14 map to PRD BW-* where applicable.

### 11.1 WRK-1 — Hire and Assign (flagship; ⇔ PRD BW-1)

> User: _"Hire Sarah and assign her to the Mobile Banking project."_

| Field                 | Specification                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | Natural-language request in a Workspace with HR + Projects enabled.                                                                                                                                                                         |
| **Actors**            | Requesting user; HR Admin (approver); Finance Approver (4-eyes); optionally IT (provisioning).                                                                                                                                              |
| **Applications**      | HR, Projects, Finance, Notifications (+ Documents for offer letter; + IT integration if configured).                                                                                                                                        |
| **AI Agents**         | EAO (orchestrates); HR Agent (create employee, offer); Projects Agent (assign resource, capacity check); Finance Agent (compensation); Documents Agent (offer letter draft).                                                                |
| **Approval points**   | (1) Plan confirmation (Confirm tier); (2) Offer & compensation = **Consequential** → 4-eyes approval; (3) external email (welcome) = Consequential → approval unless policy pre-authorizes.                                                 |
| **Events generated**  | `OrchestrationPlanProposed` → `ApprovalRequested/Granted` → `EmployeeCreated` → `EmployeeOnboarded` → `ResourceAssigned` → `NotificationSent`                                                                                               |
| **Expected result**   | Employee record active; offer accepted/recorded; Sarah assigned to Mobile Banking with capacity verified; comp configured; welcome sent; summary response with links to records (FR-6).                                                     |
| **Failure scenarios** | Duplicate person found (→ EAO asks to confirm merge or use existing, EC-8); capacity conflict (→ EAO proposes alternatives, PRD BW-1); missing policy/comp band (→ pauses for admin); approval timeout (EC-4); HR Agent unavailable (ER-4). |

### 11.2 WRK-2 — Employee Onboarding (⇔ PRD BW-2)

| Field                 | Specification                                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | `EmployeeCreated` with `status=Hired` (event-triggered).                                                                                                          |
| **Actors**            | New employee; HR Admin; IT; onboarding tasks' assignees; hiring manager.                                                                                          |
| **Applications**      | HR, Documents, Calendar, Notifications (+ IT provisioning integration).                                                                                           |
| **AI Agents**         | HR Agent (checklist generation); Documents Agent (policy pack); Calendar Agent (intro meetings).                                                                  |
| **Approval points**   | None mandatory for routine steps; account provisioning and any equipment spend above threshold = approved by IT/manager.                                          |
| **Events generated**  | `EmployeeOnboarded`, `DocumentUploaded` (policies), `EventCreated` (intros), `TaskCompleted` (checklist)                                                          |
| **Expected result**   | Checklist generated and assigned; accounts provisioned; intro meetings booked; 30/60/90 reviews scheduled; status visible in Work Inbox (FR-29).                  |
| **Failure scenarios** | Provisioning integration down (→ workflow pauses with escalation, ER-5); new employee record updated mid-flow (→ re-plan, EC-1); department missing (BR-1, EC-3). |

### 11.3 WRK-3 — Offboarding (⇔ PRD BW-3)

| Field                 | Specification                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | Authorized offboarding request (HR Admin) or `EmployeeOffboarded`-class event.                                                                                                                                                                  |
| **Actors**            | HR Admin (initiator+approver); IT; Project Managers (resource transfer); Finance; Warehouse (asset return, if applicable).                                                                                                                      |
| **Applications**      | HR, Projects, Finance, Inventory, Documents, Notifications.                                                                                                                                                                                     |
| **AI Agents**         | HR Agent (exit checklist); Projects Agent (reassign/transfer work); Finance Agent (final pay & expense close); Inventory Agent (asset tasks).                                                                                                   |
| **Approval points**   | Termination itself = **Consequential** → HR Admin approval (always); final payment = Finance approval.                                                                                                                                          |
| **Events generated**  | `EmployeeOffboarded`, `ResourceUnassigned`, `ProjectUpdated` (owner transfers), `ApprovalGranted` (final pay)                                                                                                                                   |
| **Expected result**   | Access revoked; work reassigned with owners named; final pay and expense tasks queued; assets flagged; exit survey sent; record closed with audit trail (EC-2: user loses permissions during workflow is expected here — handled deliberately). |
| **Failure scenarios** | Orphaned work with no successor (→ workflow blocks with escalation, BR-2); asset not returned (→ open task with escalation SLA); access revocation fails (→ ER-5, hard-block until resolved).                                                   |

### 11.4 WRK-4 — Project Creation

| Field                 | Specification                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | Natural-language request ("start a project for the Mobile Banking app") or `ProjectRequested` from a template.                                              |
| **Actors**            | Requesting user; Portfolio Manager (approver for budget-scoped projects); Project Manager (owner).                                                          |
| **Applications**      | Projects, Finance (budget), Documents (charter), Notifications.                                                                                             |
| **AI Agents**         | Projects Agent (create project, milestones, initial tasks); Documents Agent (draft charter from template); Finance Agent (budget allocation if configured). |
| **Approval points**   | Project charter approval (Configurable — typically required); budget above threshold = Consequential (Finance).                                             |
| **Events generated**  | `ProjectCreated`, `ProjectUpdated`, `DocumentUploaded` (charter), `DocumentApproved`, `MilestoneReached` (later)                                            |
| **Expected result**   | Project record with owner, milestones, initial tasks, linked charter; budget assigned; workspace team invited.                                              |
| **Failure scenarios** | No owner named (→ BR-2 blocks creation); budget exceeds available (→ flags and routes to Finance); duplicate project detected (EC-8).                       |

### 11.5 WRK-5 — Customer Onboarding (CRM)

| Field                 | Specification                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | `CustomerAdded` with `status=Onboarding` or explicit "onboard customer" request.                                                                                                 |
| **Actors**            | Account owner; Customer; Sales admin; Finance (credit check if configured).                                                                                                      |
| **Applications**      | CRM, Sales, Documents, Finance, Notifications.                                                                                                                                   |
| **AI Agents**         | CRM Agent (account setup, hierarchy, contact records); Documents Agent (welcome pack, contract folder); Sales Agent (initial quote context); Finance Agent (credit/terms check). |
| **Approval points**   | Contract terms/credit limits = Consequential (Finance/Sales Admin); discount beyond policy = approval.                                                                           |
| **Events generated**  | `CustomerAdded`, `ContactCreated`, `AccountOwnershipChanged`, `DocumentShared`, `DealCreated`                                                                                    |
| **Expected result**   | Customer account complete with hierarchy and contacts; welcome pack shared; terms set; handoff to sales pipeline ready.                                                          |
| **Failure scenarios** | Duplicate customer (EC-8 → merge proposal); missing credit info (→ pause for Finance); external email to customer without approval (blocked, BR-13).                             |

### 11.6 WRK-6 — Purchase Approval / Requisition-to-PO (⇔ PRD BW-4)

| Field                 | Specification                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | Requisition submitted (chat: "order 50 laptops for onboarding") or `RequisitionCreated` from Inventory reorder.                                                                                   |
| **Actors**            | Requester; Approver(s) by value tier (1-level / 4-eyes); Buyer; Vendor (external, portal); Finance.                                                                                               |
| **Applications**      | Procurement, Finance (budget), Inventory (receipts), Documents (contracts), Notifications.                                                                                                        |
| **AI Agents**         | Procurement Agent (validate, route, create PO, vendor check); Finance Agent (budget check); Inventory Agent (receipt anticipation).                                                               |
| **Approval points**   | Requisition (per tier); PO above threshold = Consequential (4-eyes); any new vendor onboarding = Vendor Admin approval.                                                                           |
| **Events generated**  | `RequisitionCreated` → `RequisitionApproved` → `PurchaseOrderCreated` → `PurchaseApproved` → `PurchaseOrderSent` → `ReceiptRecorded`                                                              |
| **Expected result**   | Budget-validated requisition approved within SLA; PO sent to vendor; receipt creates inbound stock expectation; three-way match queued for Finance.                                               |
| **Failure scenarios** | Budget insufficient (→ EAO proposes alternatives/split approval, EC-11); duplicate vendor (→ merge proposal); approval timeout (EC-4); vendor portal unavailable (→ PO emailed with audit, ER-5). |

### 11.7 WRK-7 — Invoice Generation (⇔ PRD BW-5 tail + BW-7)

| Field                 | Specification                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | `DealWon` with billing terms, or milestone reached with billing, or manual "generate invoice" request.                                                                    |
| **Actors**            | Finance Preparer; Finance Approver; Customer (external); Sales (context).                                                                                                 |
| **Applications**      | Finance, Sales, CRM, Documents, Analytics, Notifications.                                                                                                                 |
| **AI Agents**         | Finance Agent (invoice creation, amount verification); Sales Agent (order linkage); Documents Agent (attach invoice PDF).                                                 |
| **Approval points**   | Invoice issue = Configurable (typically auto-approved within policy); **payment** = Consequential (always approved); credit-note/significant adjustments = Consequential. |
| **Events generated**  | `InvoiceGenerated` → `InvoiceApproved` → `NotificationSent` (customer) → `InvoicePaid`                                                                                    |
| **Expected result**   | Invoice created from verified order/billing data, approved, delivered to customer, recorded with references to the deal.                                                  |
| **Failure scenarios** | Billing terms missing (→ pause for Sales); amount mismatch vs order (→ verification failure, ER-3); customer email blocked (→ manual delivery flagged).                   |

### 11.8 WRK-8 — Document Approval

| Field                 | Specification                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | Document submitted for approval (`DocumentUploaded` with `status=PendingApproval` or explicit request).                                                                       |
| **Actors**            | Author; Reviewer(s); Approver(s) per document type; (optionally) Auditor.                                                                                                     |
| **Applications**      | Documents, Knowledge Base (if publishing), Notifications.                                                                                                                     |
| **AI Agents**         | Documents Agent (draft, compliance check against templates); KB Agent (if publishing a policy).                                                                               |
| **Approval points**   | Configurable chain per document type (e.g., contracts = Legal + Finance = 4-eyes).                                                                                            |
| **Events generated**  | `DocumentUploaded` → `DocumentApproved` / `DocumentRejected`; `KnowledgeUpdated` (if published)                                                                               |
| **Expected result**   | Document approved/rejected with reasons; approved versions become the authoritative version for downstream use (BR-12).                                                       |
| **Failure scenarios** | Reviewer on leave (→ reassign per policy, EC-4 timeout); two approvers edit concurrently (EC-9 version conflict → merge prompt); sensitive content in wrong workspace (BR-7). |

### 11.9 WRK-9 — Expense Reimbursement

| Field                 | Specification                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | Expense submitted (chat: "reimburse my $48 taxi from the airport") or `ExpenseSubmitted`.                                                                                                |
| **Actors**            | Employee; Manager; Finance Approver; (payment executor).                                                                                                                                 |
| **Applications**      | Finance, Notifications (+ Documents for receipts).                                                                                                                                       |
| **AI Agents**         | Finance Agent (capture, policy check, currency, duplicate detection); Documents Agent (receipt attach).                                                                                  |
| **Approval points**   | Expense within policy → Manager approval (Configurable); above threshold or out-of-policy → Finance approval; **payment** = Consequential.                                               |
| **Events generated**  | `ExpenseSubmitted` → `ExpenseApproved` / `ExpenseRejected` → (payment) `PaymentScheduled`                                                                                                |
| **Expected result**   | Expense validated against policy, approved with reason, queued for payment, employee notified; policy citation included in the explanation.                                              |
| **Failure scenarios** | Receipt missing (→ flagged, policy requires receipt above threshold); duplicate expense (EC-8); approval timeout (EC-4); out-of-policy item (→ explanation + reject or exception route). |

### 11.10 WRK-10 — Leave Approval

| Field                 | Specification                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | Leave request (chat or form) or `LeaveRequested`.                                                                                                                                                       |
| **Actors**            | Employee; Manager (approver); (HR for policy exceptions); Calendar (out-of-office).                                                                                                                     |
| **Applications**      | HR, Calendar, Notifications (+ Projects for coverage awareness).                                                                                                                                        |
| **AI Agents**         | HR Agent (balance check, policy check, propose coverage); Calendar Agent (out-of-office).                                                                                                               |
| **Approval points**   | Manager approval (Configurable, usually required); HR approval only for policy exceptions.                                                                                                              |
| **Events generated**  | `LeaveRequested` → `LeaveApproved` / `LeaveRejected`; `EventCreated` (OOF)                                                                                                                              |
| **Expected result**   | Balance verified, coverage proposed, approval/rejection with reason, OOF set, calendar updated.                                                                                                         |
| **Failure scenarios** | Insufficient balance (→ reject with explanation or unpaid option); manager is requester (SoD — routes to backup approver, EC-10); leave overlaps with project milestone (→ flags conflict for manager). |

### 11.11 WRK-11 — Sales Pipeline (opportunity → order) (⇔ PRD BW-5)

| Field                 | Specification                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | "Move Acme's deal to Closed Won and create the order" or `DealStageChanged`.                                                                             |
| **Actors**            | Sales Rep (owner); Sales Manager (discount approval); Finance; Customer.                                                                                 |
| **Applications**      | CRM, Sales, Finance, Inventory (availability), Documents (contract), Notifications.                                                                      |
| **AI Agents**         | CRM Agent (deal update, activity log); Sales Agent (quote from pricebook, order creation); Finance Agent (credit check); Inventory Agent (availability). |
| **Approval points**   | Deal stage change = Configurable (owner confirm); discount beyond policy = Consequential (Manager); order = Consequential (Finance/credit).              |
| **Events generated**  | `DealStageChanged` → `DealWon` → `QuoteCreated` → `QuoteApproved` → `OrderCreated` → (later) `InvoiceGenerated`                                          |
| **Expected result**   | Pipeline accurately updated; order created from approved quote; Finance notified for invoicing; forecast refreshed.                                      |
| **Failure scenarios** | Pricebook item missing (→ pause for Sales Admin); credit check fails (→ route to Finance decision); customer on hold (→ workflow blocks with reason).    |

### 11.12 WRK-12 — Inventory Replenishment (⇔ PRD BW-6)

| Field                 | Specification                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | `ReorderProposed` (stock at/below reorder point) or scheduled review.                                                                               |
| **Actors**            | Inventory Manager; Buyer/Procurement; Approver (per value); (Finance).                                                                              |
| **Applications**      | Inventory, Procurement, Finance, Analytics, Notifications.                                                                                          |
| **AI Agents**         | Inventory Agent (quantity proposal from demand + lead time); Procurement Agent (requisition/PO); Analytics Agent (demand context).                  |
| **Approval points**   | Reorder above threshold = Consequential (approved); below threshold = Configurable (auto-approve under rules).                                      |
| **Events generated**  | `ReorderProposed` → `RequisitionCreated` → `PurchaseApproved` → `ReceiptRecorded` → `StockAdjusted`                                                 |
| **Expected result**   | Correct quantities proposed and ordered within SLA; stockout risk mitigated; receipts update stock automatically.                                   |
| **Failure scenarios** | Demand spike data missing (→ uses conservative default + flags); vendor lead time exceeded (→ escalation); stock already on order (→ dedupe, EC-8). |

### 11.13 WRK-13 — Knowledge Search & Answers (⇔ PRD BW-8)

| Field                 | Specification                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | Any question ("What's our expense policy for flights?") in any Workspace.                                                                                                               |
| **Actors**            | Any member; (KB Editor if follow-up drafting is requested).                                                                                                                             |
| **Applications**      | Knowledge Base, Documents, (all Apps' data for answers), Analytics (for data questions).                                                                                                |
| **AI Agents**         | EAO (routing); KB Agent (RAG answer); Analytics Agent (data answers); Documents Agent (draft/update request).                                                                           |
| **Approval points**   | None for answers (Read-only). Drafting/publishing new or changed content = Document/KB approval (WRK-8).                                                                                |
| **Events generated**  | `AnswerGenerated`, `KnowledgeUpdated` (if content changed after approval)                                                                                                               |
| **Expected result**   | Grounded answer with citations and drill-down (FR-6); option to escalate to drafting a policy update.                                                                                   |
| **Failure scenarios** | No source found (→ says so, offers search suggestions — no fabrication, BR-7); content conflict (EC-7); user lacks access to the source (→ answers from accessible sources only, BR-7). |

### 11.14 WRK-14 — Executive Reporting (⇔ PRD BW-7 tail)

| Field                 | Specification                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | Scheduled (monthly/quarterly) or requested ("give me the Q2 board pack").                                                                                   |
| **Actors**            | Executive; Finance/Analytics; (board audience — read-only share).                                                                                           |
| **Applications**      | Analytics, Finance, Projects, CRM, Sales, Documents, Notifications.                                                                                         |
| **AI Agents**         | Analytics Agent (report assembly, narration); Finance Agent (close data); Projects Agent (status); CRM/Sales (pipeline); Documents Agent (deck generation). |
| **Approval points**   | Report publication/share = Configurable (approver per policy); nothing else is consequential (read-only assembly).                                          |
| **Events generated**  | `ReportGenerated`, `KpiThresholdBreached`, `DocumentUploaded` (deck), `NotificationSent`                                                                    |
| **Expected result**   | Narrated, sourced report across apps; every figure traceable; delivered to the audience with access control.                                                |
| **Failure scenarios** | Data source stale (→ flagged, not silently used); KPI undefined (→ asks to define); figures conflict between apps (→ reconciliation prompt, EC-7).          |

### 11.15 WRK-15 — AI Workflow Execution (meta-workflow: how the AI executes any workflow)

This is the **generic execution contract** that every workflow above follows.

| Field                 | Specification                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**           | Any conversational request, scheduled trigger, or domain event matching a template.                                                                                                           |
| **Actors**            | Invoking user (authority source); approvers (per plan); agents (executors).                                                                                                                   |
| **Applications**      | AI Platform (all AIX components); any Apps touched by the plan.                                                                                                                               |
| **AI Agents**         | EAO (plan/coordinate); application agents (per plan); Reasoner (verify).                                                                                                                      |
| **Approval points**   | Per plan, driven by side-effect class (BR-13): Consequential always; Configurable per policy; Routine none.                                                                                   |
| **Events generated**  | `OrchestrationPlanProposed` → `OrchestrationPlanApproved` → `AgentExecuted` (×n) → `WorkflowCompleted` / `WorkflowFailed`                                                                     |
| **Expected result**   | Intent → verified outcome with full explanation, sources, and audit trail; if not completable, a clear explanation + fallback (manual mode) (ER-§14).                                         |
| **Failure scenarios** | All error classes in §14: intent ambiguity, permission loss mid-flight (EC-1), agent unavailable (ER-4), integration failure (ER-5), concurrent modification (EC-9), duplicate intent (EC-8). |

### 11.16 Workflow design invariants (apply to all WRK-*)

1. Every workflow has a named owner and an escalation SLA (PRD §16.9).
2. Consequential steps always require approval; approval logic changes require template re-review (PRD §16.9).
3. Every workflow can be run manually via the deterministic UI (FR-8).
4. Every workflow emits a complete Workflow Timeline (OBS-4) and full audit (AUD).
5. Workflows are versioned; versions are immutable once published (FR-23).

---

## 12. Business Rules

Realizes: PRD FR-20/21, AI-12, §14.3, §16.9. Rules are grouped; each is a **shall** statement. Agents and Apps must enforce these rules; the permission and policy engines enforce the security-class rules regardless of App behavior.

### 12.1 Identity, organization & workspace

| ID   | Rule                                                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-1 | Employees shall not belong to deleted or archived Departments; archiving a Department reassigns or flags its members first (EC-3).           |
| BR-2 | Projects shall have an owner (named Project Manager) before activation; creation without an owner shall fail with explanation.               |
| BR-3 | A Workspace shall not be archived while it owns active workflows or unfinalized approvals; archiving requires explicit confirmation (WS-R5). |
| BR-4 | Deactivating a user shall immediately revoke all permissions and agent authority, including mid-workflow (EC-1).                             |

### 12.2 Records & data integrity

| ID    | Rule                                                                                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-5  | Invoices shall reference an existing customer; invoice creation without a customer shall fail (per user example).                                                                   |
| BR-6  | Purchase orders shall reference an approved requisition (or an authorized direct-buy path) and a budget check result.                                                               |
| BR-7  | Knowledge Base retrieval shall never expose content the requesting user cannot read; answers shall be grounded only in accessible, approved sources (AIX-6).                        |
| BR-8  | Guests and external users (Vendors/Customers) shall have read-only, time-boxed, record-scoped access only (USR-9/10/11).                                                            |
| BR-9  | Duplicate detection shall run before record creation for Employees, Customers, Vendors, Items, and Projects; duplicates surface as merge proposals, never silent duplicates (EC-8). |
| BR-10 | Budget enforcement: no commitment (PO, order, spend) shall exceed available budget unless explicitly authorized by an approver with that authority (L6).                            |
| BR-11 | Negative stock adjustments and stock writes shall require approval (Consequential class).                                                                                           |
| BR-12 | The **authoritative version** of a document is its latest approved version; unapproved drafts shall never be used as grounding or contractual input (WRK-8).                        |

### 12.3 Approvals & AI

| ID    | Rule                                                                                                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-13 | AI (and any automation) shall not perform Consequential actions (money, people, contracts, deletion, external commitments/communication) without human approval; this shall not be configurable away or learned around (PRN-2, AIX-11). |
| BR-14 | Prohibited actions (per tenant policy) shall be refused by agents with an explanation; agents shall never plan around a Prohibited action (AIX-3).                                                                                      |
| BR-15 | An approval binds to the specific proposed action + inputs; it never becomes a blanket authorization for future actions (AIX-11).                                                                                                       |
| BR-16 | Agent-accessible Administration skills shall require admin-level confirmation regardless of autonomy tier (APP-13).                                                                                                                     |
| BR-17 | Leave requests shall respect balances and policy; insufficient balance shall not be auto-approved (WRK-10).                                                                                                                             |
| BR-18 | No approval shall be granted by an approver lacking authority, after their authority ends, or by a user acting on their own request (SoD, PRM-6, EC-1/10).                                                                              |

---

## 13. Edge Cases

Realizes: PRD §16 edge-case notes, §20 quality bars. For each case: **scenario → required behavior**. All behavior below is v1-mandatory.

| ID    | Edge case                                                   | Required behavior                                                                                                                                                                                                                                          |
| ----- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EC-1  | **User loses permissions during a running workflow**        | In-flight steps are re-checked at execution time (USR-R2). Steps the user can no longer authorize are paused and routed to the next authorized approver or the Workspace Admin with explanation; already-completed steps are preserved and audited (BR-4). |
| EC-2  | **Employee transferred to another Workspace**               | HR Agent updates membership; in-flight onboarding/offboarding tasks re-scope to the new Workspace with owner notification; knowledge and document access re-evaluated; audit notes the transfer reason.                                                    |
| EC-3  | **Company disables an App (APP-05 lifecycle)**              | Disabling App X: no new workflows invoking X start; in-flight workflows pause at the boundary of X with an escalation to the workflow owner; templates referencing X are quarantined (FR-14, §5.5); data retained; re-enable resumes.                      |
| EC-4  | **Approval timeout**                                        | SLA timer expires → first reminder, then escalation to the approver's manager or backup per chain config; after final escalation, the workflow pauses with status `AwaitingManualAction` — never auto-approves (FR-24, AIX-11).                            |
| EC-5  | **AI agent unavailable**                                    | EAO retries per policy (ER-2); if the agent stays unavailable, workflow pauses and surfaces the deterministic UI equivalent (FR-8) so the human can complete the step manually; other workflows unaffected (NFR-13).                                       |
| EC-6  | **Knowledge conflict** (two sources contradict)             | Answering refuses to assert either version; surfaces the conflict with both sources and timestamps, and offers to escalate to the KB owner for resolution (WRK-13).                                                                                        |
| EC-7  | **Duplicate records** (person/customer/vendor/item)         | Duplicate detection triggers a merge proposal showing confidence + fields; merge requires approval (Consequential for people/customers); audits the merged pair (BR-9).                                                                                    |
| EC-8  | **Concurrent approvals of the same item**                   | First decision wins; later approvals are recorded as `superseded` and never change state; the requester sees one outcome (AIX-11).                                                                                                                         |
| EC-9  | **Concurrent edits to the same record**                     | Last-writer-wins is never silent for records with workflow dependency: conflict is detected, both versions retained, and the workflow pauses with a choice prompt (documents: version merge, WRK-8).                                                       |
| EC-10 | **Approver is also the requester** (SoD conflict)           | The request routes to the configured backup/second approver; if none exists, the Workspace Admin is notified — never self-approved (PRM-6, BR-18).                                                                                                         |
| EC-11 | **Budget exceeded mid-workflow**                            | The step is blocked with an explanation; EAO proposes alternatives (split approval, re-scope, defer) and routes to the authorized approver (BR-10, WRK-6).                                                                                                 |
| EC-12 | **Company suspended mid-execution**                         | Workflows pause; agents stop; audit remains readable; upon reactivation, paused workflows resume from their journal (FR-26, CO-B3).                                                                                                                        |
| EC-13 | **Integration (connector) down**                            | The step is idempotently retried (ER-2); after the threshold, the workflow pauses with a manual-mode fallback; no cascading failures (NFR-13, ER-5).                                                                                                       |
| EC-14 | **Guest/external user's access window expires mid-session** | Their session loses access at the next request; no data remains cached client-side beyond the platform's standard session handling; audit records the expiry.                                                                                              |
| EC-15 | **User repeats the same request twice**                     | Idempotency: the second request detects the first is in-flight/completed and offers to view its status instead of duplicating (EVT-G1, ER-2).                                                                                                              |
| EC-16 | **Data residency violation attempt**                        | Moving/exporting data outside the configured region is blocked at the policy layer with explanation and audit; no workaround via AI (NFR-10, FR-35).                                                                                                       |

---

## 14. Error Handling (product behavior)

Realizes: PRD FR-13, NFR-13, §18.3. **No code — behavior only.**

### 14.1 Error taxonomy & response

| ID   | Error class                                                     | Product behavior                                                                                                                                             |
| ---- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ER-1 | **Intent failure** (cannot understand / low confidence)         | Asks 1–2 clarifying questions (FR-5); after exhaustion, offers search + manual UI with a clear "I couldn't understand" response — never a guessed action.    |
| ER-2 | **Transient step failure**                                      | Idempotent steps are retried with backoff per policy; non-idempotent steps never auto-retry — they surface for human decision (FR-13).                       |
| ER-3 | **Verification failure** (action reported but state unverified) | Reported as unverified, never as done; the workflow pauses; user can inspect, re-run verification, or fix manually (AIX-4, PRD AI-6).                        |
| ER-4 | **Agent or tool unavailable**                                   | Graceful pause with manual fallback (deterministic UI); other workflows unaffected (NFR-13); AI Monitoring alerted (EC-5).                                   |
| ER-5 | **Integration/connector failure**                               | Isolated to the workflow using it; retry with idempotency; after threshold, workflow pauses + escalates to owner and integration health is flagged (NFR-13). |
| ER-6 | **Approval flow failure**                                       | Timeouts escalate (EC-4); rejections follow the defined rejection path with reason preserved; orphaned approval requests are cancelled and notified.         |
| ER-7 | **Concurrency/conflict failure**                                | Conflict detected, both versions preserved, workflow pauses with a choice prompt (EC-9); no silent data loss.                                                |
| ER-8 | **Unrecoverable failure**                                       | Workflow enters `Failed` with full explanation + audit; user can retry, run manually, or report the issue; failure telemetry feeds AI Monitoring (AIX-19).   |

### 14.2 General error-handling guarantees

1. **Never silent:** every failure is visible in the Workflow Timeline, the conversation, and observability surfaces.
2. **Never destructive:** errors never cause data loss; partial progress is journaled and resumable (FR-26).
3. **Containment:** a failing step/agent/integration never affects unrelated workflows (NFR-13).
4. **Fallback to human:** when automation cannot proceed, a human always has a manual path (FR-8).
5. **Undo support:** reversible actions expose undo/rollback where the domain permits (PRD §18.2 reversal metric); irreversible actions remain behind approval (BR-13).

---

## 15. Auditability

Realizes: PRD FR-33/34/36, NFR-8, PRN-5/10.

### 15.1 Audit record anatomy (every logged action)

| Field                | Definition                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `auditId`            | Unique audit record ID                                                                                                                     |
| **What is logged**   | The action verb + resource class + target record + before/after state references + result                                                  |
| **Who performed it** | `user:…`, `agent:…` (with invoking user), `system:…`, or `external:…`; for agents, the invoking user is always recorded                    |
| **AI participation** | Whether AI generated, proposed, or executed the action; the plan ID and prompt version used (AIX-13)                                       |
| **Timestamp**        | Event time (UTC, monotonic)                                                                                                                |
| **Approval history** | The full chain: who approved, when, with what inputs, at what approval instance (AUD-5)                                                    |
| **Reason**           | The reason captured at the time (user-supplied reason for approvals/rejections; policy reference for refusals; explanation for AI actions) |
| **Scope & trace**    | `companyId`, `workspaceId`, `correlationId`, `traceId`                                                                                     |

### 15.2 Audit rules

| ID    | Rule                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-1 | Every user action, agent action, approval, refusal, data access, and configuration change shall produce an audit record (PRD FR-33).              |
| AUD-2 | The audit log shall be **append-only and tamper-evident** (NFR-8); no user or admin role can edit or delete records (only retention-expire them). |
| AUD-3 | AI context assembly (what was fed to the model) shall be logged for every generated decision (AIX-12).                                            |
| AUD-4 | AI actions shall record plan ID, prompt version, sources cited, and verification evidence (AUD-1 + AIX-17).                                       |
| AUD-5 | Approvals shall record the exact proposed action + inputs + approver + decision + reason; superseded approvals are preserved and flagged (EC-8).  |
| AUD-6 | Audit export shall be machine-readable and scheduled per Company policy (FR-34, NFR-8).                                                           |
| AUD-7 | Retention is configurable per Company (7-year default), with data-residency constraints honored in exports (NFR-10).                              |
| AUD-8 | Auditors hold read-only access to audit records and cannot be excluded from their own audit.                                                      |

---

## 16. Observability

Realizes: PRD FR-27/29, NFR-15, §18.3.

| ID    | Surface               | Behavior specification                                                                                                                                                                                                                                                                                                              |
| ----- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OBS-1 | **Notifications**     | Every approval task, escalation, workflow completion/failure, and exception generates a notification via the Notifications App (APP-12). Channels (in-app, email, chat) and frequency are per-user preferences (FR-27); notifications are actionable with full context (FR-28). Users can snooze, batch, and configure quiet hours. |
| OBS-2 | **Activity Timeline** | Per-user feed of their own actions and AI actions taken on their behalf, with links to records and audit records. Users can always answer "what did the system do for me today?". Filterable by date, app, and AI-involvement.                                                                                                      |
| OBS-3 | **AI Timeline**       | Per-conversation chronological view of AI behavior: intent parsed, clarifications, plan proposed, approvals granted/rejected, actions executed, verification results, final response (driven by AIX-16/17). The definitive "why did the AI do X" view.                                                                              |
| OBS-4 | **Workflow Timeline** | Per-execution view of a workflow run: triggers, steps, owners, approvals, events emitted, delays, escalations, retries, failure points. Supports replay analysis and is exportable for support.                                                                                                                                     |
| OBS-5 | **Execution History** | Queryable, searchable history of all workflow runs and agent executions across the Company (scoped per role): status, duration, agent, app, cost, success rate. Feeds Automation Value analytics (PRD §18.1) and AI Monitoring dashboards (AIX-19).                                                                                 |

**Cross-cutting:** all observability surfaces respect permissions (a user sees only what their roles allow), and all are traceable to audit records (AUD).

---

## 17. Version 1 Scope & Out of Scope

Realizes: PRD §20 (MVP). V1 = PRD MVP scope, formalized. Platform elements required to support it (AI platform, events, Workspaces, audit) are in scope as core.

### 17.1 In scope (V1)

**Platform core**

- V1-1. Multi-Company SaaS with logical isolation; Company + Workspace provisioning (FR-1/2/3; §3–4)
- V1-2. Conversational console with plan-preview + confirm flow; Work Inbox; notifications (in-app + email) (FR-4…8, 27–29)
- V1-3. AI Platform: all 19 AIX components; autonomy tier = **Confirm** default (Assist offered); Consequential-approval guarantee (AIX-11, BR-13)
- V1-4. Event Model: Event Broker, catalog EVT-*, at-least-once + idempotent consumption + replay (FR-32, §8)
- V1-5. Identity: SSO (SAML/OIDC), MFA, SCIM baseline; 6-level permission model; policy engine; audit (AUD) (FR-18/19/20/21, 33/34/35/36)
- V1-6. App lifecycle for the v1 App set: install/update/uninstall/disable per Workspace; permission review (FR-14/15/17)

**Applications (v1)**

- V1-7. HR (APP-01), Projects (APP-02), Documents (APP-08), Knowledge Base (APP-11); system Apps Notifications (APP-12) and Administration (APP-13)

**Workflows (v1)**

- V1-8. WRK-1 (Hire & Assign), WRK-2 (Onboarding), WRK-3 (Offboarding), WRK-13 (Knowledge Answers) as flagship flows; the PRD §20.2 "10 starter templates" set includes project creation (WRK-4) and document approval (WRK-8) in lightweight template form

**Integrations (v1, minimal)**

- V1-9. Email (notifications + inbound email actions); webhooks out; REST API for platform records (FR-38 baseline)

### 17.2 Out of scope (V1 → V1.1 / Phase 1+)

- **V1-10.** Domain Apps: CRM, Finance, Sales, Inventory, Procurement, Analytics, Calendar (Phase 1, PRD §20.3). Their specs (§6.3–6.10) are ready and frozen for Phase 1 delivery.
- **V1-11.** Chat integrations (Slack/Teams), mobile apps (Phase 1)
- **V1-12.** No-code workflow designer beyond template editing; public App SDK (Phase 2)
- **V1-13.** Proactive assistants, learning loop, autonomy tier 4 (Phase 2, PRD §17)
- **V1-14.** VPC/on-prem deployment, HIPAA support, full BI/data warehouse (Phase 2/3, PRD NG-5)
- **V1-15.** Cross-Company (B2B) workflows and events (Phase 3)
- **V1-16.** Payroll tax engines, legal/compliance engines (integrations only, PRD NG-6/7)

**V1 exit criteria:** PRD §20.4 (MVP success criteria) plus audit completeness and Consequential-approval enforcement at 100% in pilot tenants.

---

## 18. Consistency & Traceability with the PRD

This section records how the PSD preserves the PRD's vision and where it deliberately extends or resolves ambiguities.

### 18.1 Direct mappings (unchanged concepts)

| PRD concept                        | PSD location                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| Vision, problem, philosophy intent | §2 (Product Overview); principles consolidated, no contradiction                    |
| FR-1…FR-39                         | Realized across §3–§16 (referenced inline)                                          |
| NFR-1…NFR-15                       | Carried forward; referenced where behavioral (§15, §16, §7.19)                      |
| AI-1…AI-12                         | Decomposed into the 19 AIX components (§7) — no new capabilities, explicit behavior |
| BW-1…BW-8                          | Expanded into WRK-1…WRK-15 with the full 8-field template (§11)                     |
| User personas (P1–P13)             | Preserved; operationalized via roles (§9–10)                                        |
| Customer segments & company types  | Preserved; enabled via App selection + Workspace types (§3, §6)                     |
| Global + App roles (§14)           | Preserved as L1/L3 with Workspace (L2) refinement (§10)                             |
| MVP scope (§20)                    | Formalized as V1 scope (§17)                                                        |

### 18.2 Extensions introduced by this specification (with rationale)

| New concept                                        | Rationale (why it preserves the vision)                                                                                                                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Organization** (optional multi-Company grouping) | Supports groups/multi-brand enterprises without weakening tenant isolation (FR-1); default installs unaffected.                                                                                                            |
| **Workspace model**                                | Refines tenant-internal scoping (PRD §14.3-2 "department" and Risk R2 pilot-in-a-department) into a first-class container that owns apps, agents, permissions, knowledge, and workflows. Adds no cross-tenant surface.     |
| **System Apps** (Notifications, Administration)    | Realizes PRN-3 (Everything Is An App) while keeping the PRD's Notifications hub and Admin console (PRD §11.1) as platform-provided capability.                                                                             |
| **App Contract** (frozen)                          | Makes PRD FR-16 (future apps without platform changes) a hard, checkable constraint.                                                                                                                                       |
| **Event Model** (Event Broker + catalog)           | Formalizes PRD §13.2 ("defined interfaces and events") and FR-32; the coordination rule (§8.1) keeps the Orchestrator as the actor, so this extends rather than contradicts PRD §13.2's "never point-to-point automation". |
| **AI platform decomposition** (19 AIX components)  | PRD §12 responsibilities (intent, plan, execute, verify, explain, guardrail) are specified as named components with behavior — an ambiguity-removal, not a scope change.                                                   |
| **Autonomy tiers + side-effect classes**           | Makes PRD AI-12 (Consequential always requires approval) and §12.3 tiers operational.                                                                                                                                      |

### 18.3 Ambiguities resolved

| Ambiguity in PRD                                                          | Resolution in this document                                                                                            |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| "Tenant" vs "Company" usage                                               | Tenant ⇔ Company; Workspaces sit inside (§3, §4).                                                                      |
| Where Notifications/Admin live (platform features, §11.1)                 | System Apps APP-12/13, always present, uninstallable-only-by-design (§6.12–6.13).                                      |
| "Skill registry" (§12.1) vs "Agent Registry" (FR-9)                       | Agent Registry owns agents + Skills; Tool Registry owns executable tools; Planner plans in terms of Skills (§7.7–7.8). |
| Cross-App communication phrasing (§13.2)                                  | Events for awareness/triggers; Orchestrator-dispatched agents for actions (§8.1).                                      |
| MVP "3 apps (HR, Projects, Documents) + KB" (§17) vs 11-app catalog (§13) | v1 ships the MVP set; all 13 App specs are frozen so Phase 1 apps drop in (§6, §17).                                   |

### 18.4 PRD requirements with no behavioral change

FR-1…FR-8, FR-11, FR-18, FR-25, FR-27, FR-30, FR-37, NFR-1…NFR-12 are realized as-is; the PSD only adds the behavioral detail needed for implementation.

---

## Appendix A — ID Index (normative)

| Prefix  | Meaning               | Range |
| ------- | --------------------- | ----- |
| PRN     | Product principle     | 1–15  |
| CO / WS | Company / Workspace   | 1–n   |
| APP     | Application           | 01–13 |
| AIX     | AI platform component | 1–19  |
| EVT     | Event                 | 1–36  |
| USR     | User model entity     | 1–11  |
| PRM     | Permission rule       | 1–10  |
| WRK     | Workflow              | 1–15  |
| BR      | Business rule         | 1–18  |
| EC      | Edge case             | 1–16  |
| ER      | Error-handling class  | 1–8   |
| AUD     | Audit rule            | 1–8   |
| OBS     | Observability surface | 1–5   |
| V1      | Version-1 scope item  | 1–16  |

## Appendix B — Workflow ↔ PRD traceability

| PSD    | PRD                  | Notes                                         |
| ------ | -------------------- | --------------------------------------------- |
| WRK-1  | BW-1                 | Flagship; expanded with 4-eyes approval chain |
| WRK-2  | BW-2                 | Event-triggered formalized                    |
| WRK-3  | BW-3                 | Deliberate permission-loss handled (EC-1/2)   |
| WRK-4  | — (starter template) | Project creation from Projects App            |
| WRK-5  | — (new)              | Customer onboarding                           |
| WRK-6  | BW-4                 | Purchase-to-pay; value tiers                  |
| WRK-7  | BW-5 tail, BW-7      | Invoice generation                            |
| WRK-8  | — (new)              | Document approval                             |
| WRK-9  | — (new)              | Expense reimbursement                         |
| WRK-10 | — (new)              | Leave approval                                |
| WRK-11 | BW-5                 | Sales pipeline                                |
| WRK-12 | BW-6                 | Inventory replenishment                       |
| WRK-13 | BW-8                 | Knowledge search                              |
| WRK-14 | BW-7                 | Executive reporting                           |
| WRK-15 | FR-10, AI-3          | Meta-workflow: AI execution contract          |

---

_End of document — Nexora PSD v1.0. Next step: Architecture Design Document (technology choices are out of scope here)._
