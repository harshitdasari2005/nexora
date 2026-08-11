/**
 * @nexora/agent-sdk — lifecycle.
 *
 * The agent lifecycle state machine (AIR.md §4): registered → ready →
 * executing → waiting/paused/disabled/recovering/updating → retired.
 * Transitions are validated; invalid transitions raise
 * `InvalidLifecycleTransitionError`. The state machine is generic and
 * reusable by any agent.
 */

import { InvalidLifecycleTransitionError } from '../errors/index.js';

/**
 * Lifecycle states of an agent (AIR.md §4, DDD.md §14.6).
 */
export const AGENT_LIFECYCLE_STATES = [
  'registered',
  'ready',
  'executing',
  'waiting',
  'paused',
  'disabled',
  'recovering',
  'updating',
  'retired',
] as const;

/** Single agent lifecycle state literal. */
export type AgentLifecycleState = (typeof AGENT_LIFECYCLE_STATES)[number];

/**
 * Allowed transitions. `executing` is the active state during an execution;
 * the runtime derives the "suspended" group from the executing state.
 */
const TRANSITIONS: Readonly<Record<AgentLifecycleState, readonly AgentLifecycleState[]>> = {
  registered: ['ready', 'disabled', 'retired'],
  ready: ['executing', 'disabled', 'updating', 'retired'],
  executing: ['ready', 'waiting', 'paused', 'disabled', 'recovering', 'retired'],
  waiting: ['ready', 'executing', 'paused', 'disabled', 'retired'],
  paused: ['ready', 'executing', 'disabled', 'updating', 'retired'],
  disabled: ['ready', 'updating', 'retired'],
  recovering: ['ready', 'executing', 'disabled', 'retired'],
  updating: ['ready', 'disabled', 'retired'],
  retired: [],
};

/**
 * A lifecycle event describing a state transition (for observability and
 * event emission).
 */
export interface LifecycleTransition {
  /** The agent id. */
  agentId: string;
  /** The state before the transition. */
  from: AgentLifecycleState;
  /** The state after the transition. */
  to: AgentLifecycleState;
  /** ISO-8601 UTC time of the transition. */
  at: string;
  /** Optional reason for the transition. */
  reason?: string;
}

/**
 * A listener notified on every lifecycle transition.
 */
export type LifecycleListener = (transition: LifecycleTransition) => void;

/**
 * The agent lifecycle state machine.
 */
export class LifecycleStateMachine {
  #state: AgentLifecycleState;
  readonly #agentId: string;
  readonly #listeners: Set<LifecycleListener>;

  /**
   * @param agentId - the owning agent id.
   * @param initial - initial state; defaults to `registered`.
   */
  constructor(agentId: string, initial: AgentLifecycleState = 'registered') {
    this.#agentId = agentId;
    this.#state = initial;
    this.#listeners = new Set();
  }

  /** The current lifecycle state. */
  get state(): AgentLifecycleState {
    return this.#state;
  }

  /** True when the agent can accept an execution (`ready`). */
  get isReady(): boolean {
    return this.#state === 'ready';
  }

  /** True when the agent is mid-execution. */
  get isExecuting(): boolean {
    return this.#state === 'executing';
  }

  /**
   * Attempts a transition. Throws `InvalidLifecycleTransitionError` when the
   * transition is not allowed from the current state.
   *
   * @param to     - the target state.
   * @param reason - optional reason recorded on the transition event.
   */
  transition(to: AgentLifecycleState, reason?: string): void {
    const allowed = TRANSITIONS[this.#state];
    if (!allowed.includes(to)) {
      throw new InvalidLifecycleTransitionError(
        `Invalid lifecycle transition for agent ${this.#agentId}: ${this.#state} → ${to}`,
        { from: this.#state, to },
      );
    }
    const from = this.#state;
    this.#state = to;
    this.#notify({ agentId: this.#agentId, from, to, at: new Date().toISOString(), reason });
  }

  /**
   * Returns true when the transition would be allowed (no state change).
   */
  canTransition(to: AgentLifecycleState): boolean {
    return TRANSITIONS[this.#state].includes(to);
  }

  /** Subscribes to transitions. Returns an unsubscribe function. */
  onTransition(listener: LifecycleListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #notify(transition: LifecycleTransition): void {
    for (const listener of this.#listeners) {
      listener(transition);
    }
  }
}
