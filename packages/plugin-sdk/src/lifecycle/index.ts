/**
 * @nexora/plugin-sdk — lifecycle.
 *
 * The plugin runtime lifecycle (SAD.md §7.3). The SDK's runtime state is
 * richer than the canonical registry state (`@nexora/contracts/plugin`): it
 * adds `updating` and `failed`. A mapper projects SDK state onto the
 * canonical state for registry reporting; the SDK state is authoritative
 * while a plugin is loaded.
 */

import { PluginLifecycleError } from '../errors/index.js';
import type { PluginId } from '../types/index.js';
import type { PluginLifecycleState } from '@nexora/contracts/plugin';

/** SDK plugin lifecycle states (SAD.md §7.3, DDD.md §14.8). */
export const PLUGIN_STATES = [
  'discovered',
  'installed',
  'enabled',
  'disabled',
  'updating',
  'failed',
  'uninstalled',
] as const;

/** Single SDK plugin lifecycle state literal. */
export type PluginState = (typeof PLUGIN_STATES)[number];

/** A recorded lifecycle transition (observability/audit). */
export interface PluginStateTransition {
  /** Plugin id. */
  pluginId: PluginId;
  /** The previous state. */
  from: PluginState;
  /** The new state. */
  to: PluginState;
  /** Optional reason for the transition. */
  reason?: string;
  /** ISO-8601 UTC time of the transition. */
  occurredAt: string;
}

/** A listener for lifecycle transitions. */
export type PluginStateListener = (transition: PluginStateTransition) => void;

/** The transition table: which states may move to which. */
const TRANSITIONS: Readonly<Record<PluginState, readonly PluginState[]>> = {
  // `updating` from `discovered` supports the upgrade flow, where a fresh
  // plugin instance is driven straight into an update.
  discovered: ['installed', 'updating', 'failed', 'uninstalled'],
  installed: ['enabled', 'disabled', 'updating', 'failed', 'uninstalled'],
  enabled: ['disabled', 'updating', 'failed', 'uninstalled'],
  disabled: ['enabled', 'updating', 'failed', 'uninstalled'],
  updating: ['enabled', 'installed', 'failed'],
  failed: ['installed', 'enabled', 'uninstalled'],
  uninstalled: [],
};

/**
 * Maps an SDK lifecycle state to its canonical registry state
 * (`@nexora/contracts/plugin`). `updating` and `failed` have no canonical
 * equivalent and project to their nearest stable state for registry
 * reporting.
 */
export function toCanonicalState(state: PluginState): PluginLifecycleState {
  switch (state) {
    case 'discovered':
      return 'validated';
    case 'installed':
    case 'updating':
      return 'installed';
    case 'enabled':
      return 'active';
    case 'disabled':
    case 'failed':
      return 'disabled';
    case 'uninstalled':
      return 'uninstalled';
  }
}

/**
 * The plugin lifecycle state machine. Enforces the transition table above;
 * invalid transitions throw {@link PluginLifecycleError}. Thread-safety is
 * the owner's concern at the platform boundary.
 */
export class PluginLifecycleStateMachine {
  #state: PluginState = 'discovered';
  readonly #listeners = new Set<PluginStateListener>();
  readonly #history: PluginStateTransition[] = [];

  /**
   * @param pluginId - the plugin id this machine belongs to.
   */
  constructor(private readonly pluginId: PluginId) {}

  /** The current SDK lifecycle state. */
  get state(): PluginState {
    return this.#state;
  }

  /** The current state projected onto the canonical registry state. */
  get canonicalState(): PluginLifecycleState {
    return toCanonicalState(this.#state);
  }

  /** Whether the machine is in the given state. */
  is(state: PluginState): boolean {
    return this.#state === state;
  }

  /** Whether a transition to `to` is allowed from the current state. */
  canTransition(to: PluginState): boolean {
    return TRANSITIONS[this.#state].includes(to);
  }

  /**
   * Attempts a transition. Throws {@link PluginLifecycleError} when
   * invalid. Idempotent when the target equals the current state.
   *
   * @param to     - the target state.
   * @param reason - optional reason recorded on the transition.
   */
  transition(to: PluginState, reason?: string): PluginStateTransition {
    if (to === this.#state) {
      return this.#record(this.#state, this.#state, reason ?? 'no-op');
    }
    if (!this.canTransition(to)) {
      throw new PluginLifecycleError(
        `Invalid plugin lifecycle transition: ${this.#state} → ${to}`,
        { pluginId: this.pluginId, from: this.#state, to },
      );
    }
    return this.#record(this.#state, to, reason ?? 'lifecycle');
  }

  /** Registers a transition listener. Returns an unsubscribe function. */
  onTransition(listener: PluginStateListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** All transitions recorded so far (audit). */
  history(): readonly PluginStateTransition[] {
    return [...this.#history];
  }

  #record(from: PluginState, to: PluginState, reason?: string): PluginStateTransition {
    const transition: PluginStateTransition = {
      pluginId: this.pluginId,
      from,
      to,
      reason,
      occurredAt: new Date().toISOString(),
    };
    this.#state = to;
    this.#history.push(transition);
    for (const listener of this.#listeners) {
      listener(transition);
    }
    return transition;
  }
}
