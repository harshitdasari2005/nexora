/**
 * @nexora/plugin-sdk — commands.
 *
 * Command contributions: slash/command-palette commands the plugin exposes
 * (FRONTEND.md §3 command-driven UX). Handlers are plain functions — the
 * platform invokes them with a typed context.
 */

import type { PluginId } from '../types/index.js';

/** Metadata describing a command. */
export interface CommandMetadata {
  /** Stable command id. */
  id: string;
  /** Command name shown in the palette/slash menu. */
  name: string;
  /** Description for discovery. */
  description: string;
  /** Search keywords. */
  keywords: readonly string[];
  /** Optional permission scope required to invoke. */
  requiredScope?: string;
  /** Whether the command may be destructive (side-effect safety). */
  destructive?: boolean;
  /** Owning plugin id. */
  pluginId?: PluginId;
}

/** The context a command handler receives. */
export interface CommandContext {
  /** Tenant scope. */
  tenantId: string;
  /** Workspace scope, when workspace-scoped. */
  workspaceId?: string;
  /** The invoking user id. */
  userId: string;
  /** Raw command arguments (after the command name). */
  args: readonly string[];
  /** Whether the command requires AI planning (AIR.md §6). */
  aiPlanned: boolean;
}

/** A command handler: performs the command and returns a result payload. */
export type CommandHandler = (context: CommandContext) => Promise<unknown> | unknown;

/** A command contribution. */
export interface CommandContribution {
  /** Contribution kind discriminant. */
  kind: 'command';
  /** The command metadata. */
  command: CommandMetadata;
  /** The handler invoked when the command runs. */
  handler: CommandHandler;
  /** Whether the command is available as an AI tool (AIR.md §10). */
  exposeToAi?: boolean;
}
