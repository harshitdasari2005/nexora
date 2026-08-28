/**
 * @nexora/application-finance — DecideExpenseHandler.
 *
 * The application entry point for deciding a pending expense (approve or
 * reject): delegates to the {@link FinanceApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type {
  DecideExpenseCommand,
  DecideExpenseResult,
} from '../commands/decide-expense.command.js';
import type { FinanceApplicationService } from '../services/finance-application-service.js';

/** Handles {@link DecideExpenseCommand}. */
export class DecideExpenseHandler implements CommandHandler<
  DecideExpenseCommand,
  DecideExpenseResult,
  NexoraError
> {
  readonly #service: FinanceApplicationService;

  constructor(service: FinanceApplicationService) {
    this.#service = service;
  }

  handle(command: DecideExpenseCommand): Promise<Result<DecideExpenseResult, NexoraError>> {
    return this.#service.decideExpense(command);
  }
}
