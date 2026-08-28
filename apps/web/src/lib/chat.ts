/**
 * @nexora/app-web — AI chat client.
 *
 * Streams `POST /api/ai/chat` responses as Server-Sent Events and dispatches
 * them to handlers: `meta` (run + conversation ids), `delta*` (incremental
 * text), `done` (final status + steps). The parser is a pure function
 * (`parseSseEvents`) so it is unit-testable without a DOM or network.
 */

import { ApiError } from './api.js';

/** The chat request body. */
export interface ChatRequest {
  /** The user message. */
  message: string;
  /**
   * Organization scope (validated server-side). Send it whenever the caller
   * may belong to more than one organization — without it the API defaults
   * to the first membership, which may not own `workspaceId` (→ 403).
   */
  organizationId?: string;
  /** Workspace scope (validated server-side). */
  workspaceId?: string;
  /** Continue an existing conversation. */
  conversationId?: string;
}

/** The `meta` event payload. */
export interface ChatMeta {
  /** The run id. */
  runId: string;
  /** The conversation id (for continuing the conversation). */
  conversationId: string;
  /** The understood intent. */
  intent: string;
}

/** An approval gate surfaced by a run (card context — never identity). */
export interface ChatApproval {
  /** The recorded approval request id, when the runtime tracked the request. */
  id?: string;
  /** The guarded step id. */
  stepId: string;
  /** The capability id (card context). */
  capabilityId: string;
  /** The gated tool id. */
  toolId: string;
  /** The gate disposition. */
  status: string;
  /** The side-effect class. */
  sideEffectClass: string;
  /** The user-controlled action input (e.g. `{ name }`). */
  input?: Record<string, unknown>;
}

/** A safe display step of a committed plan (plan card). */
export interface ChatPlanStep {
  /** The plan step id. */
  stepId: string;
  /** The capability planned. */
  capabilityId: string;
  /** The tool planned. */
  toolId: string;
  /** The bound user-controlled input. */
  input?: Record<string, unknown>;
  /** Workflow display steps, when this step orchestrates a workflow. */
  workflowSteps?: readonly { id: string; name: string; capabilityId: string }[];
}

/** A per-step outcome (status + optional workflow journal). */
export interface ChatStep {
  /** The plan step id. */
  stepId: string;
  /** The capability executed. */
  capabilityId: string;
  /** The tool invoked. */
  toolId: string;
  /** The step outcome. */
  status: string;
  /** The tool output (workflow journal for workflow steps). */
  output?: unknown;
}

/** The `done` event payload. */
export interface ChatDone {
  /** The run status. */
  status: string;
  /** The conversation id. */
  conversationId: string;
  /** The final response text. */
  response: string;
  /** The committed plan (plan card rendering). */
  plan: readonly ChatPlanStep[];
  /** Per-step outcomes, in execution order. */
  steps: readonly ChatStep[];
  /** Approval gate outcomes (present when a gate is pending/granted/rejected). */
  approvals: readonly ChatApproval[];
}

/** The response of a rejected approval decision (JSON — no execution). */
export interface RejectApprovalResponse {
  /** The run disposition. */
  status: string;
  /** The conversation id (for continuing the conversation). */
  conversationId: string;
  /** The approval id decided. */
  approvalId: string;
}

/** A parsed SSE event (pure). */
export interface ParsedSseEvent {
  /** The event name. */
  event: string;
  /** The raw data payload. */
  data: string;
}

/** Handlers invoked as the stream progresses. */
export interface ChatHandlers {
  /** Called once when the run metadata arrives. */
  onMeta?: (meta: ChatMeta) => void;
  /** Called per text chunk. */
  onDelta?: (text: string) => void;
  /** Called once when the stream completes. */
  onDone?: (done: ChatDone) => void;
  /** Called when the request fails (HTTP error, network error, parse error). */
  onError?: (error: Error) => void;
}

/**
 * Parses SSE wire text into events (pure; exported for tests).
 *
 * @param text - complete SSE blocks (`event:`/`data:` blocks separated by blank lines).
 *        Unterminated tails are intentionally not parsed here — the streaming
 *        loop keeps them in the buffer via {@link splitSseBuffer}.
 */
export function parseSseEvents(text: string): ParsedSseEvent[] {
  const events: ParsedSseEvent[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (block.trim().length === 0) {
      continue;
    }
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }
    if (dataLines.length > 0) {
      events.push({ event, data: dataLines.join('\n') });
    }
  }
  return events;
}

/**
 * Splits an SSE byte-buffer into complete blocks and the unterminated tail.
 * A block is complete only when terminated by a blank line; a partial block
 * (mid-`data:`) must stay buffered until its terminator arrives so no
 * characters are lost or dispatched prematurely (pure; exported for tests).
 */
export function splitSseBuffer(buffer: string): { complete: string; rest: string } {
  const terminator = buffer.lastIndexOf('\n\n');
  if (terminator === -1) {
    return { complete: '', rest: buffer };
  }
  return { complete: buffer.slice(0, terminator + 2), rest: buffer.slice(terminator + 2) };
}

/**
 * Streams a chat completion from `POST /api/ai/chat`.
 *
 * @param request  - the chat request.
 * @param handlers - stream handlers.
 * @param signal   - optional AbortSignal.
 */
export async function streamChat(
  request: ChatRequest,
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/ai/chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    handlers.onError?.(
      new ApiError(
        0,
        'NETWORK_ERROR',
        error instanceof Error ? error.message : 'Could not reach the AI service',
      ),
    );
    return;
  }
  await consume(response, handlers);
}

/**
 * Submits a decision for an approval request.
 *
 * `approve` resumes the gated run and **streams** the execution (SSE, same
 * contract as {@link streamChat}). `reject` records the rejection with no
 * execution and resolves the JSON outcome.
 *
 * @param approvalId - the recorded approval request id.
 * @param decision   - `approve` or `reject`.
 * @param handlers   - stream handlers (approve only).
 * @param signal     - optional AbortSignal.
 * @returns the rejection outcome when the decision is `reject`.
 */
export async function decideApproval(
  approvalId: string,
  decision: 'approve' | 'reject',
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<RejectApprovalResponse | undefined> {
  let response: Response;
  try {
    response = await fetch(`/api/ai/approvals/${encodeURIComponent(approvalId)}/decision`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
      signal,
    });
  } catch (error) {
    handlers.onError?.(
      new ApiError(
        0,
        'NETWORK_ERROR',
        error instanceof Error ? error.message : 'Could not reach the AI service',
      ),
    );
    return undefined;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { error?: { code?: string; message?: string } } | undefined;
    handlers.onError?.(
      new ApiError(
        response.status,
        body?.error?.code ?? 'INTERNAL_ERROR',
        body?.error?.message ?? 'Request failed',
      ),
    );
    return undefined;
  }

  // Approve resumes the run as an SSE stream; reject resolves as JSON.
  if (
    response.body !== null &&
    (response.headers.get('content-type') ?? '').includes('event-stream')
  ) {
    await consume(response, handlers);
    return undefined;
  }
  const body = (await response.json().catch(() => undefined)) as RejectApprovalResponse | undefined;
  return body;
}

/** Reads an SSE response body, dispatching complete events to the handlers. */
async function consume(response: Response, handlers: ChatHandlers): Promise<void> {
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { error?: { code?: string; message?: string } } | undefined;
    handlers.onError?.(
      new ApiError(
        response.status,
        body?.error?.code ?? 'INTERNAL_ERROR',
        body?.error?.message ?? 'Request failed',
      ),
    );
    return;
  }

  if (response.body === null) {
    handlers.onError?.(new ApiError(response.status, 'STREAM_ERROR', 'Empty response stream'));
    return;
  }

  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: true });
      if (done) {
        break;
      }
      // Dispatch only complete blocks; keep the partial tail buffered so a
      // chunk split mid-`data:` never loses or mangles an event.
      const { complete, rest } = splitSseBuffer(buffer);
      if (complete.length > 0) {
        for (const parsed of parseSseEvents(complete)) {
          dispatch(parsed, handlers);
        }
      }
      buffer = rest;
    }
    // Stream ended: flush any remaining (now-complete) blocks.
    for (const parsed of parseSseEvents(buffer)) {
      dispatch(parsed, handlers);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }
    handlers.onError?.(
      error instanceof Error ? error : new ApiError(0, 'STREAM_ERROR', 'Stream interrupted'),
    );
  }
}

/** Dispatches one parsed event to the matching handler. */
function dispatch(parsed: ParsedSseEvent, handlers: ChatHandlers): void {
  try {
    const data = JSON.parse(parsed.data) as Record<string, unknown>;
    if (parsed.event === 'meta' && handlers.onMeta !== undefined) {
      handlers.onMeta(data as unknown as ChatMeta);
    } else if (parsed.event === 'delta' && handlers.onDelta !== undefined) {
      const text = typeof data['text'] === 'string' ? (data['text'] as string) : '';
      handlers.onDelta(text);
    } else if (parsed.event === 'done' && handlers.onDone !== undefined) {
      handlers.onDone(data as unknown as ChatDone);
    }
  } catch {
    // Malformed payloads are dropped; the terminal `done` event still lands.
  }
}
