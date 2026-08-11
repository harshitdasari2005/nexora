/**
 * @nexora/shared — constants.
 *
 * Shared literal types and constant values used across the platform
 * (ENGINEERING_PLAYBOOK.md §4). Consumers should prefer these literals over
 * ad-hoc strings so that log levels, error codes, and side-effect classes
 * stay consistent everywhere.
 */

/**
 * Log severity levels, ordered from least to most severe.
 * Maps to the structured-logging requirements in BKD.md §15 / SAD.md §16.
 */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** Single log level literal. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Minimum log level that is emitted; anything quieter is suppressed. */
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/**
 * Platform error codes, aligned with the API error taxonomy in
 * API_CONTRACTS.md §10. Every error thrown or returned by platform code uses
 * one of these codes (or a domain-specific extension of them).
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'AUTHORIZATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'BUSINESS_RULE_VIOLATION',
  'POLICY_VIOLATION',
  'RATE_LIMITED',
  'TIMEOUT',
  'UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

/** Single error-code literal. */
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Side-effect classes for AI tool calls, aligned with PRODUCT_SPEC.md §9.3
 * (side-effect safety taxonomy). These drive the autonomy-tier / approval
 * decision (AIR.md §12, PSD.md §9.12).
 */
export const SIDE_EFFECT_CLASSES = ['read_only', 'state_change', 'consequential'] as const;

/** Single side-effect class literal. */
export type SideEffectClass = (typeof SIDE_EFFECT_CLASSES)[number];

/**
 * Approximate ordering weight for side-effect classes, used when comparing
 * severity. `consequential` is the highest severity and always requires
 * human approval.
 */
export const SIDE_EFFECT_WEIGHT: Readonly<Record<SideEffectClass, number>> = {
  read_only: 0,
  state_change: 1,
  consequential: 2,
} as const;

/** Maximum length of a free-text value stored by the platform, by convention. */
export const MAX_TEXT_LENGTH = 10_000;

/** Maximum length of a short label/name field, by convention. */
export const MAX_NAME_LENGTH = 120;

/** Maximum page size accepted by any list/query API (API_CONTRACTS.md §11). */
export const MAX_PAGE_SIZE = 100;

/** Default page size used when a request does not specify one. */
export const DEFAULT_PAGE_SIZE = 20;
