/**
 * @nexora/ai-runtime — runtime events.
 *
 * The runtime's internal event vocabulary (AIR.md §16 execution timeline):
 * planning, execution, and response events emitted by the orchestrator. The
 * event bus bridges these to the canonical platform envelope at the boundary
 * (SAD.md §11); the runtime itself stays transport-agnostic.
 */

/** A plan was created for a run. */
export interface PlanCreatedEvent {
  type: 'plan.created';
  /** Run id the plan belongs to. */
  runId: string;
  /** The plan id. */
  planId: string;
  /** The user intent. */
  intent: string;
  /** Number of steps in the plan. */
  stepCount: number;
  /** Number of approval gates in the plan. */
  gateCount: number;
  /** ISO-8601 UTC time of the event. */
  occurredAt: string;
}

/** A plan finished executing. */
export interface PlanExecutedEvent {
  type: 'plan.executed';
  /** Run id the plan belongs to. */
  runId: string;
  /** The plan id. */
  planId: string;
  /** Whether the plan completed successfully. */
  success: boolean;
  /** ISO-8601 UTC time of the event. */
  occurredAt: string;
}

/** A tool invocation started. */
export interface ToolInvokedEvent {
  type: 'tool.invoked';
  /** Run id the invocation belongs to. */
  runId: string;
  /** The tool id invoked. */
  toolId: string;
  /** The plan step id. */
  stepId: string;
  /** ISO-8601 UTC time of the event. */
  occurredAt: string;
}

/** A tool invocation succeeded. */
export interface ToolSucceededEvent {
  type: 'tool.succeeded';
  /** Run id the invocation belongs to. */
  runId: string;
  /** The tool id invoked. */
  toolId: string;
  /** The plan step id. */
  stepId: string;
  /** Whether the result was verified (AI-6). */
  verified: boolean;
  /** ISO-8601 UTC time of the event. */
  occurredAt: string;
}

/** A tool invocation failed. */
export interface ToolFailedEvent {
  type: 'tool.failed';
  /** Run id the invocation belongs to. */
  runId: string;
  /** The tool id invoked. */
  toolId: string;
  /** The plan step id. */
  stepId: string;
  /** The failure code. */
  code: string;
  /** The failure message. */
  message: string;
  /** ISO-8601 UTC time of the event. */
  occurredAt: string;
}

/** A response was generated for a run. */
export interface ResponseGeneratedEvent {
  type: 'response.generated';
  /** Run id the response belongs to. */
  runId: string;
  /** The conversation id. */
  conversationId: string;
  /** The response status. */
  status: 'completed' | 'clarification' | 'blocked' | 'failed';
  /** ISO-8601 UTC time of the event. */
  occurredAt: string;
}

/** The union of runtime events. */
export type RuntimeEvent =
  | PlanCreatedEvent
  | PlanExecutedEvent
  | ToolInvokedEvent
  | ToolSucceededEvent
  | ToolFailedEvent
  | ResponseGeneratedEvent;

/** A runtime event subscriber. */
export type RuntimeEventSubscriber = (event: RuntimeEvent) => void;

/** The in-memory runtime event bus. */
export class RuntimeEventBus {
  readonly #subscribers = new Set<RuntimeEventSubscriber>();
  readonly #history: RuntimeEvent[] = [];
  readonly #historyLimit: number;

  /**
   * @param historyLimit - max events kept in history (oldest dropped).
   */
  constructor(historyLimit = 1_000) {
    this.#historyLimit = historyLimit;
  }

  /** Publishes an event to all subscribers and records it in history. */
  publish(event: RuntimeEvent): void {
    this.#history.push(event);
    if (this.#history.length > this.#historyLimit) {
      this.#history.splice(0, this.#history.length - this.#historyLimit);
    }
    for (const subscriber of this.#subscribers) {
      subscriber(event);
    }
  }

  /** Subscribes to events. Returns an unsubscribe function. */
  subscribe(subscriber: RuntimeEventSubscriber): () => void {
    this.#subscribers.add(subscriber);
    return () => {
      this.#subscribers.delete(subscriber);
    };
  }

  /** Events published so far (for observability and tests). */
  history(): readonly RuntimeEvent[] {
    return [...this.#history];
  }

  /** Whether the bus has any subscribers. */
  get hasSubscribers(): boolean {
    return this.#subscribers.size > 0;
  }
}
