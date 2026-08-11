/**
 * Manifest, dependency, compatibility, and permission validator tests,
 * plus the semver range satisfier.
 */

import { describe, expect, it } from 'vitest';

import {
  PluginCompatibilityError,
  PluginDependencyError,
  PluginValidationError,
} from '../src/errors/index.js';
import { PluginRegistry } from '../src/registry/index.js';
import { testPluginManifest } from '../src/testing/index.js';
import {
  compareSemver,
  isValidSemver,
  satisfiesVersionRange,
  ManifestValidator,
  DependencyValidator,
  CompatibilityValidator,
  PermissionValidator,
} from '../src/validators/index.js';

describe('isValidSemver', () => {
  it('accepts valid semver', () => {
    expect(isValidSemver('1.2.3')).toBe(true);
    expect(isValidSemver('0.0.1')).toBe(true);
    expect(isValidSemver('1.2.3-alpha.1')).toBe(true);
    expect(isValidSemver('1.2.3+build.5')).toBe(true);
  });

  it('rejects invalid semver', () => {
    expect(isValidSemver('1.2')).toBe(false);
    expect(isValidSemver('1')).toBe(false);
    expect(isValidSemver('abc')).toBe(false);
    expect(isValidSemver('1.2.3.4')).toBe(false);
    expect(isValidSemver('')).toBe(false);
  });
});

describe('compareSemver', () => {
  it('orders versions', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.2.0', '1.1.9')).toBe(1);
    expect(compareSemver('0.9.9', '1.0.0')).toBe(-1);
    expect(compareSemver('2.0.0', '1.99.99')).toBe(1);
  });
});

describe('satisfiesVersionRange', () => {
  it('accepts wildcards and empty ranges', () => {
    expect(satisfiesVersionRange('1.2.3', '*')).toBe(true);
    expect(satisfiesVersionRange('1.2.3', '')).toBe(true);
  });

  it('accepts exact matches', () => {
    expect(satisfiesVersionRange('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesVersionRange('1.2.4', '1.2.3')).toBe(false);
  });

  it('handles caret ranges', () => {
    expect(satisfiesVersionRange('1.5.0', '^1.2.3')).toBe(true);
    expect(satisfiesVersionRange('2.0.0', '^1.2.3')).toBe(false);
    expect(satisfiesVersionRange('1.1.0', '^1.2.3')).toBe(false);
  });

  it('handles tilde ranges', () => {
    expect(satisfiesVersionRange('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfiesVersionRange('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfiesVersionRange('1.2.2', '~1.2.3')).toBe(false);
  });

  it('handles comparison operators', () => {
    expect(satisfiesVersionRange('2.0.0', '>=1.0.0')).toBe(true);
    expect(satisfiesVersionRange('0.5.0', '>=1.0.0')).toBe(false);
    expect(satisfiesVersionRange('1.0.0', '>0.9.0')).toBe(true);
    expect(satisfiesVersionRange('1.0.0', '<2.0.0')).toBe(true);
    expect(satisfiesVersionRange('3.0.0', '<2.0.0')).toBe(false);
    expect(satisfiesVersionRange('1.0.0', '<=1.0.0')).toBe(true);
  });

  it('handles AND groups', () => {
    expect(satisfiesVersionRange('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfiesVersionRange('2.5.0', '>=1.0.0 <2.0.0')).toBe(false);
  });

  it('handles OR groups', () => {
    expect(satisfiesVersionRange('2.0.0', '^1.0.0 || ^2.0.0')).toBe(true);
    expect(satisfiesVersionRange('3.0.0', '^1.0.0 || ^2.0.0')).toBe(false);
  });

  it('rejects pre-release versions against stable ranges', () => {
    expect(satisfiesVersionRange('1.0.0-alpha', '^1.0.0')).toBe(false);
    expect(satisfiesVersionRange('1.0.0-alpha', '>=1.0.0')).toBe(false);
    expect(satisfiesVersionRange('1.0.0-alpha', '1.0.0')).toBe(false);
  });

  it('accepts pre-release versions against pre-release ranges', () => {
    expect(satisfiesVersionRange('1.0.0-beta', '>=1.0.0-alpha')).toBe(true);
  });
});

describe('ManifestValidator', () => {
  const validator = new ManifestValidator();

  it('accepts a valid manifest', () => {
    expect(validator.validate(testPluginManifest())).toHaveLength(0);
  });

  it('rejects an empty id and a non-reverse-DNS id', () => {
    expect(validator.validate(testPluginManifest({ id: '' }))).not.toHaveLength(0);
    expect(validator.validate(testPluginManifest({ id: 'projects' }))).not.toHaveLength(0);
  });

  it('rejects an invalid version', () => {
    expect(validator.validate(testPluginManifest({ version: 'nope' }))).not.toHaveLength(0);
  });

  it('rejects duplicate capability ids', () => {
    const manifest = testPluginManifest({
      capabilities: [
        { id: 'a.x', description: 'd', skillId: 's.a' },
        { id: 'a.x', description: 'd2', skillId: 's.b' },
      ],
    });
    const issues = validator.validate(manifest);
    expect(issues.some((issue) => issue.field === 'manifest.capabilities')).toBe(true);
  });

  it('rejects duplicate granted scopes', () => {
    const manifest = testPluginManifest({
      permissions: { required: ['a:read'], granted: ['b:write', 'b:write'] },
    });
    expect(validator.validate(manifest)).not.toHaveLength(0);
  });

  it('rejects duplicate navigation ids', () => {
    const manifest = testPluginManifest({
      navigation: [
        { id: 'nav', label: 'A' },
        { id: 'nav', label: 'B' },
      ],
    });
    const issues = validator.validate(manifest);
    expect(issues.some((issue) => issue.field === 'manifest.navigation')).toBe(true);
  });

  it('rejects an invalid dependency range', () => {
    const manifest = testPluginManifest({
      dependencies: [{ id: 'com.nexora.identity', range: 'banana' }],
    });
    expect(validator.validate(manifest)).not.toHaveLength(0);
  });

  it('assertValid throws PluginValidationError with issues', () => {
    expect(() => validator.assertValid(testPluginManifest({ id: '' }))).toThrow(
      PluginValidationError,
    );
  });
});

describe('DependencyValidator', () => {
  const validator = new DependencyValidator();

  function registryWith(versions: Record<string, string>): PluginRegistry {
    const registry = new PluginRegistry();
    for (const [id, version] of Object.entries(versions)) {
      registry.register({
        plugin: undefined as never,
        descriptor: { id, name: id, version, state: 'active' },
        state: 'enabled',
        registeredAt: 't',
      });
    }
    return registry;
  }

  it('resolves satisfied dependencies', () => {
    const registry = registryWith({ 'com.nexora.identity': '1.2.0' });
    const manifest = testPluginManifest({
      dependencies: [{ id: 'com.nexora.identity', range: '^1.0.0' }],
    });
    const resolved = validator.resolve(manifest, registry);
    expect(resolved).toEqual([{ id: 'com.nexora.identity', version: '1.2.0' }]);
  });

  it('throws PluginDependencyError for a missing dependency', () => {
    const manifest = testPluginManifest({
      dependencies: [{ id: 'com.nexora.missing', range: '^1.0.0' }],
    });
    expect(() => validator.resolve(manifest, registryWith({}))).toThrow(PluginDependencyError);
  });

  it('throws PluginDependencyError for an out-of-range dependency', () => {
    const registry = registryWith({ 'com.nexora.identity': '2.5.0' });
    const manifest = testPluginManifest({
      dependencies: [{ id: 'com.nexora.identity', range: '^1.0.0' }],
    });
    expect(() => validator.resolve(manifest, registry)).toThrow(PluginDependencyError);
  });

  it('rejects self-dependencies', () => {
    const registry = registryWith({});
    const manifest = testPluginManifest({
      id: 'com.nexora.test',
      dependencies: [{ id: 'com.nexora.test', range: '^1.0.0' }],
    });
    expect(() => validator.resolve(manifest, registry)).toThrow(/cannot depend on itself/);
  });

  it('returns an empty list when no dependencies are declared', () => {
    expect(validator.resolve(testPluginManifest(), registryWith({}))).toEqual([]);
  });
});

describe('CompatibilityValidator', () => {
  const validator = new CompatibilityValidator();

  it('accepts compatible manifests', () => {
    const issues = validator.check(testPluginManifest(), '0.1.0', '0.1.0');
    expect(issues).toHaveLength(0);
  });

  it('rejects an older platform version', () => {
    const issues = validator.check(testPluginManifest(), '0.0.9', '0.1.0');
    expect(
      issues.some((issue) => issue.field === 'manifest.compatibility.platformApiVersion'),
    ).toBe(true);
  });

  it('rejects an older SDK version', () => {
    const issues = validator.check(testPluginManifest(), '0.1.0', '0.0.9');
    expect(issues.some((issue) => issue.field === 'manifest.compatibility.sdkVersion')).toBe(true);
  });

  it('rejects a different major platform version', () => {
    const issues = validator.check(testPluginManifest(), '1.0.0', '0.1.0');
    expect(issues).not.toHaveLength(0);
  });

  it('assertCompatible throws PluginCompatibilityError', () => {
    expect(() => validator.assertCompatible(testPluginManifest(), '0.0.9', '0.1.0')).toThrow(
      PluginCompatibilityError,
    );
  });
});

describe('PermissionValidator', () => {
  const validator = new PermissionValidator();

  it('accepts a valid permission declaration', () => {
    const manifest = testPluginManifest({
      capabilities: [{ id: 'a.b', description: 'd', skillId: 's' }],
      permissions: { required: ['a:read'], granted: ['a:write'] },
    });
    expect(validator.validate(manifest)).toHaveLength(0);
  });

  it('flags capabilities without required scopes', () => {
    const manifest = testPluginManifest({
      capabilities: [{ id: 'a.b', description: 'd', skillId: 's' }],
    });
    const issues = validator.validate(manifest);
    expect(issues.some((issue) => issue.field === 'manifest.permissions.required')).toBe(true);
  });

  it('flags scopes both required and granted', () => {
    const manifest = testPluginManifest({
      permissions: { required: ['a:read'], granted: ['a:read'] },
    });
    expect(validator.validate(manifest)).not.toHaveLength(0);
  });
});
