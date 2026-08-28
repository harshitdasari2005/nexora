/**
 * @nexora/application-finance — FlagOverBudgetItemsHandler.
 *
 * The application entry point for the deterministic remediation action:
 * delegates to the {@link FinanceApplicationService}. Both the REST surface
 * (a human-triggered "flag now" action) and the
 * `finance.flag_over_budget_items` AI Runtime tool (the governed remediation
 * step) call this SAME handler — one execution path.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type {
  FlagOverBudgetItemsCommand,
  FlagOverBudgetItemsResult,
} from '../commands/flag-over-budget-items.command.js';
import type { FinanceApplicationService } from '../services/finance-application-service.js';

/** Handles {@link FlagOverBudgetItemsCommand}. */
export class FlagOverBudgetItemsHandler implements CommandHandler<
  FlagOverBudgetItemsCommand,
  FlagOverBudgetItemsResult,
  NexoraError
> {
  readonly #service: FinanceApplicationService;

  constructor(service: FinanceApplicationService) {
    this.#service = service;
  }

  handle(
    command: FlagOverBudgetItemsCommand,
  ): Promise<Result<FlagOverBudgetItemsResult, NexoraError>> {
    return this.#service.flagOverBudgetItems(command);
  }
}
