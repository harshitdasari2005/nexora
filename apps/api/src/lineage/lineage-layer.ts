/**
 * @nexora/app-api — lineage layer composition (Prompt 6): ONE lineage store
 * and port shared by the HTTP app and the stdio MCP entry, so every execution
 * path (chat, agent, MCP, workflow, remediation) records lineage identically.
 */

import { InMemoryLineageRepository, type LineageRepository } from '@nexora/module-lineage';

import type { RepositorySet } from '../container.js';
import { ApiLineagePort } from './api-lineage-port.js';

/** The composed lineage layer. */
export interface LineageLayer {
  repository: LineageRepository;
  port: ApiLineagePort;
}

/** Builds the lineage layer (in-memory when the repository set has none). */
export function buildLineageLayer(input: { repositories: RepositorySet }): LineageLayer {
  const repository = input.repositories.lineage ?? new InMemoryLineageRepository();
  return { repository, port: new ApiLineagePort(repository) };
}
