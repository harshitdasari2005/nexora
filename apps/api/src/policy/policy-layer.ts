/**
 * @nexora/app-api — the policy layer composition (Prompt 5).
 *
 * ONE composition of the policy stack shared by the HTTP app and the stdio
 * MCP entry, exactly like the agent identity layer: the same settings store
 * and the same {@link ApiPolicyPort} feed every `ToolExecutor`, so REST-
 * adjacent chat, agent, MCP and workflow executions decide policy through
 * one implementation — never a second one per surface.
 */

import type { PolicyEngine } from '@nexora/module-policy';
import type { RepositorySet } from '../container.js';
import { ApiPolicyPort } from './api-policy-port.js';
import {
  InMemoryPolicySettingsRepository,
  type PolicySettingsRepository,
} from './policy-settings.js';

/** The composed policy layer. */
export interface PolicyLayer {
  settings: PolicySettingsRepository;
  port: ApiPolicyPort;
}

/** Builds the policy layer (in-memory settings when the repository set has none). */
export function buildPolicyLayer(input: {
  repositories: RepositorySet;
  now?: () => Date;
  /** Overrides the engine (tests add rules; production uses the default rule set). */
  engine?: PolicyEngine;
}): PolicyLayer {
  const settings = input.repositories.policySettings ?? new InMemoryPolicySettingsRepository();
  const port = new ApiPolicyPort({
    settings,
    repositories: input.repositories,
    ...(input.engine === undefined ? {} : { engine: input.engine }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  return { settings, port };
}
