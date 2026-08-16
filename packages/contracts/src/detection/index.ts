/**
 * @nexora/contracts — proactive problem detection & business investigation
 * contracts (S27).
 *
 * The generic vocabulary of the detection layer, built on the S26 governed
 * execution foundation:
 *
 *   Business Signal → Problem → Investigation → Evidence → Solution
 *   Candidates → Recommendation → Action Proposal
 *
 * Every type here is SEPARATED — a signal is not a problem, a problem is not
 * a solution, and an inference is never presented as a fact. The engine that
 * consumes these types is domain-agnostic: it understands definitions, not
 * job titles, and role-specific behavior comes only from Domain/Role/
 * Capability/Signal-applicability/Agent definition — never from a
 * role-specific engine.
 *
 * Determinism contract (S27): signal detection thresholds are pure
 * configuration + deterministic evaluation. The LLM may explain a detected
 * condition but never decides whether a threshold was crossed, never decides
 * tenant/workspace/role/capability/authorization/approval, and never decides
 * the problem lifecycle.
 *
 * Security contract (S27): every problem/evidence/solution read is scoped by
 * the trusted tenant (+ workspace); forged ids, forged roles, forged
 * capabilities, and prompt injection all fail closed — never leak across
 * tenants, and never fabricate a solution.
 */

import type { ActionProposal } from '../agent/index.js';

export type { ActionProposal };

/** A stable, machine-readable signal id, e.g. `workflow_failure`. */
export type BusinessSignalId = string;

/**
 * The deterministic signal types of the S27 detection layer. A
 * `BusinessSignalDefinition` maps one type to its threshold config +
 * evaluator. New types register without touching the engine or the AI
 * Runtime.
 */
export type BusinessSignalType =
  | 'workflow_failure'
  | 'workflow_degradation'
  | 'project_attention'
  | 'onboarding_delay'
  | 'audit_completeness';

/** The explicit severity of a detected problem (controlled vocabulary). */
export type ProblemSeverity = 'low' | 'medium' | 'high';

/**
 * The explicit problem lifecycle. Transitions are driven by the detection
 * service (deterministic) — never by an LLM. `RESOLVED` is claimed ONLY
 * when a re-evaluation of the deterministic signal proves the condition is
 * gone — never as a promise about the future.
 */
export type ProblemStatus =
  | 'DETECTED'
  | 'INVESTIGATING'
  | 'UNDERSTOOD'
  | 'SOLUTION_FOUND'
  | 'NO_SOLUTION_FOUND'
  | 'ACTION_PROPOSED'
  | 'WAITING_FOR_APPROVAL'
  | 'RESOLVED';

/** A controlled, deliberately coarse confidence (never fake precision). */
export type ProblemConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

/** FACT = directly observed from persisted data; INFERENCE = derived. */
export type ProblemFactOrInference = 'FACT' | 'INFERENCE';

/** The source system an evidence item / solution candidate came from. */
export type DetectionSource =
  | 'measurements'
  | 'projects'
  | 'activity'
  | 'notifications'
  | 'workflow'
  | 'knowledge'
  | 'documents'
  | 'agent_executions'
  | 'integrations';

/**
 * One grounded evidence item: a FACT (or bounded INFERENCE) observed from a
 * real persisted source. Evidence always identifies its source + entity +
 * the relevant fact; it never stores secrets or copies entire documents.
 */
export interface ProblemEvidenceDto {
  /** Stable evidence id within the problem. */
  id: string;
  /** The source the evidence was read from. */
  source: DetectionSource;
  /** The affected entity kind, e.g. `workflow`, `project`. */
  entityType?: string;
  /** The persisted entity id. */
  entityId?: string;
  /** A human-readable entity title. */
  entityTitle?: string;
  /** The relevant fact (bounded display text — never a document copy). */
  fact: string;
  /** ISO-8601 UTC time the fact occurred, when known. */
  occurredAt?: string;
}

/** A root-cause candidate with an explicit FACT vs INFERENCE distinction. */
export interface RootCauseCandidateDto {
  /** The candidate's explanation (bounded display text). */
  explanation: string;
  /** Evidence ids within the problem that support this candidate. */
  supportingEvidenceIds: readonly string[];
  /** The controlled confidence (LOW/MEDIUM/HIGH — never fake precision). */
  confidence: ProblemConfidence;
  /** FACT (directly observed) vs INFERENCE (derived — never confirmed fact). */
  kind: ProblemFactOrInference;
  /** The entity the candidate concerns, when known. */
  affectedEntity?: { type: string; id: string; title: string };
  /** The suggested next investigation step (deterministic). */
  nextStep: string;
}

/**
 * The solution-applicability distinction: a solution can be FOUND but not
 * APPLICABLE. `FOUND` = retrieved from an existing source; `APPLICABLE` =
 * passes the deterministic applicability assessment (system/entity/scope/
 * capability match); `REJECTED` = found but assessed as not applicable.
 */
export type SolutionApplicability = 'FOUND' | 'APPLICABLE' | 'REJECTED';

/** A discovered solution candidate (existing knowledge first — never invented). */
export interface SolutionCandidateDto {
  /** Stable candidate id within the problem. */
  id: string;
  /** The source the candidate came from. */
  source: DetectionSource;
  /** The candidate title (e.g. the knowledge article title). */
  title: string;
  /** A bounded description of the known remediation. */
  description: string;
  /** The reference to the source (article/document/run id + title). */
  reference?: { id: string; title: string };
  /** The applicability assessment result. */
  applicability: SolutionApplicability;
  /** Why a candidate was rejected (only when not applicable). */
  rejectionReason?: string;
  /** The controlled confidence. */
  confidence: ProblemConfidence;
  /** The capabilities required to act on this solution. */
  requiredCapabilities: readonly string[];
}

/** The deterministic recommendation for a problem. */
export interface ProblemRecommendationDto {
  /** The grounded recommendation summary. */
  summary: string;
  /**
   * The governed action proposal when the top applicable solution implies an
   * actionable operation. Reuses the S26 ActionProposal — it flows into S26
   * governance (approval + execution). Phase 9 never executes automatically.
   */
  actionProposal?: ActionProposal;
  /** The solution candidate the recommendation is grounded in, when any. */
  groundedIn?: string;
}

/** A detected business problem with its full investigation. */
export interface BusinessProblemDto {
  /** Stable problem id, e.g. `prb_…`. */
  id: string;
  /** The deterministic correlation identity (dedupe key). */
  correlationId: string;
  /** The detected signal id. */
  signalId: BusinessSignalId;
  /** The signal display name. */
  signalName: string;
  /** The tenant (organization) scope. */
  tenantId: string;
  /** The verified workspace scope, when present. */
  workspaceId?: string;
  /** A human-readable problem title. */
  title: string;
  /** A grounded description (what happened + why it matters). */
  description: string;
  /** The explicit severity. */
  severity: ProblemSeverity;
  /** The lifecycle status. */
  status: ProblemStatus;
  /** ISO-8601 UTC time the problem was first detected. */
  detectedAt: string;
  /** ISO-8601 UTC time of the last lifecycle transition. */
  updatedAt: string;
  /** The affected entities (references, never copies). */
  affectedEntities: readonly { type: string; id: string; title: string }[];
  /** The grounded evidence. */
  evidence: readonly ProblemEvidenceDto[];
  /** The root-cause candidates (FACT vs INFERENCE separated). */
  rootCauses: readonly RootCauseCandidateDto[];
  /** The discovered solution candidates (existing knowledge first). */
  solutions: readonly SolutionCandidateDto[];
  /** The deterministic recommendation (+ governed action proposal). */
  recommendation?: ProblemRecommendationDto;
}
