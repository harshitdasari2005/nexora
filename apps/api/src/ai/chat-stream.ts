/**
 * @nexora/app-api — chat SSE serialization.
 *
 * Server-Sent Events formatting for the AI chat endpoint. The route streams
 * the orchestrator's response as `meta` → `delta*` → `done` events so the
 * SPA can render progressively (FRONTEND.md §6 streaming responses).
 */

/** A single SSE event to write to the wire. */
export interface SseEvent {
  /** The event name. */
  event: string;
  /** The event payload (serialized as JSON). */
  data: unknown;
}

/** Formats one event into the SSE wire format (`event:` + `data:` + blank line). */
export function formatSse(event: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

/**
 * Paces stream writes so the SPA renders a progressive stream (a single
 * synchronous burst would defeat the streaming UX).
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Splits text into streaming chunks. Chunks respect word boundaries when
 * possible so partial words do not flash on screen.
 */
export function chunkText(text: string, chunkSize = 48): readonly string[] {
  if (text.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + chunkSize, text.length);
    if (end < text.length) {
      const nextSpace = text.indexOf(' ', end);
      if (nextSpace !== -1 && nextSpace - end < chunkSize / 2) {
        end = nextSpace + 1;
      }
    }
    chunks.push(text.slice(cursor, end));
    cursor = end;
  }
  return chunks;
}

/** A single approval gate outcome streamed in the `done` event. */
export interface ChatApprovalPayload {
  /**
   * The recorded approval request id (for posting a decision). Present only
   * when the runtime tracked the request — decisions require a real id.
   */
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
  /** The user-controlled action input (e.g. `{ name }` — never identity). */
  input?: Record<string, unknown>;
}

/** A safe display step of a plan (never identity or chain-of-thought). */
export interface ChatPlanStepPayload {
  /** The plan step id. */
  stepId: string;
  /** The capability planned. */
  capabilityId: string;
  /** The tool planned. */
  toolId: string;
  /** The bound user-controlled input (card context). */
  input?: Record<string, unknown>;
  /** Workflow display steps, when this step orchestrates a workflow. */
  workflowSteps?: readonly { id: string; name: string; capabilityId: string }[];
}

/** A per-step outcome (status + optional workflow journal). */
export interface ChatStepPayload {
  /** The plan step id. */
  stepId: string;
  /** The capability executed. */
  capabilityId: string;
  /** The tool invoked. */
  toolId: string;
  /** The step outcome. */
  status: string;
  /** The tool output (includes the workflow journal for workflow steps). */
  output?: unknown;
}

/** The chat response payload streamed in the terminal `done` event. */
export interface ChatDonePayload {
  /** The run status. */
  status: string;
  /** The conversation id (for continuing the conversation). */
  conversationId: string;
  /** The final response text. */
  response: string;
  /** The committed plan (safe display steps — the UI renders a plan card). */
  plan: readonly ChatPlanStepPayload[];
  /** Per-step outcomes, in execution order. */
  steps: readonly ChatStepPayload[];
  /** Approval gate outcomes (present when a gate is pending/granted/rejected). */
  approvals: readonly ChatApprovalPayload[];
}
