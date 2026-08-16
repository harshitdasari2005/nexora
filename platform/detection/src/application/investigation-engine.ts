/**
 * @nexora/module-detection — InvestigationEngine (S27).
 *
 * The GENERIC investigation abstraction. Given a problem (signal + affected
 * entity) and the trusted snapshot, it gathers grounded evidence from the
 * EXISTING data sources and derives root-cause candidates with an explicit
 * FACT vs INFERENCE distinction:
 *
 *   Problem → Evidence sources → Evidence → Root-cause candidates
 *
 * There is no ExecutiveInvestigator/ManagerInvestigator/DeveloperInvestigator
 * — one engine serves every role. Role-specific behavior comes only from
 * Domain/Role/Capability/Signal applicability/Agent definition (the signal's
 * remediation capabilities + the agent surface), never from the engine.
 *
 * Determinism contract: facts are directly observed from the snapshot;
 * inferences are clearly marked INFERENCE with a bounded confidence
 * (LOW/MEDIUM/HIGH) and a suggested next investigation step — an inference
 * is never presented as a confirmed fact.
 */

import { prefixedId } from '@nexora/shared/ids';
import type { ProblemEvidenceDto, RootCauseCandidateDto } from '@nexora/contracts/detection';

import type { DetectionSnapshot } from './detection-snapshot.js';
import type { BusinessProblem } from '../domain/problem.js';

/** Bounds of the investigation (S22 — never full-table scans). */
const ACTIVITY_EVIDENCE_LIMIT = 3;
const NOTIFICATION_EVIDENCE_LIMIT = 3;
const EXECUTION_EVIDENCE_LIMIT = 3;

/** The outcome of an investigation. */
export interface InvestigationOutcome {
  /** The grounded evidence, in a stable order. */
  evidence: readonly ProblemEvidenceDto[];
  /** The root-cause candidates (FACT vs INFERENCE separated). */
  rootCauses: readonly RootCauseCandidateDto[];
}

/**
 * Investigates a problem against the trusted snapshot. The engine is
 * generic: the affected entity + the signal determine WHICH sources are
 * consulted, never a job title.
 */
export class InvestigationEngine {
  /** Investigates one problem. */
  investigate(problem: BusinessProblem, snapshot: DetectionSnapshot): InvestigationOutcome {
    const evidence: ProblemEvidenceDto[] = [];
    const entity = problem.affectedEntities[0];

    // 1. Workflow-health evidence: the deterministic facts behind the signal.
    const health = snapshot.workflowHealth.find((metric) => metric.definitionKey === entity?.id);
    if (health !== undefined) {
      evidence.push({
        id: prefixedId('evd'),
        source: 'measurements',
        entityType: 'workflow',
        entityId: health.definitionKey,
        entityTitle: health.definitionKey,
        fact: `${health.definitionKey} ran ${health.total} time(s): ${health.failed} failed, ${health.successRate}% success rate.`,
      });
      if (health.cycleTimeP95Ms !== null) {
        evidence.push({
          id: prefixedId('evd'),
          source: 'measurements',
          entityType: 'workflow',
          entityId: health.definitionKey,
          fact: `Cycle time p95 is ${Math.round(health.cycleTimeP95Ms / 1000)}s.`,
        });
      }
    }

    // 2. Activity evidence: what the workspace saw recently (bounded).
    for (const item of snapshot.activity.slice(0, ACTIVITY_EVIDENCE_LIMIT)) {
      evidence.push({
        id: prefixedId('evd'),
        source: 'activity',
        entityType: 'activity',
        entityId: item.id,
        entityTitle: item.title,
        fact: `Recent activity: ${item.title}.`,
        occurredAt: item.occurredAt,
      });
    }

    // 3. Notification evidence: attention signals the caller actually has.
    for (const notification of snapshot.notifications.slice(0, NOTIFICATION_EVIDENCE_LIMIT)) {
      evidence.push({
        id: prefixedId('evd'),
        source: 'notifications',
        entityType: 'notification',
        entityId: notification.id,
        entityTitle: notification.title,
        fact: `Unread notification: ${notification.title}.`,
      });
    }

    // 4. Agent-execution evidence: what governed executions did recently.
    for (const run of snapshot.agentExecutions.slice(0, EXECUTION_EVIDENCE_LIMIT)) {
      evidence.push({
        id: prefixedId('evd'),
        source: 'agent_executions',
        entityType: 'agent_execution',
        entityId: run.id,
        entityTitle: run.proposalAction ?? run.agentId,
        fact: `Previous agent execution: ${run.status}${run.proposalAction === undefined ? '' : ` (${run.proposalAction})`}.`,
        occurredAt: run.createdAt,
      });
    }

    // 5. Root-cause candidates. FACT first (directly observed), then bounded
    //    INFERENCE derived from correlated signals — each with a controlled
    //    confidence and a deterministic next step.
    const rootCauses: RootCauseCandidateDto[] = [];
    const supportIds = (prefix: string) =>
      evidence.filter((item) => item.source === prefix).map((item) => item.id);

    if (health !== undefined && health.failed > 0) {
      rootCauses.push({
        explanation: `${health.definitionKey} failed ${health.failed} time(s) (${health.unrecoverableErrorRate}% unrecoverable error rate).`,
        supportingEvidenceIds: supportIds('measurements'),
        confidence: 'HIGH',
        kind: 'FACT',
        affectedEntity: entity,
        nextStep: 'Inspect the latest failed workflow instance for the error.',
      });
    }
    if (health !== undefined && health.total > 0 && health.successRate < 100) {
      rootCauses.push({
        explanation: `${health.definitionKey} has a ${health.successRate}% success rate across ${health.total} run(s) — below a healthy baseline.`,
        supportingEvidenceIds: supportIds('measurements'),
        confidence: 'MEDIUM',
        kind: 'FACT',
        affectedEntity: entity,
        nextStep: 'Correlate the failing runs with recent changes or activity.',
      });
    }

    // A bounded INFERENCE: recent activity may relate to the failures. This
    // is NEVER presented as a confirmed cause.
    const relevantActivity = snapshot.activity.find(
      (item) =>
        item.type.includes('failed') ||
        (entity !== undefined && item.title.toLowerCase().includes(entity.title.toLowerCase())),
    );
    if (relevantActivity !== undefined) {
      rootCauses.push({
        explanation: `Recent activity ("${relevantActivity.title}") may be related to this condition — the correlation is inferred, not confirmed.`,
        supportingEvidenceIds: supportIds('activity'),
        confidence: 'LOW',
        kind: 'INFERENCE',
        nextStep: 'Review the related activity item and the workflow step executions.',
      });
    }

    return { evidence, rootCauses };
  }
}
