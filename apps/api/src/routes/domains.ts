/**
 * @nexora/app-api — domains route.
 *
 * `GET /api/domains` — the minimal read-only Domain → Role → Capability
 * discovery surface (S24 Phase 1). Returns the registered business domains
 * (with their roles) and the global capability vocabulary for the
 * authenticated caller.
 *
 * Security contract (S24): the catalog is DEFINITIONS ONLY — platform-global
 * static vocabulary, no tenant/workspace/user context, no permissions, no
 * scopes. It grants nothing and exposes no internal security details; the
 * existing authorization system remains authoritative. The endpoint requires
 * authentication (401 when absent) but takes no scope parameters — there is
 * nothing tenant-specific to forge.
 */

import type { FastifyInstance } from 'fastify';
import type { GetDomainCatalogHandler } from '@nexora/module-domains';

import { requireAuth } from '../plugins/auth.js';

/** Dependencies of the domains route. */
export interface DomainRoutesDependencies {
  /** The read-only domain catalog handler. */
  listDomainCatalog: GetDomainCatalogHandler;
}

/** Registers the domains route. */
export function registerDomainRoutes(
  app: FastifyInstance,
  dependencies: DomainRoutesDependencies,
): void {
  app.get('/api/domains', async (request, _reply) => {
    requireAuth(request);
    return dependencies.listDomainCatalog.handle();
  });
}
