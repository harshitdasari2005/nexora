/**
 * @nexora/application-finance — ReviseBudgetHandler.
 *
 * The application entry point for revising a budget: delegates to the
 * {@link FinanceApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type { ReviseBudgetCommand, ReviseBudgetResult } from '../commands/revise-budget.command.js';
import type { FinanceApplicationService } from '../services/finance-application-service.js';

/** Handles {@link ReviseBudgetCommand}. */
export class ReviseBudgetHandler implements CommandHandler<
  ReviseBudgetCommand,
  ReviseBudgetResult,
  NexoraError
> {
  readonly #service: FinanceApplicationService;

  constructor(service: FinanceApplicationService) {
    this.#service = service;
  }

  handle(command: ReviseBudgetCommand): Promise<Result<ReviseBudgetResult, NexoraError>> {
    return this.#service.reviseBudget(command);
  }
}
