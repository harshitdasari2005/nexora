/**
 * @nexora/plugin-sdk — validators.
 *
 * Install-time validation (SAD.md §7.11): manifest integrity, dependency
 * resolution, compatibility, and permission declarations. Includes a small
 * dependency-free semver range satisfier covering the ranges plugins
 * declare (`^`, `~`, comparators, exact, `*`, AND/OR groups).
 */

import type {
  PluginManifest,
  PluginDependency,
  PluginCompatibility,
} from '@nexora/contracts/plugin';

import {
  PluginCompatibilityError,
  PluginDependencyError,
  PluginValidationError,
} from '../errors/index.js';
import type { PluginResolver } from '../registry/index.js';

/** A single validation issue: a field path and a message. */
export interface PluginValidationIssue {
  /** Dot-separated field path, e.g. `manifest.version`. */
  field: string;
  /** Human-readable issue description. */
  message: string;
}

// -- Semver helpers ---------------------------------------------------------------

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Whether a string is a valid semantic version (x.y.z). */
export function isValidSemver(value: string): boolean {
  return SEMVER_PATTERN.test(value);
}

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(value: string): SemverParts {
  const core = value.split(/[-+]/)[0] ?? value;
  const parts = core.split('.').map(Number);
  return { major: parts[0] ?? 0, minor: parts[1] ?? 0, patch: parts[2] ?? 0 };
}

/** Whether a version carries a pre-release tag (e.g. `1.0.0-alpha`). */
function hasPrerelease(value: string): boolean {
  return /^\d+\.\d+\.\d+-/.test(value);
}

/** Compares two semantic versions: -1, 0, or 1. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) {
      return pa[key] < pb[key] ? -1 : 1;
    }
  }
  return 0;
}

function satisfiesComparator(version: string, comparator: string): boolean {
  if (comparator === '*' || comparator === '') {
    return true;
  }
  const match = comparator.match(/^([\^~><=]+)?\s*(.+)$/);
  const op = match?.[1] ?? '=';
  const target = match?.[2] ?? comparator;
  if (!isValidSemver(target)) {
    return false;
  }
  // Per semver, a pre-release version only satisfies a range that mentions a
  // pre-release on the same tuple (npm rule): `1.0.0-alpha` ∉ `^1.0.0`.
  if (hasPrerelease(version) && !hasPrerelease(target)) {
    return false;
  }
  const v = parseSemver(version);
  const t = parseSemver(target);
  if (op === '^') {
    return v.major === t.major && compareSemver(version, target) >= 0;
  }
  if (op === '~') {
    return v.major === t.major && v.minor === t.minor && compareSemver(version, target) >= 0;
  }
  const cmp = compareSemver(version, target);
  switch (op) {
    case '>=':
      return cmp >= 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    case '<':
      return cmp < 0;
    default:
      return cmp === 0;
  }
}

/**
 * Whether a version satisfies a semver range. Supports `*`, exact, `^`, `~`,
 * and `>`, `>=`, `<`, `<=`, `=` comparators, ANDed by commas/spaces and ORed
 * by `||`.
 */
export function satisfiesVersionRange(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*') {
    return true;
  }
  if (!isValidSemver(version)) {
    return false;
  }
  return trimmed.split('||').some((orGroup) =>
    orGroup
      .split(',')
      .flatMap((part) => part.trim().split(/\s+/))
      .filter((part) => part.length > 0)
      .every((comparator) => satisfiesComparator(version, comparator)),
  );
}

// -- Validators --------------------------------------------------------------------

/**
 * The manifest validator: structural integrity of the canonical
 * `PluginManifest` (SAD.md §7.11).
 */
export class ManifestValidator {
  /**
   * Validates a manifest and returns the issues found.
   */
  validate(manifest: PluginManifest): readonly PluginValidationIssue[] {
    const issues: PluginValidationIssue[] = [];

    if (manifest.id.length === 0) {
      issues.push({ field: 'manifest.id', message: 'Plugin id must not be empty' });
    } else if (!manifest.id.includes('.')) {
      issues.push({
        field: 'manifest.id',
        message: 'Plugin id should be reverse-DNS style (e.g. com.nexora.projects)',
      });
    }

    if (manifest.name.length === 0) {
      issues.push({ field: 'manifest.name', message: 'Plugin name must not be empty' });
    }

    if (!isValidSemver(manifest.version)) {
      issues.push({
        field: 'manifest.version',
        message: `Version is not a valid semver: ${manifest.version}`,
      });
    }

    const capabilityIds = manifest.capabilities.map((capability) => capability.id);
    const duplicateCapabilities = capabilityIds.filter(
      (id, index) => capabilityIds.indexOf(id) !== index,
    );
    if (duplicateCapabilities.length > 0) {
      issues.push({
        field: 'manifest.capabilities',
        message: `Duplicate capability ids: ${[...new Set(duplicateCapabilities)].join(', ')}`,
      });
    }
    for (const capability of manifest.capabilities) {
      if (capability.id.length === 0 || capability.skillId.length === 0) {
        issues.push({
          field: `manifest.capabilities.${capability.id}`,
          message: 'Capability id and skillId must not be empty',
        });
      }
    }

    const requiredScopes = manifest.permissions.required;
    const grantedScopes = manifest.permissions.granted;
    if (new Set(requiredScopes).size !== requiredScopes.length) {
      issues.push({
        field: 'manifest.permissions.required',
        message: 'Required scopes contain duplicates',
      });
    }
    if (new Set(grantedScopes).size !== grantedScopes.length) {
      issues.push({
        field: 'manifest.permissions.granted',
        message: 'Granted scopes contain duplicates',
      });
    }

    const emits = manifest.events.emits;
    const subscribes = manifest.events.subscribes;
    if (new Set(emits).size !== emits.length) {
      issues.push({
        field: 'manifest.events.emits',
        message: 'Emitted event types contain duplicates',
      });
    }
    if (new Set(subscribes).size !== subscribes.length) {
      issues.push({
        field: 'manifest.events.subscribes',
        message: 'Subscribed event types contain duplicates',
      });
    }

    const navigation = manifest.navigation ?? [];
    const navigationIds = navigation.map((item) => item.id);
    if (new Set(navigationIds).size !== navigationIds.length) {
      issues.push({
        field: 'manifest.navigation',
        message: 'Navigation registration ids contain duplicates',
      });
    }

    for (const dependency of manifest.dependencies ?? []) {
      if (dependency.id.length === 0 || !isValidSemverRangeSyntax(dependency.range)) {
        issues.push({
          field: `manifest.dependencies.${dependency.id}`,
          message: `Invalid dependency range: ${dependency.range}`,
        });
      }
    }

    if (!isValidSemver(manifest.compatibility.platformApiVersion)) {
      issues.push({
        field: 'manifest.compatibility.platformApiVersion',
        message: 'platformApiVersion must be a valid semver',
      });
    }
    if (!isValidSemver(manifest.compatibility.sdkVersion)) {
      issues.push({
        field: 'manifest.compatibility.sdkVersion',
        message: 'sdkVersion must be a valid semver',
      });
    }

    return issues;
  }

  /**
   * Validates and throws {@link PluginValidationError} when the manifest is
   * invalid.
   */
  assertValid(manifest: PluginManifest): void {
    const issues = this.validate(manifest);
    if (issues.length > 0) {
      throw new PluginValidationError(
        `Plugin manifest is invalid (${issues.length} issue(s))`,
        issues.map((issue) => `${issue.field}: ${issue.message}`),
      );
    }
  }
}

/** Loose syntax check for a version range string. */
function isValidSemverRangeSyntax(range: string): boolean {
  if (range.trim() === '' || range.trim() === '*') {
    return true;
  }
  return range
    .split('||')
    .flatMap((group) => group.split(',').flatMap((part) => part.trim().split(/\s+/)))
    .every((comparator) => {
      const cleaned = comparator.replace(/^[\^~><=]+/, '');
      return cleaned === '' || isValidSemver(cleaned);
    });
}

/**
 * The dependency validator: resolves a manifest's declared dependencies
 * against a {@link PluginResolver} (SAD.md §7.8).
 */
export class DependencyValidator {
  /**
   * Resolves every declared dependency. Throws {@link PluginDependencyError}
   * for the first unresolved or out-of-range dependency; returns the
   * resolved entries on success.
   */
  resolve(
    manifest: PluginManifest,
    resolver: PluginResolver,
  ): readonly { id: string; version: string }[] {
    const resolved: { id: string; version: string }[] = [];
    for (const dependency of manifest.dependencies ?? []) {
      if (dependency.id === manifest.id) {
        throw new PluginDependencyError(
          dependency,
          `Plugin cannot depend on itself: ${dependency.id}`,
        );
      }
      const entry = resolver.resolve(dependency.id);
      if (entry === undefined) {
        throw new PluginDependencyError(
          dependency,
          `Dependency not installed: ${dependency.id}@${dependency.range}`,
        );
      }
      if (!satisfiesVersionRange(entry.descriptor.version, dependency.range)) {
        throw new PluginDependencyError(
          dependency,
          `Dependency ${dependency.id}@${entry.descriptor.version} does not satisfy ${dependency.range}`,
        );
      }
      resolved.push({ id: dependency.id, version: entry.descriptor.version });
    }
    return resolved;
  }
}

/**
 * The compatibility validator: whether a plugin is compatible with the
 * running platform and SDK (SAD.md §7.11). Compatibility requires the same
 * major version and a running version at least as new as the declared
 * minimum.
 */
export class CompatibilityValidator {
  /**
   * Checks compatibility and returns the issues found.
   *
   * @param manifest        - the plugin manifest.
   * @param platformVersion - the running platform version.
   * @param sdkVersion      - the running Plugin SDK version.
   */
  check(
    manifest: PluginManifest,
    platformVersion: string,
    sdkVersion: string,
  ): readonly PluginValidationIssue[] {
    const issues: PluginValidationIssue[] = [];
    const required = manifest.compatibility;

    if (
      !sameMajor(sdkVersion, required.sdkVersion) ||
      compareSemver(sdkVersion, required.sdkVersion) < 0
    ) {
      issues.push({
        field: 'manifest.compatibility.sdkVersion',
        message: `Plugin requires SDK ${required.sdkVersion}; running ${sdkVersion}`,
      });
    }
    if (
      !sameMajor(platformVersion, required.platformApiVersion) ||
      compareSemver(platformVersion, required.platformApiVersion) < 0
    ) {
      issues.push({
        field: 'manifest.compatibility.platformApiVersion',
        message: `Plugin requires platform API ${required.platformApiVersion}; running ${platformVersion}`,
      });
    }
    return issues;
  }

  /**
   * Checks compatibility and throws {@link PluginCompatibilityError} when
   * incompatible.
   */
  assertCompatible(manifest: PluginManifest, platformVersion: string, sdkVersion: string): void {
    const issues = this.check(manifest, platformVersion, sdkVersion);
    if (issues.length > 0) {
      const first = issues[0];
      throw new PluginCompatibilityError(first?.message ?? 'Plugin is incompatible', {
        issues: issues.map((issue) => `${issue.field}: ${issue.message}`),
      });
    }
  }
}

/**
 * The permission validator: sanity of the manifest's permission declaration
 * (install-time permission review, PRD.md §20.2).
 */
export class PermissionValidator {
  /**
   * Validates the permission declaration and returns the issues found.
   */
  validate(manifest: PluginManifest): readonly PluginValidationIssue[] {
    const issues: PluginValidationIssue[] = [];
    const { required, granted } = manifest.permissions;

    if (required.length === 0 && manifest.capabilities.length > 0) {
      issues.push({
        field: 'manifest.permissions.required',
        message: 'Plugin declares capabilities but requires no scopes',
      });
    }
    const overlap = required.filter((scope) => granted.includes(scope));
    if (overlap.length > 0) {
      issues.push({
        field: 'manifest.permissions',
        message: `Scopes both required and granted: ${[...new Set(overlap)].join(', ')}`,
      });
    }
    return issues;
  }
}

/** Whether two versions share the same major version. */
function sameMajor(a: string, b: string): boolean {
  if (!isValidSemver(a) || !isValidSemver(b)) {
    return false;
  }
  return parseSemver(a).major === parseSemver(b).major;
}

/** Convenience alias so callers can type compatibility fields. */
export type { PluginCompatibility, PluginDependency };
