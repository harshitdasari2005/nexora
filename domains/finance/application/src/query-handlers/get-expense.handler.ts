/**
 * @nexora/application-finance — GetExpenseHandler.
 *
 * The application entry point for the single-expense read query.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { GetExpenseQuery, GetExpenseResult } from '../queries/get-expense.query.js';
import type { FinanceApplicationService } from '../services/finance-application-service.js';

/** Handles {@link GetExpenseQuery}. */
export class GetExpenseHandler {
  readonly #service: FinanceApplicationService;

  constructor(service: FinanceApplicationService) {
    this.#service = service;
  }

  handle(query: GetExpenseQuery): Promise<Result<GetExpenseResult, NexoraError>> {
    return this.#service.getExpense(query.organizationId, query.workspaceId, query.expenseId);
  }
}
