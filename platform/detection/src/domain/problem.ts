/**
 * @nexora/module-detection — BusinessProblem (S27).
 *
 * The typed problem record: the deterministic outcome of a detected signal.
 * A problem is NOT the signal and NOT the solution — it is the durable
 * record of WHAT is wrong, WHY it matters, what evidence supports it, which
 * root causes are candidates (FACT vs INFERENCE), what existing solutions
 * were found (and whether they are APPLICABLE), and what the engine
 * recommends. The lifecycle transitions are driven by the detection service
 * deterministically — never by an LLM.
 *
 * The `correlationId` is the deterministic dedupe identity: the same
 * signal + scope + entity maps to the same problem, so repeated scans
 * update one problem instead of creating duplicates (S27 §15).
 */

import type { ProblemSeverity, ProblemStatus } from '@nexora/contracts/detection';

/** The affected entity reference (references, never copies). */
export interface ProblemAffectedEntity {
  type: string;
  id: string;
  title: string;
}

/** The problem lifecycle transition table (deterministic, explicit). */
const TRANSITIONS: Readonly<Record<ProblemStatus, readonly ProblemStatus[]>> = {
  DETECTED: ['INVESTIGATING', 'REMEDIATION_PLANNED', 'REMEDIATION_BLOCKED', 'RESOLVED'],
  INVESTIGATING: ['UNDERSTOOD', 'REMEDIATION_PLANNED', 'REMEDIATION_BLOCKED', 'RESOLVED'],
  UNDERSTOOD: [
    'SOLUTION_FOUND',
    'NO_SOLUTION_FOUND',
    'REMEDIATION_PLANNED',
    'REMEDIATION_BLOCKED',
    'RESOLVED',
  ],
  SOLUTION_FOUND: [
    'ACTION_PROPOSED',
    'WAITING_FOR_APPROVAL',
    'NO_SOLUTION_FOUND',
    'REMEDIATION_PLANNED',
    'REMEDIATION_BLOCKED',
    'RESOLVED',
  ],
  NO_SOLUTION_FOUND: ['ACTION_PROPOSED', 'RESOLVED'],
  ACTION_PROPOSED: [
    'WAITING_FOR_APPROVAL',
    'REMEDIATION_PLANNED',
    'REMEDIATION_BLOCKED',
    'RESOLVED',
  ],
  WAITING_FOR_APPROVAL: ['REMEDIATION_PLANNED', 'REMEDIATION_BLOCKED', 'RESOLVED'],
  // Phase 10 remediation states — owned by the plan engine: a validated
  // plan puts the problem in REMEDIATION_PLANNED, execution moves it to
  // REMEDIATING, and the engine resolves/blocks/fails it deterministically.
  REMEDIATION_PLANNED: ['REMEDIATING', 'REMEDIATION_BLOCKED', 'REMEDIATION_FAILED', 'RESOLVED'],
  REMEDIATING: ['REMEDIATION_PLANNED', 'REMEDIATION_BLOCKED', 'REMEDIATION_FAILED', 'RESOLVED'],
  REMEDIATION_BLOCKED: ['REMEDIATION_PLANNED', 'RESOLVED'],
  REMEDIATION_FAILED: ['REMEDIATION_PLANNED', 'RESOLVED'],
  RESOLVED: ['DETECTED'],
};

/** The identity + lifecycle of one detected problem. */
export interface BusinessProblemSnapshot {
  /** Stable problem id (`prb_…`). */
  id: string;
  /** The deterministic correlation identity (dedupe key). */
  correlationId: string;
  /** The detected signal id. */
  signalId: string;
  /** The tenant (organization) scope. */
  tenantId: string;
  /** The verified workspace scope, when present. */
  workspaceId?: string;
  /** A human-readable problem title. */
  title: string;
  /** A grounded description. */
  description: string;
  /** The explicit severity. */
  severity: ProblemSeverity;
  /** The lifecycle status. */
  status: ProblemStatus;
  /** ISO-8601 UTC first-detection time. */
  detectedAt: string;
  /** ISO-8601 UTC last-transition time. */
  updatedAt: string;
  /** The affected entities. */
  affectedEntities: readonly ProblemAffectedEntity[];
}

/** Builds the deterministic correlation identity for a signal detection. */
export function buildCorrelationId(input: {
  signalId: string;
  tenantId: string;
  workspaceId?: string;
  /** The entity-level correlation suffix (e.g. the affected entity id). */
  suffix: string;
}): string {
  const scope = `${input.tenantId}:${input.workspaceId ?? 'org'}`;
  return `${input.signalId}:${scope}:${input.suffix}`;
}

/** The {@link BusinessProblem} aggregate root. */
export class BusinessProblem {
  readonly #id: string;
  readonly #correlationId: string;
  readonly #signalId: string;
  readonly #tenantId: string;
  readonly #workspaceId?: string;
  #title: string;
  #description: string;
  #severity: ProblemSeverity;
  #status: ProblemStatus;
  readonly #detectedAt: string;
  #updatedAt: string;
  readonly #affectedEntities: readonly ProblemAffectedEntity[];

  private constructor(snapshot: BusinessProblemSnapshot) {
    this.#id = snapshot.id;
    this.#correlationId = snapshot.correlationId;
    this.#signalId = snapshot.signalId;
    this.#tenantId = snapshot.tenantId;
    this.#workspaceId = snapshot.workspaceId;
    this.#title = snapshot.title;
    this.#description = snapshot.description;
    this.#severity = snapshot.severity;
    this.#status = snapshot.status;
    this.#detectedAt = snapshot.detectedAt;
    this.#updatedAt = snapshot.updatedAt;
    this.#affectedEntities = snapshot.affectedEntities;
  }

  /** Creates a new problem in `DETECTED` status. */
  static create(input: {
    id: string;
    correlationId: string;
    signalId: string;
    tenantId: string;
    workspaceId?: string;
    title: string;
    description: string;
    severity: ProblemSeverity;
    detectedAt: string;
    affectedEntities: readonly ProblemAffectedEntity[];
  }): BusinessProblem {
    return new BusinessProblem({
      ...input,
      status: 'DETECTED',
      updatedAt: input.detectedAt,
    });
  }

  /** Reconstructs a problem from a persisted snapshot (no events). */
  static hydrate(snapshot: BusinessProblemSnapshot): BusinessProblem {
    return new BusinessProblem(snapshot);
  }

  /** Problem id. */
  get id(): string {
    return this.#id;
  }

  /** The deterministic correlation identity. */
  get correlationId(): string {
    return this.#correlationId;
  }

  /** The detected signal id. */
  get signalId(): string {
    return this.#signalId;
  }

  /** Tenant scope. */
  get tenantId(): string {
    return this.#tenantId;
  }

  /** Workspace scope, when set. */
  get workspaceId(): string | undefined {
    return this.#workspaceId;
  }

  /** The lifecycle status. */
  get status(): ProblemStatus {
    return this.#status;
  }

  /** First-detection time. */
  get detectedAt(): string {
    return this.#detectedAt;
  }

  /** Last-transition time. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /** The affected entities. */
  get affectedEntities(): readonly ProblemAffectedEntity[] {
    return this.#affectedEntities;
  }

  /** The problem title. */
  get title(): string {
    return this.#title;
  }

  /** The problem description. */
  get description(): string {
    return this.#description;
  }

  /** The explicit severity. */
  get severity(): ProblemSeverity {
    return this.#severity;
  }

  /** Whether the problem is still open (not resolved). */
  isOpen(): boolean {
    return this.#status !== 'RESOLVED';
  }

  /**
   * Transitions the lifecycle (deterministic transition table). An illegal
   * transition throws — a problem can never jump states arbitrarily.
   */
  transitionTo(status: ProblemStatus, now: string): void {
    const allowed = TRANSITIONS[this.#status];
    if (allowed === undefined || !allowed.includes(status)) {
      throw new DetectionStateTransitionError({
        problemId: this.#id,
        from: this.#status,
        to: status,
      });
    }
    this.#status = status;
    this.#updatedAt = now;
  }

  /** Refreshes the display title/description (identity unchanged). */
  refresh(
    input: { title: string; description: string; severity: ProblemSeverity },
    now: string,
  ): void {
    this.#title = input.title;
    this.#description = input.description;
    this.#severity = input.severity;
    this.#updatedAt = now;
  }

  /** Produces the persistence snapshot. */
  snapshot(): BusinessProblemSnapshot {
    return {
      id: this.#id,
      correlationId: this.#correlationId,
      signalId: this.#signalId,
      tenantId: this.#tenantId,
      workspaceId: this.#workspaceId,
      title: this.#title,
      description: this.#description,
      severity: this.#severity,
      status: this.#status,
      detectedAt: this.#detectedAt,
      updatedAt: this.#updatedAt,
      affectedEntities: this.#affectedEntities,
    };
  }
}

/** A lifecycle transition outside the deterministic table. */
export class DetectionStateTransitionError extends Error {
  constructor(input: { problemId: string; from: ProblemStatus; to: ProblemStatus }) {
    super(`Problem ${input.problemId} cannot transition ${input.from} → ${input.to}`);
    this.name = 'DetectionStateTransitionError';
  }
}
