/**
 * @nexora/app-api — health route.
 */

import type { FastifyInstance } from 'fastify';

/** Registers the public health check. */
export function registerHealth(app: FastifyInstance): void {
  app.get('/api/health', { config: { public: true } }, async () => ({
    status: 'ok',
    service: 'nexora-api',
    time: new Date().toISOString(),
  }));
}
