/**
 * @nexora/app-api — CreateCalendarEventTool.
 *
 * The Calendar write capability exposed to the Enterprise AI Runtime: it
 * schedules a calendar entry in the current workspace through the Calendar
 * **application layer** — the SAME `CreateCalendarEventHandler` the REST
 * surface uses — so humans and AI converge on one business execution path.
 * The application layer walks the entry lifecycle (scheduled → cancelled,
 * BR-calendar), so a scheduled entry is cancellable and reschedulable.
 *
 * Security contract (same model as every tool):
 * - Input accepts ONLY the user-controlled business values (`title`,
 *   `startsAt`, `endsAt`) — `additionalProperties: false`. The model can
 *   never supply `userId`, `tenantId`, `organizationId`, `workspaceId`,
 *   permissions, or approval state — identity, tenant, and workspace come
 *   exclusively from the trusted execution context assembled from the
 *   authenticated session.
 * - Workspace scope is mandatory: calendar entries are workspace-scoped.
 *   Without a trusted workspace context the tool fails closed — there is no
 *   cross-workspace fallback (same rule as knowledge retrieval).
 * - Authorization mirrors the REST surface (`POST /api/calendar/events`):
 *   membership of the trusted tenant AND the trusted workspace are the
 *   rules. "Act as an administrator" changes nothing.
 * - Delegation: the tool calls the CreateCalendarEventHandler (application
 *   layer) — never Drizzle, never repositories, never domain objects.
 * - Verification: the created entry must belong to the trusted tenant +
 *   workspace; the model never decides success — the application result is
 *   authoritative.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type {
  CreateCalendarEventHandler,
  ListCalendarEventsHandler,
} from '@nexora/application-calendar';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

/** Input contract: ONLY user-controlled business values (identity is never input). */
export interface CreateCalendarEventInput {
  /** The entry title (user-controlled business value). */
  title: string;
  /** ISO-8601 UTC start instant. */
  startsAt: string;
  /** ISO-8601 UTC end instant. */
  endsAt: string;
}

/** Output contract of {@link CreateCalendarEventTool}. */
export interface CreateCalendarEventOutput {
  /** The created (scheduled) calendar entry (authoritative application-layer result). */
  event: {
    /** The entry id. */
    id: string;
    /** The title. */
    title: string;
    /** ISO-8601 UTC start instant. */
    startsAt: string;
    /** ISO-8601 UTC end instant. */
    endsAt: string;
    /** The lifecycle status (`scheduled`). */
    status: string;
    /** The owning workspace id — must equal the trusted workspace. */
    workspaceId: string;
    /** ISO-8601 UTC creation time. */
    createdAt: string;
  };
}

/** The tool manifest: consequential (persistent state change, always gated). */
export const CREATE_CALENDAR_EVENT_MANIFEST: ToolManifest = {
  id: 'calendar.create_event',
  name: 'Create calendar event',
  description: 'Creates a calendar event in the current workspace',
  sideEffectClass: 'consequential',
  idempotent: false,
  timeoutMs: 15_000,
  // Read-back: the created record is re-read from persisted state.
  verification: { source: 'state_readback' },
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 120 },
      startsAt: { type: 'string', minLength: 1 },
      endsAt: { type: 'string', minLength: 1 },
    },
    required: ['title', 'startsAt', 'endsAt'],
    additionalProperties: false,
  },
};

/** The maximum title length (mirrors the application validator). */
const TITLE_MAX_LENGTH = 120;

/**
 * The write tool that schedules a calendar entry through the Calendar
 * application layer under the trusted execution context.
 */
export class CreateCalendarEventTool implements Tool<
  CreateCalendarEventInput,
  CreateCalendarEventOutput
> {
  readonly manifest = CREATE_CALENDAR_EVENT_MANIFEST;

  readonly #createCalendarEvent: CreateCalendarEventHandler;
  readonly #listOrganizations: ListOrganizationsHandler;
  readonly #listMyWorkspaces: ListMyWorkspacesHandler;
  readonly #listCalendarEvents: ListCalendarEventsHandler;

  constructor(dependencies: {
    /** The application-layer create-calendar-event command handler. */
    createCalendarEvent: CreateCalendarEventHandler;
    /** Resolves the caller's organization memberships (authorization rule). */
    listOrganizations: ListOrganizationsHandler;
    /** Resolves the caller's workspace memberships (authorization rule). */
    listMyWorkspaces: ListMyWorkspacesHandler;
    /**
     * The workspace-scoped read-back handler (S24 Phase 4 verification):
     * after creation the tool reads the persisted state back and confirms
     * the created entry exists in the trusted workspace — a failed
     * read-back is reported as a failure, never as success.
     */
    listCalendarEvents: ListCalendarEventsHandler;
  }) {
    this.#createCalendarEvent = dependencies.createCalendarEvent;
    this.#listOrganizations = dependencies.listOrganizations;
    this.#listMyWorkspaces = dependencies.listMyWorkspaces;
    this.#listCalendarEvents = dependencies.listCalendarEvents;
  }

  async execute(
    input: CreateCalendarEventInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<CreateCalendarEventOutput>> {
    // 1. Validate the user-controlled input (untrusted model/user values).
    const title = typeof input?.title === 'string' ? input.title.trim() : '';
    if (title.length === 0) {
      return this.#failure('An event title is required');
    }
    if (title.length > TITLE_MAX_LENGTH) {
      return this.#failure(`Event title must be at most ${TITLE_MAX_LENGTH} characters`);
    }
    const timeWindow = parseTimeWindow(input);
    if (timeWindow === undefined) {
      return this.#failure(
        'The event needs valid start and end times (ISO-8601 UTC, end after start)',
      );
    }

    // 2. Workspace scope is mandatory: calendar entries are workspace-scoped.
    //    Without a trusted workspace context the tool fails closed — there
    //    is no cross-workspace fallback.
    const workspaceId = context.workspaceId;
    if (workspaceId === undefined || workspaceId.length === 0) {
      return this.#failure('A workspace is required to create a calendar event');
    }

    // 3. Authorization: the caller must be a member of the trusted tenant
    //    AND the trusted workspace. Identity, tenant, and workspace come
    //    from the trusted execution context — never from the prompt or tool
    //    arguments.
    const membership = await this.#listOrganizations.handle({
      userId: context.userId as UserId,
    });
    if (!membership.ok || !membership.value.some((org) => org.id === context.tenantId)) {
      return this.#failure(
        'You are not authorized to create a calendar event in this organization',
      );
    }
    const workspaces = await this.#listMyWorkspaces.handle({
      userId: context.userId as UserId,
      organizationId: context.tenantId as TenantId,
    });
    if (!workspaces.ok || !workspaces.value.some((workspace) => workspace.id === workspaceId)) {
      return this.#failure('You are not authorized to create a calendar event in this workspace');
    }

    // 4. Delegate to the application layer (the authoritative path).
    const result = await this.#createCalendarEvent.handle({
      organizationId: context.tenantId as TenantId,
      workspaceId: workspaceId as WorkspaceId,
      createdBy: context.userId as UserId,
      title,
      startsAt: timeWindow.startsAt,
      endsAt: timeWindow.endsAt,
      actorId: context.userId as UserId,
      correlationId: context.executionId,
    });
    if (!result.ok) {
      return this.#failure(createCalendarEventErrorMessage(result.error));
    }

    // 5. Verify the authoritative result against the trusted scope. The
    //    model never decides success — the application result is the source
    //    of truth, and this check is defense-in-depth.
    const entry = result.value.entry;
    if (entry.organizationId !== context.tenantId || entry.workspaceId !== workspaceId) {
      return this.#verificationFailure('Calendar event verification failed: unexpected scope');
    }

    // 6. Read-back verification (S24 Phase 4): read the persisted state
    //    back through the query surface and confirm the created entry is
    //    actually present in the trusted workspace. A failed read-back is
    //    surfaced as a failure — never reported as success.
    const readBack = await this.#listCalendarEvents.handle({
      organizationId: context.tenantId as TenantId,
      workspaceId: workspaceId as WorkspaceId,
    });
    const persisted =
      readBack.ok &&
      readBack.value.some(
        (event) =>
          event.id === entry.id &&
          event.workspaceId === workspaceId &&
          event.organizationId === context.tenantId,
      );
    if (!persisted) {
      return this.#verificationFailure(
        'Calendar event verification failed: created event not found in the workspace',
      );
    }

    return {
      ok: true,
      output: {
        event: {
          id: entry.id,
          title: entry.title.value,
          startsAt: entry.timeWindow.startsAt,
          endsAt: entry.timeWindow.endsAt,
          status: entry.status.value,
          workspaceId: entry.workspaceId,
          createdAt: entry.createdAt,
        },
      },
      completedAt: new Date().toISOString(),
    };
  }

  /** A failed read-back / result verification: failed AND unverified with the declared source. */
  #verificationFailure(error: string): ToolResult<CreateCalendarEventOutput> {
    return { ...this.#failure(error), readBackFailed: true };
  }

  #failure(error: string): ToolResult<CreateCalendarEventOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}

/** Parses and validates the model-supplied time window (end after start). */
function parseTimeWindow(input: {
  startsAt?: unknown;
  endsAt?: unknown;
}): { startsAt: string; endsAt: string } | undefined {
  const startsAt = typeof input?.startsAt === 'string' ? input.startsAt : '';
  const endsAt = typeof input?.endsAt === 'string' ? input.endsAt : '';
  const startTime = startsAt.length > 0 ? Date.parse(startsAt) : Number.NaN;
  const endTime = endsAt.length > 0 ? Date.parse(endsAt) : Number.NaN;
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return undefined;
  }
  if (endTime <= startTime) {
    return undefined;
  }
  return { startsAt, endsAt };
}

/**
 * Maps an application-layer error to a safe user-facing message (never
 * internal details or stack traces).
 */
function createCalendarEventErrorMessage(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return 'The event details are invalid';
    default:
      return 'Could not create the calendar event';
  }
}
