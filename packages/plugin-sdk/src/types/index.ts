/**
 * @nexora/plugin-sdk — core types.
 *
 * The SDK's own vocabulary: plugin ids, contribution kinds, and the SDK
 * version constant. Everything else builds on the canonical contracts
 * (`@nexora/contracts`) and the Agent SDK (`@nexora/agent-sdk`); this module
 * adds only what is SDK-specific.
 */

/** A plugin id, reverse-DNS style, e.g. `com.nexora.projects`. Plain string. */
export type PluginId = string;

/** The SDK's own semantic version, used by the CompatibilityValidator. */
export const PLUGIN_SDK_VERSION = '0.1.0' as const;

/**
 * The kinds of contribution a plugin can register. Each kind maps to a
 * contribution interface in its feature module (navigation, commands, ...)
 * and is the discriminant of the `PluginContribution` union in
 * `@nexora/plugin-sdk/base` (SAD.md §7.2).
 */
export const CONTRIBUTION_KINDS = [
  'permission',
  'role',
  'policy',
  'approval',
  'navigation',
  'route',
  'page',
  'dashboard',
  'view',
  'widget',
  'command',
  'event',
  'configuration',
  'workflow',
  'knowledge',
  'search',
  'notification',
  'agent',
  'tool',
  'skill',
  'capability',
] as const;

/** Single contribution kind literal. */
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];
