/**
 * @nexora/app-api — shared RBAC denial response (S34).
 *
 * The one response shape every route uses when `authorizePermission` denies
 * a request — keeps the wording and status code consistent across routes
 * instead of each one composing its own.
 */

/** Sends the standard 403 response for a missing RBAC permission. */
export function sendForbidden(
  reply: { code(status: number): { send(body: unknown): unknown } },
  requestId: string,
  permission: string,
): unknown {
  return reply.code(403).send({
    error: {
      code: 'AUTHORIZATION_ERROR',
      message: `Your current role does not have permission to ${permission}`,
      requestId,
    },
  });
}
