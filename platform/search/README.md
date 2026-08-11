# @nexora/module-search

Bounded context: **Search** (DOMAIN_MODEL.md §1).

Responsibilities: unified, permission-filtered search across documents /
knowledge (BR-7) via a single replaceable index port.

## What is here

- `SearchIndexEntry` — the disposable projection shape (scope-bound:
  tenant + workspace are part of every entry).
- `SearchIndexPort` — the ONE search seam: `put`, `removeByScope`, `query`
  (scope-filtered). Persistence implementations (Drizzle in
  `@nexora/persistence`) and in-memory implementations swap behind this
  port without touching callers.
- `lexical-search` — deterministic tokenized scoring (`rankEntries`,
  `tokenize`) over the **authorized candidates only**: the scope filter is
  applied FIRST (by the port implementation), then the scorer ranks.
- `InMemorySearchIndex` — the port implementation for tests and local runs.

## Security contract

The scope filter is mandatory and applied before any scoring: no entry
outside the caller's trusted tenant + workspace can ever be considered,
ranked, or returned. The model is never the authorization boundary —
retrieval is permission-filtered BEFORE content reaches the AI.

Vector retrieval is a future upgrade behind the same port; the deterministic
lexical path serves the current vertical slice (PERSISTENCE.md §12).
