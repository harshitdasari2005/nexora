/**
 * @nexora/ai-runtime — reasoning.
 *
 * The observable record of how the runtime reached a decision (AIR.md §7,
 * §14). Every record is captured at decision time (ADR-011) — never
 * reconstructed later — and folds into the canonical `ExplanationRecord`
 * from `@nexora/contracts/ai`.
 */

import type { ExplanationRecord } from '@nexora/contracts/ai';
import type { Timestamp } from '@nexora/contracts/common';

/** The kind of evidence behind a reasoning step. */
export type EvidenceKind = 'knowledge' | 'tool_result' | 'policy' | 'user' | 'capability';

/** A single piece of evidence behind a decision. */
export interface Evidence {
  /** Evidence kind. */
  kind: EvidenceKind;
  /** The source (knowledge item id, tool id, policy id, ...). */
  source?: string;
  /** A short snippet or summary for citation. */
  snippet?: string;
}

/** A confidence signal with its numeric score (0..1). */
export interface ConfidenceSignal {
  /** Signal name, e.g. `intent`, `verification`. */
  name: string;
  /** Signal score, 0..1. */
  score: number;
}

/** Confidence metadata attached to a reasoning outcome. */
export interface Confidence {
  /** Overall score, 0..1. */
  score: number;
  /** Per-signal breakdown when available. */
  signals?: readonly ConfidenceSignal[];
}

/** An alternative decision considered and its rationale. */
export interface AlternativeDecision {
  /** The alternative decision description. */
  decision: string;
  /** Reasons this alternative was considered. */
  reasons: readonly string[];
  /** Whether the alternative was rejected. */
  rejected: boolean;
}

/** A single stage of the reasoning pipeline (AIR.md §7). */
export interface ReasoningRecord {
  /** The reasoning stage id (intent, context, retrieval, planning, ...). */
  stage: string;
  /** The question or decision being reasoned about. */
  question: string;
  /** Evidence gathered at this stage. */
  evidence: readonly Evidence[];
  /** The outcome of the stage. */
  outcome: string;
  /** Confidence in the stage outcome, 0..1. */
  confidence?: number;
  /** ISO-8601 UTC time the stage completed. */
  completedAt: Timestamp;
}

/**
 * The decision-time record of an AI run (AIR.md §14 element 9). One record
 * per run; it is the substrate of the AI Timeline (OBS-3).
 */
export interface DecisionRecord {
  /** Decision id (`dec_...`). */
  id: string;
  /** Run id the decision belongs to. */
  runId: string;
  /** The user intent as understood. */
  intent: string;
  /** The decision taken (e.g. which plan was executed). */
  decision: string;
  /** Alternatives considered. */
  alternatives: readonly AlternativeDecision[];
  /** Reasons for the decision. */
  reasons: readonly string[];
  /** Confidence in the decision. */
  confidence: Confidence;
  /** The final outcome: completed / partial / unverified / failed / blocked. */
  outcome: 'completed' | 'partial' | 'unverified' | 'failed' | 'blocked';
  /** ISO-8601 UTC time the decision was made. */
  madeAt: Timestamp;
}

/** Inputs to {@link buildExplanationRecord}. */
export interface BuildExplanationRecordInput {
  /** The user intent as understood. */
  intent: string;
  /** Steps of reasoning taken. */
  reasoning: readonly string[];
  /** Knowledge items used (with snippets). */
  knowledgeUsed: readonly { itemId: string; snippet: string }[];
  /** Policies applied during evaluation. */
  policiesApplied: readonly string[];
  /** Capabilities invoked. */
  capabilitiesUsed: readonly string[];
  /** Agents invoked. */
  agentsUsed: readonly string[];
  /** Tools invoked. */
  toolsUsed: readonly string[];
  /** Approvals requested/granted. */
  approvals: readonly { id: string; status: 'granted' | 'rejected' | 'pending' }[];
  /** The final decision taken. */
  finalDecision: string;
  /** Model confidence, 0..1 when available. */
  confidence?: number;
}

/**
 * Assembles the canonical {@link ExplanationRecord} (AIR.md §14) from the
 * runtime's decision-time parts. Every AI action must explain all ten
 * elements; this builder makes the composition explicit in one place.
 */
export function buildExplanationRecord(input: BuildExplanationRecordInput): ExplanationRecord {
  return {
    intent: input.intent,
    reasoning: input.reasoning,
    knowledgeUsed: input.knowledgeUsed,
    policiesApplied: input.policiesApplied,
    capabilitiesUsed: input.capabilitiesUsed,
    agentsUsed: input.agentsUsed,
    toolsUsed: input.toolsUsed,
    approvals: input.approvals,
    finalDecision: input.finalDecision,
    confidence: input.confidence,
  };
}
