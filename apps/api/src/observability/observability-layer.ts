/**
 * @nexora/app-api — observability layer composition (Prompt 7): ONE run store
 * and telemetry hub shared by the HTTP app and the stdio MCP entry, so every
 * execution path records runtime telemetry identically.
 *
 * Descriptive only: nothing composed here is read by RBAC, agent authority,
 * policy or approval.
 */

import {
  InMemoryRuntimeRunRepository,
  parsePricing,
  RunTelemetryHub,
  type RuntimeRunRepository,
} from '@nexora/module-observability';

import type { RepositorySet } from '../container.js';

/** The composed observability layer. */
export interface ObservabilityLayer {
  repository: RuntimeRunRepository;
  hub: RunTelemetryHub;
}

/**
 * Builds the observability layer (in-memory store when the repository set has
 * none). Pricing comes only from trusted configuration; without it every cost
 * is `null`.
 */
export function buildObservabilityLayer(input: {
  repositories: RepositorySet;
  pricingJson?: string | undefined;
}): ObservabilityLayer {
  const repository = input.repositories.runtimeRuns ?? new InMemoryRuntimeRunRepository();
  const pricing = parsePricing(input.pricingJson);
  const hub = new RunTelemetryHub({
    ...(pricing === undefined ? {} : { pricing }),
    sink: (run) => repository.append(run),
  });
  return { repository, hub };
}
