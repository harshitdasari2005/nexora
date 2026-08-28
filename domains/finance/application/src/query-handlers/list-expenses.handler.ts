/**
 * @nexora/application-finance — ListExpensesHandler.
 *
 * The application entry point for the workspace-scoped expense listing
 * query.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { ListExpensesQuery, ListExpensesResult } from '../queries/list-expenses.query.js';
import type { FinanceApplicationService } from '../services/finance-application-service.js';

/** Handles {@link ListExpensesQuery}. */
export class ListExpensesHandler {
  readonly #service: FinanceApplicationService;

  constructor(service: FinanceApplicationService) {
    this.#service = service;
  }

  handle(query: ListExpensesQuery): Promise<Result<ListExpensesResult, NexoraError>> {
    return this.#service.listExpenses(query.organizationId, query.workspaceId);
  }
}
