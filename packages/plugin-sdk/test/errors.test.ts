/**
 * Plugin SDK error hierarchy tests.
 */

import { describe, expect, it } from 'vitest';

import { NexoraError } from '@nexora/shared/errors';

import {
  PluginCompatibilityError,
  PluginDependencyError,
  PluginInstallationError,
  PluginLifecycleError,
  PluginSdkError,
  PluginValidationError,
} from '../src/errors/index.js';

describe('PluginSdkError hierarchy', () => {
  it('extends the shared NexoraError hierarchy', () => {
    const error = new PluginSdkError('msg', 'PLUGIN_X');
    expect(error).toBeInstanceOf(NexoraError);
    expect(error.name).toBe('PluginSdkError');
    expect(error.code).toBe('PLUGIN_X');
  });

  it('carries stable codes', () => {
    expect(new PluginValidationError('v', []).code).toBe('PLUGIN_VALIDATION_ERROR');
    expect(new PluginDependencyError({ id: 'x', range: '^1.0.0' }, 'd').code).toBe(
      'PLUGIN_DEPENDENCY_ERROR',
    );
    expect(new PluginCompatibilityError('c').code).toBe('PLUGIN_COMPATIBILITY_ERROR');
    expect(new PluginLifecycleError('l').code).toBe('PLUGIN_LIFECYCLE_ERROR');
    expect(new PluginInstallationError('i').code).toBe('PLUGIN_INSTALLATION_ERROR');
  });

  it('PluginValidationError exposes the issues', () => {
    const error = new PluginValidationError('invalid', ['a: x', 'b: y']);
    expect(error.issues).toEqual(['a: x', 'b: y']);
    expect(error.message).toContain('invalid');
  });

  it('PluginDependencyError exposes the dependency', () => {
    const dependency = { id: 'com.nexora.identity', range: '^2.0.0' };
    const error = new PluginDependencyError(dependency, 'not satisfied');
    expect(error.dependency).toEqual(dependency);
  });

  it('preserves the message and cause', () => {
    const cause = new Error('root');
    const error = new PluginLifecycleError('wrapped', undefined, cause);
    expect(error.message).toBe('wrapped');
    expect(error.cause).toBe(cause);
  });
});
