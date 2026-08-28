# @nexora/module-finance

Bounded context: **Finance** (DOMAIN_MODEL.md §1).

Responsibilities: budgets and expenses, with money stored as integer minor units (PERSISTENCE.md §6 — money without float). Owns the Finance agent.

Vertical slice: the `Budget` and `Expense` aggregates, their lifecycles, and a deterministic budget-overrun detection signal feeding the existing remediation/approval pipeline. Invoice, Payment, and CloseTask are the full Phase-1 Finance app scope (ROADMAP.md §7 Wave C) and are not implemented yet.
