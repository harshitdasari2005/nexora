/**
 * Lifecycle state machine tests.
 */

import { describe, expect, it } from 'vitest';

import { InvalidLifecycleTransitionError } from '../src/errors/index.js';
import { LifecycleStateMachine } from '../src/lifecycle/index.js';

describe('LifecycleStateMachine', () => {
  it('starts in the registered state by default', () => {
    const lifecycle = new LifecycleStateMachine('agt_1');
    expect(lifecycle.state).toBe('registered');
  });

  it('starts in a custom initial state', () => {
    const lifecycle = new LifecycleStateMachine('agt_1', 'ready');
    expect(lifecycle.state).toBe('ready');
  });

  it('transitions along a valid path', () => {
    const lifecycle = new LifecycleStateMachine('agt_1');
    lifecycle.transition('ready');
    lifecycle.transition('executing');
    lifecycle.transition('ready');
    expect(lifecycle.state).toBe('ready');
  });

  it('throws on invalid transitions', () => {
    const lifecycle = new LifecycleStateMachine('agt_1');
    expect(() => lifecycle.transition('executing')).toThrowError(InvalidLifecycleTransitionError);
  });

  it('throws on transitions from retired', () => {
    const lifecycle = new LifecycleStateMachine('agt_1');
    lifecycle.transition('retired');
    expect(() => lifecycle.transition('ready')).toThrowError(InvalidLifecycleTransitionError);
  });

  it('exposes isReady and isExecuting', () => {
    const lifecycle = new LifecycleStateMachine('agt_1');
    expect(lifecycle.isReady).toBe(false);
    lifecycle.transition('ready');
    expect(lifecycle.isReady).toBe(true);
    lifecycle.transition('executing');
    expect(lifecycle.isExecuting).toBe(true);
    expect(lifecycle.isReady).toBe(false);
  });

  it('canTransition reports validity without changing state', () => {
    const lifecycle = new LifecycleStateMachine('agt_1');
    expect(lifecycle.canTransition('ready')).toBe(true);
    expect(lifecycle.canTransition('executing')).toBe(false);
    expect(lifecycle.state).toBe('registered');
  });

  it('notifies listeners with from/to/reason', () => {
    const lifecycle = new LifecycleStateMachine('agt_1');
    const transitions: string[] = [];
    lifecycle.onTransition((transition) => {
      transitions.push(`${transition.from}->${transition.to}:${transition.reason ?? 'none'}`);
    });
    lifecycle.transition('ready', 'initializing');
    expect(transitions).toEqual(['registered->ready:initializing']);
  });

  it('unsubscribes listeners', () => {
    const lifecycle = new LifecycleStateMachine('agt_1');
    let count = 0;
    const unsubscribe = lifecycle.onTransition(() => {
      count += 1;
    });
    unsubscribe();
    lifecycle.transition('ready');
    expect(count).toBe(0);
  });

  it('supports pause and resume during execution', () => {
    const lifecycle = new LifecycleStateMachine('agt_1');
    lifecycle.transition('ready');
    lifecycle.transition('executing');
    lifecycle.transition('waiting');
    lifecycle.transition('executing');
    lifecycle.transition('paused');
    lifecycle.transition('executing');
    lifecycle.transition('ready');
    expect(lifecycle.state).toBe('ready');
  });

  it('supports recovery after failure', () => {
    const lifecycle = new LifecycleStateMachine('agt_1');
    lifecycle.transition('ready');
    lifecycle.transition('executing');
    lifecycle.transition('recovering');
    lifecycle.transition('ready');
    expect(lifecycle.state).toBe('ready');
  });

  it('supports updating and disabling', () => {
    const lifecycle = new LifecycleStateMachine('agt_1');
    lifecycle.transition('ready');
    lifecycle.transition('updating');
    lifecycle.transition('ready');
    lifecycle.transition('disabled');
    lifecycle.transition('ready');
    expect(lifecycle.state).toBe('ready');
  });

  it('rejects unknown target states', () => {
    const lifecycle = new LifecycleStateMachine('agt_1');
    expect(() => lifecycle.transition('executing' as never)).toThrowError();
  });
});
