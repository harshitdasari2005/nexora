/**
 * @nexora/agent-sdk — events.
 *
 * Agent lifecycle and execution events (AIR.md §3 `events` element). The
 * SDK emits these through an `AgentEventBus`; the platform forwards them to
 * the canonical event bus (`@nexora/shared/events`) at the boundary. The
 * SDK itself stays transport-agnostic.
 */

import type { AgentId, ExecutionId } from '../types/index.js';

/** Discriminated union of agent events. */
export type AgentEvent =
  | AgentRegisteredEvent
  | AgentReadyEvent
  | ExecutionStartedEvent
  | ExecutionCompletedEvent
  | ExecutionFailedEvent
  | HealthChangedEvent
  | CapabilityAddedEvent
  | CapabilityRemovedEvent;

/** Base fields shared by every agent event. */
interface AgentEventBase {
  /** The agent id the event belongs to. */
  agentId: AgentId;
  /** ISO-8601 UTC time the event occurred. */
  occurredAt: string;
}

/** Emitted when an agent registers with the platform. */
export interface AgentRegisteredEvent extends AgentEventBase {
  type: 'agent.registered';
  /** The agent version at registration. */
  version: string;
}

/** Emitted when an agent becomes ready to execute. */
export interface AgentReadyEvent extends AgentEventBase {
  type: 'agent.ready';
}

/** Emitted when an execution starts. */
export interface ExecutionStartedEvent extends AgentEventBase {
  type: 'execution.started';
  /** The execution id. */
  executionId: ExecutionId;
}

/** Emitted when an execution completes successfully. */
export interface ExecutionCompletedEvent extends AgentEventBase {
  type: 'execution.completed';
  /** The execution id. */
  executionId: ExecutionId;
  /** ISO-8601 UTC time the execution finished. */
  finishedAt: string;
}

/** Emitted when an execution fails. */
export interface ExecutionFailedEvent extends AgentEventBase {
  type: 'execution.failed';
  /** The execution id. */
  executionId: ExecutionId;
  /** The failure code. */
  code: string;
  /** The failure message. */
  message: string;
}

/** Emitted when the agent health status changes. */
export interface HealthChangedEvent extends AgentEventBase {
  type: 'health.changed';
  /** The previous health status. */
  previous: string;
  /** The new health status. */
  current: string;
}

/** Emitted when a capability is added to the agent. */
export interface CapabilityAddedEvent extends AgentEventBase {
  type: 'capability.added';
  /** The capability id added. */
  capabilityId: string;
}

/** Emitted when a capability is removed from the agent. */
export interface CapabilityRemovedEvent extends AgentEventBase {
  type: 'capability.removed';
  /** The capability id removed. */
  capabilityId: string;
}

/** A subscriber of agent events. */
export type AgentEventSubscriber = (event: AgentEvent) => void;

/** Options for constructing an {@link AgentEventBus}. */
export interface AgentEventBusOptions {
  /**
   * Maximum events kept in history (oldest dropped). Default 1000.
   */
  historyLimit?: number;
}

/**
 * The agent event bus: a typed, in-memory pub/sub for agent events. The
 * platform bridges these to the canonical event bus at the boundary.
 *
 * History is bounded ({@link AgentEventBusOptions.historyLimit}, default
 * 1000) so long-lived agents cannot leak memory (oldest events are
 * dropped).
 */
export class AgentEventBus {
  readonly #subscribers = new Set<AgentEventSubscriber>();
  readonly #history: AgentEvent[] = [];
  readonly #historyLimit: number;

  /**
   * @param options - bus options.
   */
  constructor(options: AgentEventBusOptions = {}) {
    this.#historyLimit = options.historyLimit ?? 1000;
  }

  /** Publishes an event to all subscribers and records it in history. */
  publish(event: AgentEvent): void {
    this.#history.push(event);
    if (this.#history.length > this.#historyLimit) {
      this.#history.splice(0, this.#history.length - this.#historyLimit);
    }
    for (const subscriber of this.#subscribers) {
      subscriber(event);
    }
  }

  /** Subscribes to events. Returns an unsubscribe function. */
  subscribe(subscriber: AgentEventSubscriber): () => void {
    this.#subscribers.add(subscriber);
    return () => {
      this.#subscribers.delete(subscriber);
    };
  }

  /** Events published so far (for observability and tests). */
  history(): readonly AgentEvent[] {
    return [...this.#history];
  }

  /** Whether the event bus has any subscribers. */
  get hasSubscribers(): boolean {
    return this.#subscribers.size > 0;
  }
}
