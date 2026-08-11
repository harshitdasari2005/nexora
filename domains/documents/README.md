# @nexora/domain-documents

Bounded context: **Documents** (DOMAIN_MODEL.md §14).

Responsibilities: the Document aggregate — metadata + processing lifecycle,
value objects, domain events, policies, repository port, and domain
service. Pure business domain: no persistence, no storage SDKs, no AI.

## What is here

- `Document` aggregate — owned by exactly one organization (`organizationId`,
  the tenant) and one workspace (`workspaceId`); METADATA only (the binary
  content lives behind the application-layer storage port; `ContentRef` is
  the opaque storage key, never the bytes).
- Lifecycle: `uploaded → processing → available`; `failed` (retryable) from
  processing; `archived` (terminal) from available. All transitions follow
  validate → mutate → event; no partial aggregate mutation.
- `DocumentStatus`, `DocumentTitle`, `ContentRef`, `DocumentId` value
  objects.
- Domain events: `document.uploaded`, `document.processing_started`,
  `document.available`, `document.processing_failed`, `document.archived`.
- `DocumentRepository` port — every read is scope-bound (tenant + workspace
  are always part of the query; a document id alone grants nothing).

## Security contract

Authorization is NEVER derived from the filename or content. The aggregate
carries its scope explicitly, and every read/write is gated by the trusted
tenant + workspace (server-side context).
