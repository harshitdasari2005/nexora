/**
 * @nexora/module-detection — detection errors (S27).
 *
 * Registration-time errors: invalid signal definitions and duplicate ids fail
 * fast at startup, never mid-request. Runtime failures in data sources fail
 * safe (a failing source resolves to no evidence), never throwing into the
 * detection surface.
 */

/** Base detection error. */
export class DetectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DetectionError';
  }
}

/** A duplicate signal id was registered. */
export class DuplicateSignalError extends DetectionError {
  constructor(id: string) {
    super(`Signal already registered: ${id}`);
    this.name = 'DuplicateSignalError';
  }
}

/** The signal definition failed validation. */
export class InvalidSignalError extends DetectionError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSignalError';
  }
}

/** Maps an error to a stable detection error code (for API surfaces). */
export function toDetectionError(error: unknown): DetectionError {
  if (error instanceof DetectionError) {
    return error;
  }
  return new DetectionError(error instanceof Error ? error.message : 'Detection error');
}
