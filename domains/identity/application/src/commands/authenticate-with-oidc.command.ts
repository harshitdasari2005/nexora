/**
 * @nexora/application-identity — AuthenticateWithOidc command.
 *
 * Authenticates a principal whose identity was already verified by an
 * external OIDC identity provider (Keycloak). The platform never receives
 * the password: it provisions or reuses the local user and issues a session
 * for the verified principal (PSD.md §10 sessions; SAD.md §13.1).
 */

import type { UserId } from '@nexora/contracts/common';

/** Authenticates a principal verified by an OIDC identity provider. */
export interface AuthenticateWithOidcCommand {
  /** The stable OIDC subject (IdP-side user id). */
  oidcSubject: string;
  /** The verified email address (the platform login key). */
  email: string;
  /** Whether the IdP verified the email. */
  emailVerified: boolean;
  /** The display name from the IdP profile, when provided. */
  displayName?: string;
  /** The OIDC issuer that verified the identity (audit trail). */
  issuer: string;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful OIDC authentication. */
export interface AuthenticateResult {
  /** The platform user id (newly provisioned or existing). */
  userId: UserId;
  /** The opaque session token stored in the client session cookie. */
  sessionToken: string;
  /** Whether the user was provisioned during this authentication. */
  isNewUser: boolean;
}
