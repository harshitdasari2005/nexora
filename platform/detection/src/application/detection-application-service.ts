/**
 * @nexora/module-detection — DetectionApplicationService (S27).
 *
 * The GENERIC detection surface. A scan loads the TRUSTED snapshot (from the
 * existing application handlers), evaluates every registered signal
 * deterministically, and for each detection creates-or-refreshes ONE
 * problem (dedupe by the deterministic correlation identity — a problem
 * detected repeatedly never creates duplicates, S27 §15). It then runs the
 * generic investigation (evidence + root-cause candidates, FACT vs
 * INFERENCE) and existing-knowledge solution discovery (known solution
 * found / not found, FOUND vs APPLICABLE), and derives the deterministic
 * recommendation.
 *
 * The engine NEVER decides tenant/workspace/role/capability/authorization/
 * approval — those come from the trusted context and the S26 agent surface.
 * An action proposal is produced ONLY when a remediation capability of the
 * signal is within the caller's agent capability set (fail closed: an agent
 * can never be recommended to act beyond its registered capabilities), and
 * it reuses the S26 ActionProposal shape so execution flows through the
 * existing governance. Phase 9 never executes automatically.
 */

import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type {
  ActionProposal,
  BusinessProblemDto,
  ProblemRecommendationDto,
  ProblemStatus,
} from '@nexora/contracts/detection';
import type { BusinessSignalRegistry } from '../registry/business-signal-registry.js';
import { BusinessProblem, buildCorrelationId } from '../domain/problem.js';
import type { InvestigationEngine } from './investigation-engine.js';
import type { SolutionDiscovery } from './solution-discovery.js';
import type { DetectionSnapshotLoader } from './detection-snapshot.js';
import type { ProblemStore } from './problem-store.js';

/** The scope of a detection scan (trusted — never client-supplied). */
export interface DetectionScope {
  /** The authenticated user (trusted). */
  userId: string;
  /** The tenant (organization) scope (trusted). */
  tenantId: string;
  /** The verified workspace scope, when present (trusted). */
  workspaceId?: string;
  /** The caller's agent capability set (the S26 agent's registered set). */
  agentCapabilityIds: readonly string[];
}

/** The maximum number of problems returned per scan (bounded). */
const PROBLEMS_LIMIT = 20;

/**
 * Phase 10: problem statuses OWNED by the remediation plan engine. A
 * detection scan never auto-resolves a problem in one of these states —
 * the plan engine re-evaluates and transitions them deterministically
 * (after every step and at final verification).
 */
const REMEDIATION_OWNED_STATUSES: ReadonlySet<string> = new Set([
  'REMEDIATION_PLANNED',
  'REMEDIATING',
  'REMEDIATION_BLOCKED',
  'REMEDIATION_FAILED',
]);

/** Dependencies of the detection application service. */
export interface DetectionApplicationServiceDependencies {
  /** The registered signals. */
  registry: BusinessSignalRegistry;
  /** Builds the trusted snapshot from the existing application handlers. */
  snapshotLoader: DetectionSnapshotLoader;
  /** The generic investigation engine. */
  investigation: InvestigationEngine;
  /** The generic solution discovery (existing knowledge first). */
  discovery: SolutionDiscovery;
  /** The durable problem store. */
  store: ProblemStore;
  /**
   * Called ONCE when a problem is first created (S27 §15 proactive
   * notifications). The API layer publishes a `problem.detected` event
   * through the EXISTING notification system — the consumer's idempotency
   * key (source event = the problem's correlation identity) guarantees a
   * repeatedly-detected problem never creates infinite notifications.
   */
  onProblemCreated?: (problem: {
    id: string;
    correlationId: string;
    tenantId: string;
    workspaceId?: string;
    userId: string;
    title: string;
    severity: string;
  }) => Promise<void>;
}

/** The outcome of a scan. */
export type ScanResult =
  { ok: true; problems: readonly BusinessProblemDto[] } | { ok: false; reason: 'snapshot-failed' };

/**
 * The generic detection application service: detect → problem →
 * investigate → discover → recommend.
 */
export class DetectionApplicationService {
  readonly #registry: BusinessSignalRegistry;
  readonly #snapshotLoader: DetectionSnapshotLoader;
  readonly #investigation: InvestigationEngine;
  readonly #discovery: SolutionDiscovery;
  readonly #store: ProblemStore;
  readonly #onProblemCreated?: DetectionApplicationServiceDependencies['onProblemCreated'];

  constructor(dependencies: DetectionApplicationServiceDependencies) {
    this.#registry = dependencies.registry;
    this.#snapshotLoader = dependencies.snapshotLoader;
    this.#investigation = dependencies.investigation;
    this.#discovery = dependencies.discovery;
    this.#store = dependencies.store;
    this.#onProblemCreated = dependencies.onProblemCreated;
  }

  /**
   * Runs a full detection + investigation + discovery scan for the trusted
   * scope. Idempotent by correlation identity: re-scans update the existing
   * problem (and resolve problems whose signal no longer fires — honest
   * resolution, verified by re-evaluation), never create duplicates.
   */
  async scan(scope: DetectionScope): Promise<ScanResult> {
    let snapshot;
    try {
      snapshot = await this.#snapshotLoader.load(scope);
    } catch {
      return { ok: false, reason: 'snapshot-failed' };
    }

    const seenCorrelationIds = new Set<string>();
    for (const signal of this.#registry.list()) {
      for (const detection of signal.evaluate(snapshot)) {
        const correlationId = buildCorrelationId({
          signalId: signal.id,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          suffix: detection.correlationSuffix,
        });
        seenCorrelationIds.add(correlationId);

        await this.#upsertProblem(scope, snapshot.generatedAt, signal.id, correlationId, detection);
      }
    }

    // Resolve open problems whose signal no longer fires (deterministic
    // re-evaluation — the only honest RESOLVED claim). Phase 10: problems in
    // a remediation state are OWNED by the plan engine (which re-evaluates
    // after every step and at final verification) — a scan never races the
    // plan by resolving them out from under it.
    const existing = await this.#store.listByScope({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      limit: PROBLEMS_LIMIT,
    });
    for (const record of existing) {
      if (
        record.status === 'RESOLVED' ||
        REMEDIATION_OWNED_STATUSES.has(record.status) ||
        seenCorrelationIds.has(record.correlationId)
      ) {
        continue;
      }
      const problem = BusinessProblem.hydrate(record);
      problem.transitionTo('RESOLVED', nowIso());
      await this.#store.save(problem.snapshot());
    }

    return { ok: true, problems: await this.#list(scope) };
  }

  /** Lists the scope's problems as full investigation DTOs. */
  async list(scope: DetectionScope): Promise<BusinessProblemDto[]> {
    return this.#list(scope);
  }

  /**
   * Re-evaluates ONE problem deterministically (Phase 10): re-runs the
   * problem's signal against a FRESH trusted snapshot and answers whether
   * the condition still fires, returning the refreshed investigation DTO.
   * This is the re-evaluation seam the remediation engine uses after every
   * execution step and at final verification — the ONLY honest basis for
   * "problem resolved" / "plan still valid". Returns `undefined` for a
   * forged/foreign problem id (fail closed).
   */
  async reevaluate(
    scope: DetectionScope,
    problemId: string,
  ): Promise<{ stillPresent: boolean; problem: BusinessProblemDto } | undefined> {
    const record = await this.#store.findById(scope.tenantId, problemId);
    if (record === undefined || !DetectionApplicationService.#inScope(record, scope)) {
      return undefined;
    }
    const signal = this.#registry.get(record.signalId);
    if (signal === undefined) {
      return undefined;
    }
    const problem = BusinessProblem.hydrate(record);
    // A resolved problem is a fact of the record — it stays resolved until
    // the signal fires again (the scan re-opens it), never "still present".
    if (problem.status === 'RESOLVED') {
      const snapshot = await this.#snapshotLoader.load(scope);
      return {
        stillPresent: false,
        problem: await this.#toDto(scope, problem, signal.id, signal.name, snapshot),
      };
    }
    const snapshot = await this.#snapshotLoader.load(scope);
    // Exact deterministic match: the correlation identity (signal + scope +
    // entity) must be produced by the current evaluation — a weakened or
    // vanished condition yields no detection for THIS problem.
    let stillPresent = false;
    for (const detection of signal.evaluate(snapshot)) {
      const candidate = buildCorrelationId({
        signalId: signal.id,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        suffix: detection.correlationSuffix,
      });
      if (candidate === record.correlationId) {
        stillPresent = true;
        break;
      }
    }
    return {
      stillPresent,
      problem: await this.#toDto(scope, problem, signal.id, signal.name, snapshot),
    };
  }

  /**
   * Resolves MANY problems by id (Phase 10 plan-list reads): ONE trusted
   * snapshot load for all of them (S22 — never N+1), tenant-scoped;
   * non-existent or foreign ids are omitted (fail closed).
   */
  async listByIds(
    scope: DetectionScope,
    problemIds: readonly string[],
  ): Promise<BusinessProblemDto[]> {
    const deduped = [...new Set(problemIds)];
    if (deduped.length === 0) {
      return [];
    }
    const records = (await this.#store.findByIds(scope.tenantId, deduped)).filter((record) =>
      DetectionApplicationService.#inScope(record, scope),
    );
    if (records.length === 0) {
      return [];
    }
    const snapshot = await this.#snapshotLoader.load(scope);
    const byId = new Map<string, BusinessProblemDto>();
    for (const record of records) {
      const signal = this.#registry.get(record.signalId);
      if (signal === undefined) {
        continue;
      }
      const dto = await this.#toDto(
        scope,
        BusinessProblem.hydrate(record),
        signal.id,
        signal.name,
        snapshot,
      );
      byId.set(dto.id, dto);
    }
    // Preserve the requested order (the plan list's display order).
    const result: BusinessProblemDto[] = [];
    for (const problemId of deduped) {
      const dto = byId.get(problemId);
      if (dto !== undefined) {
        result.push(dto);
      }
    }
    return result;
  }

  /**
   * Whether a stored problem belongs to the caller's exact scope: the tenant
   * is matched by the store, the workspace here (a workspace problem is only
   * visible inside its workspace; an org-level problem only to an org-level
   * scope — the same exact-match rule as `listByScope` and the correlation
   * id). A foreign-workspace id therefore resolves exactly like a missing one.
   */
  static #inScope(
    record: { tenantId: string; workspaceId?: string },
    scope: { tenantId: string; workspaceId?: string },
  ): boolean {
    return record.tenantId === scope.tenantId && record.workspaceId === scope.workspaceId;
  }

  /** Resolves one problem by id (tenant + workspace scoped; forged ids resolve to nothing). */
  async getById(scope: DetectionScope, problemId: string): Promise<BusinessProblemDto | undefined> {
    const record = await this.#store.findById(scope.tenantId, problemId);
    if (record === undefined || !DetectionApplicationService.#inScope(record, scope)) {
      return undefined;
    }
    const signal = this.#registry.get(record.signalId);
    if (signal === undefined) {
      return undefined;
    }
    const snapshot = await this.#snapshotLoader.load(scope);
    return this.#toDto(scope, BusinessProblem.hydrate(record), signal.id, signal.name, snapshot);
  }

  /**
   * Transitions a problem's lifecycle deterministically (Phase 10 — the
   * plan engine's lifecycle port). The transition is validated against the
   * SAME explicit transition table as every other state change; a forged or
   * foreign problem id (or an illegal transition) returns `false` — the
   * engine fails safe and never mutates someone else's problem.
   */
  async transition(
    scope: { userId: string; tenantId: string; workspaceId?: string },
    problemId: string,
    status: ProblemStatus,
    now: string,
  ): Promise<boolean> {
    const record = await this.#store.findById(scope.tenantId, problemId);
    if (record === undefined || !DetectionApplicationService.#inScope(record, scope)) {
      return false;
    }
    try {
      const problem = BusinessProblem.hydrate(record);
      problem.transitionTo(status, now);
      await this.#store.save(problem.snapshot());
      return true;
    } catch {
      return false;
    }
  }

  /** Creates-or-refreshes the problem for one detection (dedupe by correlation). */
  async #upsertProblem(
    scope: DetectionScope,
    now: string,
    signalId: string,
    correlationId: string,
    detection: {
      affectedEntity?: { type: string; id: string; title: string };
      severity: 'low' | 'medium' | 'high';
      title: string;
      description: string;
      facts: readonly string[];
    },
  ): Promise<void> {
    const existing = await this.#store.findByCorrelationId({
      tenantId: scope.tenantId,
      correlationId,
    });
    const affectedEntities =
      detection.affectedEntity === undefined ? [] : [{ ...detection.affectedEntity }];

    if (existing === undefined) {
      const problem = BusinessProblem.create({
        id: prefixedId('prb'),
        correlationId,
        signalId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        title: detection.title,
        description: detection.description,
        severity: detection.severity,
        detectedAt: now,
        affectedEntities,
      });
      await this.#store.save(problem.snapshot());
      // Proactive notification on FIRST detection only — a repeated scan of
      // the same condition never re-notifies (S27 §15 dedupe).
      if (this.#onProblemCreated !== undefined) {
        await this.#onProblemCreated({
          id: problem.id,
          correlationId: problem.correlationId,
          tenantId: problem.tenantId,
          workspaceId: problem.workspaceId,
          userId: scope.userId,
          title: problem.title,
          severity: problem.severity,
        });
      }
      return;
    }

    // Re-open a resolved problem whose signal fired again (new episode).
    const problem = BusinessProblem.hydrate(existing);
    if (problem.status === 'RESOLVED') {
      problem.transitionTo('DETECTED', now);
    }
    problem.refresh(
      { title: detection.title, description: detection.description, severity: detection.severity },
      now,
    );
    await this.#store.save(problem.snapshot());
  }

  /** Composes the full problem DTO for the trusted scope. */
  async #list(scope: DetectionScope): Promise<BusinessProblemDto[]> {
    const records = await this.#store.listByScope({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      limit: PROBLEMS_LIMIT,
    });
    if (records.length === 0) {
      return [];
    }
    const snapshot = await this.#snapshotLoader.load(scope);
    const result: BusinessProblemDto[] = [];
    for (const record of records) {
      const signal = this.#registry.get(record.signalId);
      if (signal === undefined) {
        continue;
      }
      result.push(
        await this.#toDto(scope, BusinessProblem.hydrate(record), signal.id, signal.name, snapshot),
      );
    }
    // Newest detection first (stable order).
    return result.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  }

  /** Builds the full DTO: investigation + discovery + recommendation. */
  async #toDto(
    scope: DetectionScope,
    problem: BusinessProblem,
    signalId: string,
    signalName: string,
    snapshot: Awaited<ReturnType<DetectionSnapshotLoader['load']>>,
  ): Promise<BusinessProblemDto> {
    const investigated = this.#investigation.investigate(problem, snapshot);
    const signal = this.#registry.get(signalId);
    const discovered = await this.#discovery.discover(
      problem,
      snapshot,
      signal?.remediationCapabilities ?? [],
    );

    const recommendation = this.#recommend(
      scope,
      problem,
      signalId,
      signalName,
      discovered.solutions,
      discovered.foundApplicable,
    );

    return {
      id: problem.id,
      correlationId: problem.correlationId,
      signalId,
      signalName,
      tenantId: problem.tenantId,
      workspaceId: problem.workspaceId,
      title: problem.title,
      description: problem.description,
      severity: problem.severity,
      status: problem.status,
      detectedAt: problem.detectedAt,
      updatedAt: problem.updatedAt,
      affectedEntities: problem.affectedEntities,
      remediationCapabilities: signal?.remediationCapabilities ?? [],
      evidence: [...investigated.evidence, ...discovered.evidence],
      rootCauses: investigated.rootCauses,
      solutions: discovered.solutions,
      recommendation,
    };
  }

  /**
   * Derives the deterministic recommendation. EXISTING KNOWLEDGE FIRST: the
   * top APPLICABLE solution grounds the recommendation ("Known solution
   * found"); when nothing applicable exists the engine says so explicitly —
   * it never invents a solution. An action proposal is produced only when a
   * remediation capability of the signal is in the caller's agent set (fail
   * closed) and reuses the S26 ActionProposal shape (approval requirement
   * visible; execution through existing governance, never automatic).
   */
  #recommend(
    scope: DetectionScope,
    problem: BusinessProblem,
    signalId: string,
    signalName: string,
    solutions: readonly {
      title: string;
      source: string;
      reference?: { id: string; title: string };
      applicability: string;
    }[],
    foundApplicable: boolean,
  ): ProblemRecommendationDto {
    const signal = this.#registry.get(signalId);
    const applicable = solutions.filter((solution) => solution.applicability === 'APPLICABLE');
    const top = applicable[0];

    // The remediation capability must be within the CALLER'S agent set —
    // an agent can never be recommended to act beyond its registered
    // capabilities (S26 security contract).
    const remediation = signal?.remediationCapabilities.find((capabilityId) =>
      scope.agentCapabilityIds.includes(capabilityId),
    );

    if (!foundApplicable || top === undefined) {
      return {
        summary:
          'No known solution found. The engine searched existing knowledge, documents, and previous governed executions without an applicable match — it does not invent one. Review the evidence and the root-cause candidates to decide the next step.',
      };
    }

    // The recommendation quotes the solution by its REFERENCE ID and a
    // bounded sanitized display label — never the raw retrieved title
    // verbatim (S27 §18: a poisoned document cannot inject instructions
    // into the recommendation narrative; the label is a safe citation).
    const groundedIn = top.reference?.id ?? top.title;
    const label = boundedLabel(top.title);
    const summary = `Known solution found: ${top.source === 'knowledge' ? 'knowledge article' : top.source} ${top.reference?.id ?? ''} ("${label}"). ${foundApplicable ? 'Applicability assessed — this existing remediation concerns the affected entity.' : ''}`;

    const actionProposal =
      remediation === undefined
        ? undefined
        : this.#buildActionProposal(problem, signalName, top, remediation);

    return { summary, groundedIn, ...(actionProposal === undefined ? {} : { actionProposal }) };
  }

  /** Builds a governed S26 ActionProposal for the top applicable solution. */
  #buildActionProposal(
    problem: BusinessProblem,
    signalName: string,
    solution: { title: string; source: string },
    requiredCapability: string,
  ): ActionProposal {
    const entity = problem.affectedEntities[0];
    return {
      id: `propose_${problem.id.slice(-12)}`,
      action: `Apply the known solution for ${signalName.toLowerCase()}`,
      // The reason cites the solution by id + bounded label — never the raw
      // title verbatim, so a poisoned article cannot inject instructions
      // into the governed proposal narrative.
      reason: `Known solution ${solution.source === 'knowledge' ? 'article' : solution.source} ${solution.title.length > 0 ? boundedLabel(solution.title) : ''} applies to ${problem.title}.`,
      ...(entity === undefined
        ? {}
        : { affectedEntity: { type: entity.type, id: entity.id, title: entity.title } }),
      targetSystem: 'nexora',
      requiredCapability,
      requiresApproval: true,
      expectedResult: 'The documented remediation is applied and the condition is re-evaluated.',
    };
  }
}

/**
 * Bounds a solution title into a display-safe citation label: one line,
 * trimmed, control characters stripped, truncated to a fixed length. A
 * poisoned title can never become an instruction in the recommendation
 * narrative.
 */
function boundedLabel(title: string, max = 60): string {
  const oneLine = title
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const clean = oneLine.replace(/[\u0000-\u001f\u007f]/g, '');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Handles a detection scan for a scope. */
export class ScanProblemsHandler {
  readonly #service: DetectionApplicationService;
  constructor(service: DetectionApplicationService) {
    this.#service = service;
  }
  handle(scope: DetectionScope): Promise<ScanResult> {
    return this.#service.scan(scope);
  }
}

/** Handles listing the scope's problems. */
export class ListProblemsHandler {
  readonly #service: DetectionApplicationService;
  constructor(service: DetectionApplicationService) {
    this.#service = service;
  }
  handle(scope: DetectionScope): Promise<readonly BusinessProblemDto[]> {
    return this.#service.list(scope);
  }
}

/** Handles resolving MANY problems by id (one snapshot — Phase 10). */
export class ListProblemsByIdsHandler {
  readonly #service: DetectionApplicationService;
  constructor(service: DetectionApplicationService) {
    this.#service = service;
  }
  handle(scope: DetectionScope, problemIds: readonly string[]): Promise<BusinessProblemDto[]> {
    return this.#service.listByIds(scope, problemIds);
  }
}

/** Handles resolving one problem by id (tenant-scoped). */
export class GetProblemHandler {
  readonly #service: DetectionApplicationService;
  constructor(service: DetectionApplicationService) {
    this.#service = service;
  }
  handle(scope: DetectionScope, problemId: string): Promise<BusinessProblemDto | undefined> {
    return this.#service.getById(scope, problemId);
  }
}

/** Handles re-evaluating ONE problem (Phase 10 — the plan engine's seam). */
export class ReevaluateProblemHandler {
  readonly #service: DetectionApplicationService;
  constructor(service: DetectionApplicationService) {
    this.#service = service;
  }
  handle(
    scope: DetectionScope,
    problemId: string,
  ): Promise<{ stillPresent: boolean; problem: BusinessProblemDto } | undefined> {
    return this.#service.reevaluate(scope, problemId);
  }
}
