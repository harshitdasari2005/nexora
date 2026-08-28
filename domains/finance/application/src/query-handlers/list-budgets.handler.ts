/**
 * @nexora/application-finance — ListBudgetsHandler.
 *
 * The application entry point for the workspace-scoped budget listing
 * query.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { ListBudgetsQuery, ListBudgetsResult } from '../queries/list-budgets.query.js';
import type { FinanceApplicationService } from '../services/finance-application-service.js';

/** Handles {@link ListBudgetsQuery}. */
export class ListBudgetsHandler {
  readonly #service: FinanceApplicationService;

  constructor(service: FinanceApplicationService) {
    this.#service = service;
  }

  handle(query: ListBudgetsQuery): Promise<Result<ListBudgetsResult, NexoraError>> {
    return this.#service.listBudgets(query.organizationId, query.workspaceId);
  }
}
