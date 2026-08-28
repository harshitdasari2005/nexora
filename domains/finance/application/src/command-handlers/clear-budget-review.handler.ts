/**
 * @nexora/application-finance — ClearBudgetReviewHandler.
 *
 * The application entry point for clearing a budget's review flag:
 * delegates to the {@link FinanceApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type {
  ClearBudgetReviewCommand,
  ClearBudgetReviewResult,
} from '../commands/clear-budget-review.command.js';
import type { FinanceApplicationService } from '../services/finance-application-service.js';

/** Handles {@link ClearBudgetReviewCommand}. */
export class ClearBudgetReviewHandler implements CommandHandler<
  ClearBudgetReviewCommand,
  ClearBudgetReviewResult,
  NexoraError
> {
  readonly #service: FinanceApplicationService;

  constructor(service: FinanceApplicationService) {
    this.#service = service;
  }

  handle(command: ClearBudgetReviewCommand): Promise<Result<ClearBudgetReviewResult, NexoraError>> {
    return this.#service.clearBudgetReview(command);
  }
}
