/**
 * @nexora/module-lineage — evidence and lineage contracts (Prompt 6).
 *
 * The one principle: **evidence informs; it never grants authority.** An
 * evidence record is DATA about where a piece of information came from —
 * never an input to RBAC, delegation, policy or approval. Nothing in this
 * module is read by any authorization path; the records are written after
 * (and describe) trusted decisions.
 *
 * Records are APPEND-ONLY and tenant-scoped. They carry ids, versions,
 * timestamps and fingerprints — not raw documents, not secrets, and never
 * model reasoning. A source that changes later does not rewrite a record:
 * the historical record keeps the version and fingerprint that were true
 * when it was written.
 */

/** What kind of object a piece of evidence came from (only kinds that exist today). */
export type EvidenceSourceType =
  | 'KNOWLEDGE_ARTICLE'
  | 'DOCUMENT'
  | 'PROJECT'
  | 'EMPLOYEE'
  | 'BUDGET'
  | 'TOOL_RESULT'
  | 'WORKFLOW_RESULT'
  | 'INVESTIGATION'
  | 'EXTERNAL_CONNECTOR'
  /** A signed inbound email/webhook message (data from outside; never authority). */
  | 'INBOUND_MESSAGE';

/**
 * Descriptive trust class. It says what the evidence IS, and confers no
 * authority: a VERIFIED_TOOL_RESULT is a record of what a tool returned, not
 * permission for anything.
 */
export type EvidenceTrust =
  | 'SYSTEM_STATE'
  | 'VERIFIED_TOOL_RESULT'
  | 'PERSISTED_BUSINESS_RECORD'
  | 'KNOWLEDGE_CONTENT'
  | 'EXTERNAL_CONTENT'
  | 'USER_PROVIDED_CONTENT';

/** The kinds of lineage record. */
export type LineageKind =
  /** A piece of information a run retrieved (with source identity, version, fingerprint). */
  | 'EVIDENCE'
  /** What the planner intended to do, BEFORE approval or execution. */
  | 'PLANNED_ACTION'
  /** What a tool invocation actually did (outcome, fingerprints, policy, approval). */
  | 'EXECUTION'
  /** Whether the result of an execution was confirmed (distinct from executing). */
  | 'VERIFICATION'
  /** A typed edge between two ids (e.g. plan step ↔ run ↔ approval). */
  | 'LINK'
  /** A DERIVED conclusion (investigation finding / remediation basis) — never primary evidence. */
  | 'FINDING';

/** The persisted lineage record. */
export interface LineageRecord {
  /** `lin_…` */
  id: string;
  tenantId: string;
  workspaceId?: string;
  /** The run (orchestrator run id, MCP correlation id, workflow instance correlation…) the record belongs to. */
  runId: string;
  kind: LineageKind;
  /** ISO-8601 UTC. */
  occurredAt: string;
  /** Order within a run (monotonic per writer; ties broken by id). */
  seq: number;
  /** The initiating human. */
  actorId?: string;
  agentId?: string;
  delegationId?: string;
  approvalId?: string;
  /** The tool invocation the record describes (EXECUTION / VERIFICATION / EVIDENCE it produced). */
  invocationId?: string;
  /** What it is about: source type or tool id, and the exact source / resource id. */
  subjectType?: string;
  subjectId?: string;
  /** sha256 of the canonical structured facts (integrity, not secrecy). */
  fingerprint?: string;
  /** Compact structured facts; never secrets, raw documents, or reasoning. */
  data: Readonly<Record<string, unknown>>;
}

/** `data` of an EVIDENCE record. */
export interface EvidenceData {
  sourceType: EvidenceSourceType;
  sourceId: string;
  title?: string;
  /** The source's version at retrieval, when it has one. */
  sourceVersion?: number | string;
  /** When the source was last updated, when known. */
  sourceUpdatedAt?: string;
  retrievedAt: string;
  trust: EvidenceTrust;
  /** How it was obtained (`tool:knowledge.search`, `tool:projects.find_project`, …). */
  retrievalMethod: string;
  /** The tool result the evidence came out of. */
  toolId: string;
  /** For external evidence: the connector and its result status. */
  connector?: string;
  /** Marks evidence as DERIVED (an AI/deterministic conclusion) rather than primary. */
  derived?: boolean;
}

/**
 * How a verification was performed (mirrors the tool manifest's declared
 * `verification.source`; a source is never claimed unless the tool declared it).
 */
export type VerificationSource =
  'state_readback' | 'provider_readback' | 'response_shape' | 'handler_result' | 'redetection';

/**
 * The human who approved the action, recorded DESCRIPTIVELY on lineage. It is
 * never read by any authorization decision. `actorId` of the surrounding
 * record stays the REQUESTER; the approver never becomes the actor.
 */
export interface ApprovedBy {
  userId: string;
  roleId?: string;
  decidedAt?: string;
}

/** `data` of a PLANNED_ACTION record. */
export interface PlannedActionData {
  capabilityId: string;
  toolId: string;
  stepId: string;
  inputFingerprint: string;
  /** The policy decision made for the plan (before approval). */
  policy?: PolicyLink;
  requiresApproval: boolean;
  /** Who approved (resumed runs only); descriptive. */
  approvedBy?: ApprovedBy;
}

/** `data` of an EXECUTION record. */
export interface ExecutionData {
  capabilityId: string;
  toolId: string;
  origin: string;
  status: 'succeeded' | 'failed' | 'unverified';
  errorCode?: string;
  attempts: number;
  startedAt?: string;
  completedAt: string;
  inputFingerprint: string;
  outputFingerprint?: string;
  /** The business object a mutation created or changed (type + id), when the result names one. */
  affectedResource?: { type: string; id: string };
  policy?: PolicyLink;
  /** Workflow attribution (step lineage / compensation). */
  workflow?: { instanceKey?: string; stepId?: string; purpose?: 'step' | 'compensation' };
  /** Who approved the action, when it ran under an approval; descriptive only. */
  approvedBy?: ApprovedBy;
}

/** `data` of a VERIFICATION record. */
export interface VerificationData {
  /** The EXECUTION's invocation id. */
  of: string;
  verified: boolean;
  /** Backward-compatible label; equals `source` for new records. */
  method: string;
  /** How the verification was performed (as declared by the tool). */
  source: VerificationSource;
  /** What the verification does not prove. */
  limitation?: string;
  /** Per-rule verifier outcomes. */
  checks?: readonly { ruleId: string; passed: boolean }[];
}

/** The policy decision a record is linked to (versions as recorded at decision time). */
export interface PolicyLink {
  outcome: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
  policyId: string;
  version: string;
  fingerprint: string;
  /** Digest of the trusted facts the decision was made over (budget state, config versions). */
  contextFingerprint?: string;
}

/** Filters for reading lineage (always tenant-scoped). */
export interface LineageQuery {
  workspaceId?: string;
  kind?: LineageKind;
  subjectType?: string;
  subjectId?: string;
  runId?: string;
  approvalId?: string;
  invocationId?: string;
  limit?: number;
}

/** The append-only lineage store. There is deliberately no update or delete. */
export interface LineageRepository {
  append(records: readonly LineageRecord[]): Promise<void>;
  /** Tenant-scoped; the workspace filter narrows further. Oldest first. */
  list(tenantId: string, query?: LineageQuery): Promise<readonly LineageRecord[]>;
}
