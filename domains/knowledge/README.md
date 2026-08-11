# @nexora/domain-knowledge

Bounded context: **Knowledge** (DOMAIN_MODEL.md §14, BR-7).

Responsibilities: the KnowledgeSource aggregate — the searchable projection
of a document version — value objects, domain events, repository port, and
errors. Pure business domain: no persistence, no search engine, no AI.

## What is here

- `KnowledgeSource` aggregate — one source per indexed document within a
  scope (tenant + workspace); carries the display title used for citations
  and the normalized searchable text (never raw file bytes).
- Domain events: `knowledge.indexed`, `knowledge.removed`.
- `KnowledgeSourceRepository` port — reads are scope-bound (tenant +
  workspace are always part of the query).

## How it connects

The **application layer** (`@nexora/application-knowledge`) orchestrates the
permission-filtered retrieval: it persists sources through this port and
delegates indexing/retrieval to the generic Search platform port
(`@nexora/module-search`). Re-indexing a document version UPSERTS the
source (reusing its id) so a stale index entry never answers; archiving
removes the source and the index entry.
