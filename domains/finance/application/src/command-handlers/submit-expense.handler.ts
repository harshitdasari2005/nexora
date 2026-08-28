/**
 * @nexora/application-finance — SubmitExpenseHandler.
 *
 * The application entry point for submitting an expense: delegates to the
 * {@link FinanceApplicationService}. The HTTP adapter AND the
 * `finance.submit_expense` AI Runtime tool share this same boundary.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type {
  SubmitExpenseCommand,
  SubmitExpenseResult,
} from '../commands/submit-expense.command.js';
import type { FinanceApplicationService } from '../services/finance-application-service.js';

/** Handles {@link SubmitExpenseCommand}. */
export class SubmitExpenseHandler implements CommandHandler<
  SubmitExpenseCommand,
  SubmitExpenseResult,
  NexoraError
> {
  readonly #service: FinanceApplicationService;

  constructor(service: FinanceApplicationService) {
    this.#service = service;
  }

  handle(command: SubmitExpenseCommand): Promise<Result<SubmitExpenseResult, NexoraError>> {
    return this.#service.submitExpense(command);
  }
}
