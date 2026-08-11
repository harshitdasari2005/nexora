/**
 * Plugin lifecycle state machine tests.
 */

import { describe, expect, it } from 'vitest';

import { PluginLifecycleError } from '../src/errors/index.js';
import {
  PluginLifecycleStateMachine,
  toCanonicalState,
  PLUGIN_STATES,
} from '../src/lifecycle/index.js';

describe('PluginLifecycleStateMachine', () => {
  it('starts in the discovered state', () => {
    const machine = new PluginLifecycleStateMachine('com.nexora.test');
    expect(machine.state).toBe('discovered');
  });

  it('follows the happy-path install → enable → disable → enable → uninstall', () => {
    const machine = new PluginLifecycleStateMachine('p');
    machine.transition('installed', 'install');
    machine.transition('enabled', 'enable');
    machine.transition('disabled', 'disable');
    machine.transition('enabled', 'enable');
    machine.transition('uninstalled', 'uninstall');
    expect(machine.state).toBe('uninstalled');
  });

  it('supports the upgrade flow through updating', () => {
    const machine = new PluginLifecycleStateMachine('p');
    machine.transition('installed');
    machine.transition('enabled');
    machine.transition('updating', 'upgrade');
    machine.transition('enabled', 'upgrade-complete');
    expect(machine.state).toBe('enabled');
  });

  it('moves any active state to failed on error', () => {
    const machine = new PluginLifecycleStateMachine('p');
    machine.transition('installed');
    machine.transition('enabled');
    machine.transition('failed', 'boom');
    expect(machine.state).toBe('failed');
  });

  it('recovers from failed via rollback', () => {
    const machine = new PluginLifecycleStateMachine('p');
    machine.transition('installed');
    machine.transition('failed', 'boom');
    machine.transition('installed', 'rollback');
    expect(machine.state).toBe('installed');
  });

  it('rejects invalid transitions with PluginLifecycleError', () => {
    const machine = new PluginLifecycleStateMachine('p');
    expect(() => machine.transition('enabled')).toThrow(PluginLifecycleError);
  });

  it('rejects enabling from the discovered state', () => {
    const machine = new PluginLifecycleStateMachine('p');
    expect(() => machine.transition('enabled')).toThrow(/Invalid plugin lifecycle transition/);
  });

  it('is idempotent for same-state transitions', () => {
    const machine = new PluginLifecycleStateMachine('p');
    machine.transition('installed');
    machine.transition('installed');
    expect(machine.state).toBe('installed');
    expect(machine.history()).toHaveLength(2);
  });

  it('exposes canTransition', () => {
    const machine = new PluginLifecycleStateMachine('p');
    expect(machine.canTransition('installed')).toBe(true);
    expect(machine.canTransition('enabled')).toBe(false);
  });

  it('records history with from/to/reason', () => {
    const machine = new PluginLifecycleStateMachine('p');
    machine.transition('installed', 'install');
    const history = machine.history();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: 'discovered', to: 'installed', reason: 'install' });
    expect(history[0]?.occurredAt).toBeDefined();
  });

  it('notifies listeners on transition', () => {
    const machine = new PluginLifecycleStateMachine('p');
    const seen: string[] = [];
    machine.onTransition((transition) => seen.push(`${transition.from}→${transition.to}`));
    machine.transition('installed');
    machine.transition('enabled');
    expect(seen).toEqual(['discovered→installed', 'installed→enabled']);
  });

  it('returns an unsubscribe function from onTransition', () => {
    const machine = new PluginLifecycleStateMachine('p');
    let calls = 0;
    const unsubscribe = machine.onTransition(() => {
      calls += 1;
    });
    machine.transition('installed');
    unsubscribe();
    machine.transition('disabled');
    expect(calls).toBe(1);
  });

  it('rejects transitions after uninstalled', () => {
    const machine = new PluginLifecycleStateMachine('p');
    machine.transition('installed');
    machine.transition('uninstalled');
    expect(machine.canTransition('enabled')).toBe(false);
    expect(() => machine.transition('enabled')).toThrow(PluginLifecycleError);
  });

  it('reports the canonical state projection', () => {
    const machine = new PluginLifecycleStateMachine('p');
    machine.transition('installed');
    expect(machine.canonicalState).toBe('installed');
    machine.transition('enabled');
    expect(machine.canonicalState).toBe('active');
  });
});

describe('toCanonicalState', () => {
  it('maps every SDK state to a canonical state', () => {
    for (const state of PLUGIN_STATES) {
      expect([
        'registered',
        'validated',
        'installed',
        'active',
        'disabled',
        'uninstalled',
      ]).toContain(toCanonicalState(state));
    }
  });

  it('projects discovered to validated and updating to installed', () => {
    expect(toCanonicalState('discovered')).toBe('validated');
    expect(toCanonicalState('updating')).toBe('installed');
    expect(toCanonicalState('failed')).toBe('disabled');
    expect(toCanonicalState('enabled')).toBe('active');
    expect(toCanonicalState('uninstalled')).toBe('uninstalled');
  });
});
