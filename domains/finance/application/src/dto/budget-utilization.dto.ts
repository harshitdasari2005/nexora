/**
 * @nexora/application-finance — budget utilization DTO.
 *
 * The ONE computed projection of "how much of a budget has been spent":
 * approved expenses claimed against the budget, summed in the SAME currency
 * (this vertical slice does not convert currencies — see `Money`'s doc
 * comment). Every consumer that needs utilization (the REST API, the
 * Command Center widget provider, the detection snapshot loader) reads
 * THIS single query — the computation is never duplicated.
 */

/** A budget's computed utilization. */
export interface BudgetUtilizationDto {
  budgetId: string;
  name: string;
  currency: string;
  allocatedMinorUnits: number;
  /** Sum of APPROVED expense amounts claimed against this budget. */
  spentMinorUnits: number;
  /** `round(spent / allocated * 100)`, 0 when `allocatedMinorUnits` is 0. */
  utilizationPercent: number;
  status: string;
}
