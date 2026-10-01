/**
 * @nexora/evaluation — the observation contract.
 *
 * What the runner SAW while driving the real platform for one scenario,
 * normalized so the pure evaluator ({@link evaluateScenario}) never depends
 * on transport details. Everything here comes from real API responses and
 * persisted state — the runner never infers an observation it did not see.
 */

/** One planned or executed step of an AI run / remediation plan. */
export interface ObservedStep {
  capabilityId: string;
  toolId?: string;
  /**
   * Normalized status: `succeeded` | `failed` | `blocked` | `skipped` |
   * `pending` (remediation `VERIFIED` → `succeeded`, `FAILED` → `failed`,
   * `AWAITING_APPROVAL` → `blocked`, `PENDING` → `pending`).
   */
  status: string;
}

/** One approval gate the platform opened. */
export interface ObservedApproval {
  id?: string;
  capabilityId: string;
  status: string;
  sideEffectClass?: string;
}

/** One retrieved grounding reference (knowledge search output). */
export interface ObservedReference {
  /** The document or article id (scope id). */
  sourceId: string;
  title: string;
  snippet: string;
}

/** One normalized Audit Center event. */
export interface ObservedAuditEvent {
  /** The organization key whose audit trail this came from. */
  organization: string;
  id: string;
  source: string;
  status: string;
  /** The capability, when the runner could correlate it through observed ids. */
  capabilityId?: string;
  /** Searchable text (object/action/detail) — used only for `mentions` matchers. */
  text: string;
}

/** One evaluated persisted-state check. */
export interface ObservedCheck {
  description: string;
  passed: boolean;
  actual: unknown;
}

/** One timed request. */
export interface ObservedTiming {
  label: string;
  durationMs: number;
}

/** Everything observed for one scenario. */
export interface ScenarioObservation {
  /** The platform's authorization decision for the primary request. */
  authorization: { outcome: 'allowed' | 'denied'; httpStatus: number; errorCode?: string };
  /** The AI run / plan status (`completed`, `blocked`, `failed`, `clarification`, plan statuses…). */
  runStatus?: string;
  /** Steps as PLANNED (before any decision). */
  plannedSteps: readonly ObservedStep[];
  /** Steps as finally observed (after any decision / advance). */
  finalSteps: readonly ObservedStep[];
  approvals: readonly ObservedApproval[];
  /** The approval decision call, when the scenario made one. */
  decision?: { decision: 'approve' | 'reject'; httpStatus: number; resultStatus?: string };
  /** Retrieved grounding references (undefined when no retrieval ran). */
  retrieval?: readonly ObservedReference[];
  /** The final narrated response (undefined when the request was refused before the AI). */
  response?: string;
  /**
   * Texts the response may legitimately rely on: the user message, retrieved
   * snippets, and tool outputs (serialized). The grounding checker treats a
   * claim as supported only when it appears in one of these.
   */
  groundingContext: readonly string[];
  verification: readonly ObservedCheck[];
  audit: readonly ObservedAuditEvent[];
  timings: readonly ObservedTiming[];
  /** Harness/fixture errors (a non-empty list makes the scenario an `error`). */
  errors: readonly string[];
}
