/**
 * @nexora/application-identity — EndSession command.
 *
 * Ends a session (logout). The caller (HTTP adapter) resolves the session id
 * from the presented token before issuing the command.
 */

import type { TenantId } from '@nexora/contracts/common';

/** Ends a user session (logout). */
export interface EndSessionCommand {
  /** The session id to end. */
  sessionId: string;
  /** The user that initiated the logout (actor). */
  actorId: string;
  /** The tenant the session belongs to. */
  tenantId: TenantId;
  /** Correlation id of the originating execution. */
  correlationId: string;
}
