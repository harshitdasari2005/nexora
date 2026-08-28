/**
 * @nexora/application-finance — GetBudgetHandler.
 *
 * The application entry point for the single-budget read query.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { GetBudgetQuery, GetBudgetResult } from '../queries/get-budget.query.js';
import type { FinanceApplicationService } from '../services/finance-application-service.js';

/** Handles {@link GetBudgetQuery}. */
export class GetBudgetHandler {
  readonly #service: FinanceApplicationService;

  constructor(service: FinanceApplicationService) {
    this.#service = service;
  }

  handle(query: GetBudgetQuery): Promise<Result<GetBudgetResult, NexoraError>> {
    return this.#service.getBudget(query.organizationId, query.workspaceId, query.budgetId);
  }
}
