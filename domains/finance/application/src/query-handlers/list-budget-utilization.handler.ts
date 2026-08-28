/**
 * @nexora/application-finance — ListBudgetUtilizationHandler.
 *
 * The application entry point for the workspace-scoped budget-utilization
 * projection. Shared by the REST API, the Command Center widget provider,
 * and the detection snapshot loader (finance section) — one computation,
 * three readers.
 */

import type { Result } from '@nexora/shared/result';

import type {
  ListBudgetUtilizationQuery,
  ListBudgetUtilizationResult,
} from '../queries/list-budget-utilization.query.js';
import type { FinanceApplicationService } from '../services/finance-application-service.js';

/** Handles {@link ListBudgetUtilizationQuery}. */
export class ListBudgetUtilizationHandler {
  readonly #service: FinanceApplicationService;

  constructor(service: FinanceApplicationService) {
    this.#service = service;
  }

  handle(query: ListBudgetUtilizationQuery): Promise<Result<ListBudgetUtilizationResult, never>> {
    return this.#service.listBudgetUtilization(query);
  }
}
