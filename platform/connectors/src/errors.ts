/**
 * @nexora/connectors — connector error model.
 *
 * External-provider failures map to stable Nexora error codes (S25 Phase 7):
 * the connector layer translates raw provider responses (HTTP status,
 * provider error bodies) into this vocabulary. Internal stack traces,
 * database errors, and provider internals are never surfaced.
 */

/** The stable Nexora error vocabulary for connector operations. */
export const CONNECTOR_ERROR_CODES = {
  /** No connector is available for the trusted tenant/workspace scope. */
  CONNECTOR_UNAVAILABLE: 'CONNECTOR_UNAVAILABLE',
  /** The caller's capability affinity does not include the operation. */
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  /** The tool arguments failed strict schema validation. */
  INVALID_INPUT: 'INVALID_INPUT',
  /** The provider rejected the configured credentials (401). */
  PROVIDER_AUTH_FAILED: 'PROVIDER_AUTH_FAILED',
  /** The provider denied the operation (403 — permission or scope). */
  PROVIDER_PERMISSION_DENIED: 'PROVIDER_PERMISSION_DENIED',
  /** The provider returned not found (404). */
  PROVIDER_NOT_FOUND: 'PROVIDER_NOT_FOUND',
  /** The provider rate-limited the request (429). */
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  /** The provider is unavailable (network, 5xx). */
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  /** The write executed but verification against the provider failed. */
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
} as const;

/** A connector error code (see {@link CONNECTOR_ERROR_CODES}). */
export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[keyof typeof CONNECTOR_ERROR_CODES];

/** A structured connector error. */
export interface ConnectorError {
  /** The stable error code. */
  code: ConnectorErrorCode;
  /** A safe, human-readable message (no internals, no stack traces). */
  message: string;
}

/** Builds a failed connector result with a stable code + safe message. */
export function connectorFailure(
  code: ConnectorErrorCode,
  message: string,
): { ok: false; error: ConnectorError } {
  return { ok: false, error: { code, message } };
}

/**
 * Maps a raw provider HTTP response to a stable Nexora error code. Provider
 * status semantics: 401 auth, 403 permission, 404 not-found, 429
 * rate-limit, everything ≥500 (and transport failures) unavailable.
 */
export function providerStatusToErrorCode(status: number): ConnectorErrorCode {
  if (status === 401) {
    return CONNECTOR_ERROR_CODES.PROVIDER_AUTH_FAILED;
  }
  if (status === 403) {
    return CONNECTOR_ERROR_CODES.PROVIDER_PERMISSION_DENIED;
  }
  if (status === 404) {
    return CONNECTOR_ERROR_CODES.PROVIDER_NOT_FOUND;
  }
  if (status === 429) {
    return CONNECTOR_ERROR_CODES.PROVIDER_RATE_LIMITED;
  }
  if (status >= 500) {
    return CONNECTOR_ERROR_CODES.PROVIDER_UNAVAILABLE;
  }
  return CONNECTOR_ERROR_CODES.PROVIDER_UNAVAILABLE;
}
