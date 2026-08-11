# Knowledge AI Capability — SearchKnowledgeTool & permission-filtered retrieval

The **Documents + Knowledge vertical slice** capability surface: upload a
document (REST) → process → index → answer questions about it through the
`knowledge.search` capability, with citations to the authorized sources.
This document is the capability-specific contract; the general security
model is in `platform/ai-runtime/docs/APPROVAL.md` and
`platform/ai-runtime/docs/SECURITY.md`.

## Domain ownership (single source of truth)

| Concern                                  | Owning bounded context                                 |
| ---------------------------------------- | ------------------------------------------------------ |
| Document lifecycle + metadata            | `domains/documents` (Documents)                        |
| Document binary content (bytes)          | Storage port (`DocumentStorage` — never PostgreSQL)    |
| Text extraction (processing seam)        | Extractor port (`DocumentTextExtractor` — replaceable) |
| Knowledge sources + citations            | `domains/knowledge` (Knowledge)                        |
| Indexing + permission-filtered retrieval | `platform/search` (SearchIndexPort, BR-7)              |

Documents owns **metadata + lifecycle**; Knowledge owns **the searchable
projection of a document version**; Search is the **generic permission-
filtered projection** the Knowledge application uses. There is exactly one
search implementation (the SearchIndexPort) and one authorization model
(trusted tenant + workspace membership).

## Search workspace knowledge (read)

- **Tool id:** `knowledge.search`
- **Side-effect class:** `read_only` — never gated.
- **Input:** ONLY `question`, `additionalProperties: false`. The model can
  never supply `tenantId`, `workspaceId`, `userId`, or any permission
  override — the scope comes exclusively from the **trusted execution
  context** (the authenticated session's tenant + the validated workspace).
- **Business path:** `SearchKnowledgeTool → RetrieveKnowledgeHandler` — the
  SAME application boundary the REST surface
  (`GET /api/knowledge/search`) uses; one retrieval path for humans and
  agents.
- **Fail-closed:** without a trusted workspace context the tool refuses to
  run (no cross-workspace fallback).

## Permission-filtered retrieval (BR-7 — the security core)

The model is NEVER the authorization boundary. Retrieval filters BEFORE any
content is presented:

```
Authenticated Context → Permission Evaluation → Authorized Candidates
→ Retrieval (tenant + workspace scoped) → Grounded Context → AI
```

The SearchIndexPort applies the scope filter in the query FIRST (SQL-level
`tenant_id` + `workspace_id` for the Drizzle store; mandatory filter in the
in-memory store), and only then ranks the authorized candidates. A user who
is not a member of the workspace, a different workspace, or a different
tenant can never retrieve the document — a poisoned document or an
injection prompt cannot widen the scope.

## Deterministic knowledge-question fallback

Knowledge questions frequently contain no document/knowledge vocabulary
("What is the deadline for the Mobile Banking project?"), so the token
matcher cannot route them. `KnowledgeFallbackMatcher`
(`apps/api/src/ai/knowledge-fallback.ts`) wraps the base matcher with a
narrow, deterministic fallback:

- Fires ONLY when no other capability matched AND the intent is a question.
- Routes to the registered, permission-filtered `knowledge.search`
  capability — the model cannot enable it.
- Never fires for non-question intents (imperatives still clarify).

## Citation behavior

The retrieval result is a list of `KnowledgeReferenceDto` citations
(source id, document id, title, workspace, bounded snippet). Citations only
ever reference sources the caller's trusted tenant + workspace can access —
the permission filter runs before any content reaches the model. When the
authorized documents do not establish an answer, the narration says so
rather than fabricating a citation.

## Document → Knowledge flow

```
Upload → store bytes → persist metadata (uploaded) → processing →
extract → available (or honest failed) → index (Knowledge) →
permission-filtered retrieval → grounded answer + citation
```

Every transition is represented by the document lifecycle
(`uploaded → processing → available`; `failed` retryable; `archived`
terminal). Indexing is never faked: a failed extraction produces a `failed`
document and no index entry. Archiving removes the document AND its index
entry (best-effort cleanup after the authoritative mutation).
