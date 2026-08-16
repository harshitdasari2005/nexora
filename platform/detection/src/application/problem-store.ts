/**
 * @nexora/module-detection — ProblemStore (S27 durability).
 *
 * The persistence port for {@link BusinessProblem}s. Implemented by the API
 * layer over the persistence seam (`business_problems`); in-memory in
 * hermetic module tests. Reads are ALWAYS tenant/workspace-scoped — a forged
 * problem id from another tenant resolves to nothing (fail closed).
 */

import type { BusinessProblemSnapshot } from '../domain/problem.js';

/** The problem store port (durability). */
export interface ProblemStore {
  /** Persists a problem (insert or update by id). */
  save(problem: BusinessProblemSnapshot): Promise<void>;
  /** Resolves a problem by id within the trusted tenant scope, or `undefined`. */
  findById(tenantId: string, problemId: string): Promise<BusinessProblemSnapshot | undefined>;
  /** Lists the scope's problems, newest detection first (bounded). */
  listByScope(scope: {
    tenantId: string;
    workspaceId?: string;
    limit: number;
  }): Promise<readonly BusinessProblemSnapshot[]>;
  /** Resolves a problem by its deterministic correlation identity (dedupe). */
  findByCorrelationId(input: {
    tenantId: string;
    correlationId: string;
  }): Promise<BusinessProblemSnapshot | undefined>;
}
