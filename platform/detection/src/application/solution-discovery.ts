/**
 * @nexora/module-detection — SolutionDiscovery (S27).
 *
 * EXISTING KNOWLEDGE FIRST: before any synthesis, the engine searches
 * Nexora's existing knowledge for a known solution — the knowledge base,
 * documents, and previous agent executions. If an applicable solution
 * exists, the problem reports "Known solution found." If nothing applicable
 * exists, it reports "No known solution found." — a solution is NEVER
 * invented.
 *
 * FOUND ≠ APPLICABLE. A retrieved item becomes APPLICABLE only when it
 * passes the deterministic applicability assessment (affected system /
 * entity / workspace / signal match). A found item that does not pass is
 * returned as FOUND with a REJECTED assessment + reason — the UI shows both
 * (a document containing the word "authentication" is not the correct
 * remediation).
 *
 * The discovery engine is generic: the sources are ports implemented by the
 * API layer over the EXISTING knowledge/document/execution seams (never a
 * second search infrastructure). Sources that fail resolve to nothing
 * (fail safe).
 */

import type {
  DetectionSource,
  ProblemEvidenceDto,
  SolutionApplicability,
  SolutionCandidateDto,
} from '@nexora/contracts/detection';

import type { BusinessProblem } from '../domain/problem.js';
import type { DetectionSnapshot } from './detection-snapshot.js';

/** A retrieved knowledge reference (the knowledge/document search result). */
export interface KnowledgeSolutionReference {
  /** The indexed source id. */
  sourceId: string;
  /** The display title. */
  title: string;
  /** A bounded snippet. */
  snippet: string;
  /** The corpus member kind (`document` | `article`). */
  kind: string;
}

/** A retrieved previous-agent-execution solution. */
export interface ExecutionSolutionReference {
  /** The execution record id. */
  id: string;
  /** The executed proposal action, when any. */
  proposalAction?: string;
  /** The run status. */
  status: string;
}

/** The solution sources the discovery reads (existing seams only). */
export interface SolutionSources {
  /** Searches the existing knowledge/document corpus (bounded). */
  searchKnowledge(context: {
    tenantId: string;
    workspaceId: string;
    query: string;
    limit: number;
  }): Promise<readonly KnowledgeSolutionReference[]>;
  /** Lists previous agent executions for the scope (journal, bounded). */
  listExecutions(context: {
    tenantId: string;
    workspaceId?: string;
    userId: string;
    limit: number;
  }): Promise<readonly ExecutionSolutionReference[]>;
}

/** The bounds of discovery (S22 — bounded, never a full scan). */
const KNOWLEDGE_LIMIT = 3;
const EXECUTION_LIMIT = 3;

/** Maps a knowledge kind to the evidence source it came from. */
function sourceForKind(kind: string): DetectionSource {
  return kind === 'document' ? 'documents' : 'knowledge';
}

/** The outcome of a discovery pass. */
export interface DiscoveryOutcome {
  /** The solution candidates (FOUND/APPLICABLE/REJECTED). */
  solutions: readonly SolutionCandidateDto[];
  /** The evidence items for the discovered solutions. */
  evidence: readonly ProblemEvidenceDto[];
  /** Whether an APPLICABLE solution exists. */
  foundApplicable: boolean;
}

/**
 * Discovers existing solutions for a problem. The affected entity title +
 * the problem title drive the knowledge query (deterministic); previous
 * agent executions that acted on the same entity surface as precedents.
 */
export class SolutionDiscovery {
  constructor(private readonly sources: SolutionSources) {}

  /**
   * Runs the discovery pass for one problem. `remediationCapabilities` is
   * the signal's remediation vocabulary (Phase 10): an APPLICABLE solution
   * carries it as its `requiredCapabilities`, so the remediation plan
   * builder can derive the steps deterministically from the solution — the
   * same capabilities are never a grant; the plan re-validates each step
   * against the caller's agent set.
   */
  async discover(
    problem: BusinessProblem,
    snapshot: DetectionSnapshot,
    remediationCapabilities: readonly string[] = [],
  ): Promise<DiscoveryOutcome> {
    const solutions: SolutionCandidateDto[] = [];
    const evidence: ProblemEvidenceDto[] = [];
    const entity = problem.affectedEntities[0];
    const entityTerm = entity?.title ?? problem.title;

    // 1. Knowledge/document corpus (workspace-scoped search).
    if (snapshot.workspaceId !== undefined) {
      const references = await this.#safe(async () =>
        this.sources.searchKnowledge({
          tenantId: problem.tenantId,
          workspaceId: snapshot.workspaceId as string,
          query: `${problem.title} ${entityTerm}`,
          limit: KNOWLEDGE_LIMIT,
        }),
      );
      for (const reference of references) {
        const candidate = this.#assessKnowledge(
          problem,
          entityTerm,
          reference,
          remediationCapabilities,
        );
        solutions.push(candidate);
        evidence.push({
          id: `evd_${candidate.id}`,
          source: sourceForKind(reference.kind),
          entityType: reference.kind,
          entityId: reference.sourceId,
          entityTitle: reference.title,
          fact: `Existing ${reference.kind}: "${reference.title}".`,
        });
      }
    }

    // 2. Previous agent executions (precedents — what the governed agents did).
    const executions = await this.#safe(async () =>
      this.sources.listExecutions({
        tenantId: problem.tenantId,
        workspaceId: snapshot.workspaceId,
        userId: snapshot.userId,
        limit: EXECUTION_LIMIT,
      }),
    );
    for (const run of executions) {
      const candidate = this.#assessExecution(problem, entityTerm, run);
      if (candidate !== undefined) {
        solutions.push(candidate);
        evidence.push({
          id: `evd_${candidate.id}`,
          source: 'agent_executions',
          entityType: 'agent_execution',
          entityId: run.id,
          entityTitle: run.proposalAction ?? run.status,
          fact: `Previous governed execution: ${run.status}${run.proposalAction === undefined ? '' : ` (${run.proposalAction})`}.`,
        });
      }
    }

    const foundApplicable = solutions.some((solution) => solution.applicability === 'APPLICABLE');
    return { solutions, evidence, foundApplicable };
  }

  /**
   * Assesses a knowledge/document reference: FOUND always; APPLICABLE only
   * when the reference clearly concerns the affected entity or the signal
   * terms (deterministic match) — a document that merely mentions a keyword
   * without matching the entity is REJECTED as not applicable.
   */
  #assessKnowledge(
    problem: BusinessProblem,
    entityTerm: string,
    reference: KnowledgeSolutionReference,
    remediationCapabilities: readonly string[] = [],
  ): SolutionCandidateDto {
    const haystack = `${reference.title} ${reference.snippet}`.toLowerCase();
    const entityTokens = entityTerm
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 2);
    const matchesEntity = entityTokens.some((token) => haystack.includes(token));
    // The signal id itself is a strong applicability signal (e.g. a
    // "workflow failure" runbook for a `workflow_failure` problem).
    const matchesSignal = haystack.includes(problem.signalId.replaceAll('_', ' '));

    let applicability: SolutionApplicability = 'FOUND';
    let rejectionReason: string | undefined;
    if (!matchesEntity && !matchesSignal) {
      applicability = 'REJECTED';
      rejectionReason = 'The retrieved reference does not clearly concern the affected entity.';
    } else if (matchesSignal) {
      applicability = 'APPLICABLE';
    } else {
      applicability = 'APPLICABLE';
    }

    return {
      id: `sol_${reference.sourceId.slice(-10)}`,
      source: sourceForKind(reference.kind),
      title: reference.title,
      description: reference.snippet,
      reference: { id: reference.sourceId, title: reference.title },
      applicability,
      rejectionReason,
      confidence: matchesSignal ? 'MEDIUM' : 'LOW',
      // Phase 10: an APPLICABLE known solution carries the signal's
      // remediation vocabulary so the plan builder can derive steps from it.
      requiredCapabilities: applicability === 'APPLICABLE' ? [...remediationCapabilities] : [],
    };
  }

  /**
   * Assesses a previous execution: a COMPLETED execution that acted on the
   * affected entity is an APPLICABLE precedent; a failed/blocked one is
   * FOUND but not a remediation.
   */
  #assessExecution(
    problem: BusinessProblem,
    entityTerm: string,
    run: ExecutionSolutionReference,
  ): SolutionCandidateDto | undefined {
    const action = run.proposalAction ?? '';
    const haystack = `${action} ${run.status}`.toLowerCase();
    const matchesEntity = entityTerm
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 2)
      .some((token) => haystack.includes(token));

    if (!matchesEntity) {
      return undefined;
    }
    const applicable = run.status === 'completed';
    return {
      id: `sol_${run.id.slice(-10)}`,
      source: 'agent_executions',
      title: run.proposalAction ?? 'Previous agent execution',
      description: applicable
        ? 'A previous governed execution completed for this entity.'
        : `A previous governed execution for this entity ended ${run.status}.`,
      reference: { id: run.id, title: run.proposalAction ?? run.id },
      applicability: applicable ? 'APPLICABLE' : 'FOUND',
      rejectionReason: applicable ? undefined : 'The previous execution did not complete.',
      confidence: applicable ? 'MEDIUM' : 'LOW',
      requiredCapabilities: [],
    };
  }

  /** Runs a source; failures resolve to nothing (fail safe). */
  async #safe<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch {
      return [] as T;
    }
  }
}
