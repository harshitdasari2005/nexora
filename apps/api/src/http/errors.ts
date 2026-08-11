/**
 * @nexora/app-api — HTTP error mapping.
 *
 * Maps the canonical `NexoraError` taxonomy (API_CONTRACTS.md §10) to HTTP
 * status codes and error bodies. Every route uses this mapper so clients see
 * one stable error shape.
 */

import { isNexoraError, type NexoraError } from '@nexora/shared/errors';

/** The stable API error body. */
export interface ApiErrorBody {
  error: {
    /** Canonical error code (API_CONTRACTS.md §10). */
    code: string;
    /** Human-readable message. */
    message: string;
    /** The originating request id. */
    requestId?: string;
    /** Structured details (field issues, entity ids). */
    details?: unknown;
  };
}

/** HTTP status by canonical error code. */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  VALIDATION_ERROR: 400,
  AUTHORIZATION_ERROR: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BUSINESS_RULE_VIOLATION: 422,
  POLICY_VIOLATION: 403,
  RATE_LIMITED: 429,
  TIMEOUT: 504,
  UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Default status for unknown codes. */
const DEFAULT_STATUS = 500;

/** Maps an unknown error to `{ statusCode, body }`. */
export function toHttpError(
  error: unknown,
  requestId?: string,
): {
  statusCode: number;
  body: ApiErrorBody;
} {
  const nexora: NexoraError | undefined = isNexoraError(error) ? error : undefined;
  const code = nexora?.code ?? 'INTERNAL_ERROR';
  const statusCode = STATUS_BY_CODE[code] ?? DEFAULT_STATUS;
  return {
    statusCode,
    body: {
      error: {
        code,
        message: nexora?.message ?? 'Internal error',
        requestId,
        details: nexora?.details,
      },
    },
  };
}
