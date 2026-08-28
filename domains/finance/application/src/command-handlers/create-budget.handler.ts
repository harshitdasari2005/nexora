/**
 * @nexora/application-finance — CreateBudgetHandler.
 *
 * The application entry point for creating a budget: delegates to the
 * {@link FinanceApplicationService}. The HTTP adapter is the only caller in
 * this vertical slice (budgets are not AI-tool creatable — see the Finance
 * README for what is and is not AI-accessible).
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type { CreateBudgetCommand, CreateBudgetResult } from '../commands/create-budget.command.js';
import type { FinanceApplicationService } from '../services/finance-application-service.js';

/** Handles {@link CreateBudgetCommand}. */
export class CreateBudgetHandler implements CommandHandler<
  CreateBudgetCommand,
  CreateBudgetResult,
  NexoraError
> {
  readonly #service: FinanceApplicationService;

  constructor(service: FinanceApplicationService) {
    this.#service = service;
  }

  handle(command: CreateBudgetCommand): Promise<Result<CreateBudgetResult, NexoraError>> {
    return this.#service.createBudget(command);
  }
}
