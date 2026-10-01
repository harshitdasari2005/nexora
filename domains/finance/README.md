# @nexora/module-finance

Bounded context: **Finance** (DOMAIN_MODEL.md §1).

Responsibilities: budgets and expenses, with money stored as integer minor units (PERSISTENCE.md §6 — money without float). Owns the Finance agent.

Vertical slice: the `Budget` and `Expense` aggregates, their lifecycles, and a deterministic budget-overrun detection signal feeding the existing remediation/approval pipeline. Invoice, Payment, and CloseTask are the full Phase-1 Finance app scope (ROADMAP.md §7 Wave C) and are not implemented yet.

## Policy (Prompt 5)

What the finance domain actually enforces, and where:

| Rule                                                                            | Where                                                       | Note                                                                                         |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Expense and budget lifecycle transitions; closed budgets are terminal           | aggregates (`src/policies`)                                 | data invariants; no path can skip them                                                       |
| Segregation of duties: a submitter cannot **approve** their own expense         | `Expense.approve`                                           | `reject` is not restricted (a submitter may withdraw)                                        |
| Money movement always needs human approval (BR-19) — **no amount threshold**    | `POLICY_FINANCE_EXPENSE_APPROVAL` (`@nexora/module-policy`) | the "₹50,000" in the sample expense-policy article is prose, not a rule                      |
| No expense against a closed or unresolvable budget, refused **before** approval | `POLICY_FINANCE_BUDGET_STATE`                               | the domain check remains as the last line of defence                                         |
| Optional overrun control per organization                                       | `POLICY_FINANCE_BUDGET_LIMIT` (opt-in, versioned config)    | default: none. Without it only budgets ≥ 90 % utilization are flagged for review (detection) |

The AI/agent/MCP/workflow paths go through the policy engine; direct human REST
actions are governed by RBAC and the domain invariants above. Utilization counts
approved expenses only (pending claims do not count) and sums minor units without
currency conversion — the limit policy therefore denies a currency mismatch.
