/**
 * @nexora/application-finance — CloseBudgetHandler.
 *
 * The application entry point for closing a budget: delegates to the
 * {@link FinanceApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type { CloseBudgetCommand, CloseBudgetResult } from '../commands/close-budget.command.js';
import type { FinanceApplicationService } from '../services/finance-application-service.js';

/** Handles {@link CloseBudgetCommand}. */
export class CloseBudgetHandler implements CommandHandler<
  CloseBudgetCommand,
  CloseBudgetResult,
  NexoraError
> {
  readonly #service: FinanceApplicationService;

  constructor(service: FinanceApplicationService) {
    this.#service = service;
  }

  handle(command: CloseBudgetCommand): Promise<Result<CloseBudgetResult, NexoraError>> {
    return this.#service.closeBudget(command);
  }
}
