/**
 * @nexora/agent-sdk — reasoning.
 *
 * Reasoning contracts (AIR.md §7): the observable record of how an agent
 * reached a decision. Every record is explainability-ready (AIR.md §14).
 * The explainability record itself is the canonical `ExplanationRecord`
 * from `@nexora/contracts/ai`, re-exported here under the SDK name — never
 * re-declared.
 */

import type { ExplanationRecord } from '@nexora/contracts/ai';

/** Model confidence in a decision, 0..1. */
export interface Confidence {
  /** Confidence score, 0..1. */
  score: number;
  /** Human-readable justification for the score. */
  basis: string;
}

/** A piece of evidence supporting a decision. */
export interface Evidence {
  /** Evidence id. */
  id: string;
  /** Source description (knowledge item, tool result, event, ...). */
  source: string;
  /** The evidence content. */
  content: string;
  /** Whether the evidence supports or opposes the decision. */
  weight: 'supporting' | 'neutral' | 'against';
}

/** An alternative decision considered during reasoning. */
export interface AlternativeDecision {
  /** Description of the alternative. */
  description: string;
  /** Why it was not chosen. */
  rejectedReason: string;
}

/** The record of a single decision. */
export interface DecisionRecord {
  /** Decision id. */
  id: string;
  /** The decision taken. */
  decision: string;
  /** Evidence considered. */
  evidence: readonly Evidence[];
  /** Alternatives considered and rejected. */
  alternatives: readonly AlternativeDecision[];
  /** Confidence in the decision. */
  confidence: Confidence;
  /** ISO-8601 UTC time the decision was made. */
  madeAt: string;
}

/** The record of a reasoning pass. */
export interface ReasoningRecord {
  /** Reasoning pass id. */
  id: string;
  /** The question being reasoned about. */
  question: string;
  /** Ordered reasoning steps (AIR.md §7). */
  steps: readonly string[];
  /** Knowledge items consulted (ids). */
  knowledgeUsed: readonly string[];
  /** The resulting decision record, when a decision was reached. */
  decision?: DecisionRecord;
  /** ISO-8601 UTC time the pass completed. */
  completedAt: string;
}

/**
 * The explainability record produced by an agent (AIR.md §14). This is the
 * canonical `ExplanationRecord` contract re-exported under the SDK name so
 * SDK consumers get a single, non-duplicated explainability type.
 */
export type ExplainabilityRecord = ExplanationRecord;
