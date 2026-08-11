/**
 * @nexora/shared — structured logger.
 *
 * Emits single-line JSON log records with structured context
 * (service, tenant, workspace, correlation/request IDs) so operational logs
 * are machine-parseable and tenant-tagged (BKD.md §15, SAD.md §16).
 *
 * The writer is injectable (defaults to `process.stdout` / `process.stderr`)
 * which keeps the logger testable and transport-agnostic.
 */

import { DEFAULT_LOG_LEVEL, LOG_LEVELS, type LogLevel } from '../constants/index.js';

/** A destination the logger writes to. */
export type LogWriter = (line: string) => void;

/**
 * Structured context attached to every log record. `service` is required on
 * the base context; derived contexts (via {@link Logger.with}) may be partial.
 */
export interface LogContext {
  /** Platform service or package name, e.g. `projects`. */
  service: string;
  /** Tenant (company) id, when known. */
  tenantId?: string;
  /** Workspace id, when known. */
  workspaceId?: string;
  /** Correlation id tying a request/execution across services. */
  correlationId?: string;
  /** Request id for the immediate request, when applicable. */
  requestId?: string;
  /** Optional free-form key/value fields. */
  [key: string]: string | number | boolean | undefined;
}

/** A partial context used to derive a child logger. */
export type LogContextPartial = Partial<LogContext>;

/** A single structured log record as written (serialized to JSON). */
export interface LogRecord {
  /** Severity level of the record. */
  level: LogLevel;
  /** ISO-8601 UTC timestamp of when the record was created. */
  timestamp: string;
  /** Human-readable message. */
  message: string;
  /** Service/context fields (tenant, workspace, correlation, ...). */
  context: LogContext;
  /** Serialized error details, when present. */
  error?: {
    name: string;
    message: string;
    code?: string;
    stack?: string;
    details?: unknown;
  };
}

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Serializes an unknown error into a JSON-safe record. */
function serializeError(error: unknown): LogRecord['error'] {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code:
        'code' in error && typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : undefined,
      details: 'details' in error ? (error as { details?: unknown }).details : undefined,
    };
  }
  return { name: 'UnknownError', message: String(error) };
}

/**
 * A structured logger bound to a context. Instances are cheap; create one per
 * service or per bounded context and use {@link Logger.with} to derive scoped
 * children (e.g. per-request).
 */
export class Logger {
  readonly #context: LogContext;
  readonly #writer: LogWriter;
  readonly #minLevel: LogLevel;

  /**
   * Creates a logger. Prefer {@link createLogger} unless a custom writer is
   * required (e.g. in tests).
   *
   * @param context  - base context; `service` is required.
   * @param writer   - destination; defaults to stdout/stderr split by level.
   * @param minLevel - lowest level emitted; defaults to `info`.
   */
  constructor(context: LogContext, writer?: LogWriter, minLevel: LogLevel = DEFAULT_LOG_LEVEL) {
    this.#context = { ...context };
    this.#writer = writer ?? ((line: string): void => void process.stdout.write(`${line}\n`));
    this.#minLevel = minLevel;
  }

  /**
   * Returns a new logger with additional context merged in. Child context
   * overrides the parent on key collisions; `service` is inherited from the
   * parent when not overridden.
   */
  with(extra: LogContextPartial): Logger {
    return new Logger({ ...this.#context, ...extra }, this.#writer, this.#minLevel);
  }

  /** Logs a record if the level is at or above the minimum level. */
  #log(
    level: LogLevel,
    message: string,
    error?: unknown,
    fields?: Partial<Record<string, string | number | boolean>>,
  ): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.#minLevel]) {
      return;
    }
    const record: LogRecord = {
      level,
      timestamp: new Date().toISOString(),
      message,
      context: { ...this.#context, ...(fields ?? {}) },
    };
    if (error !== undefined) {
      record.error = serializeError(error);
    }
    this.#writer(JSON.stringify(record));
  }

  /** Emits a `debug` record (suppressed when the minimum level is higher). */
  debug(message: string, fields?: Partial<Record<string, string | number | boolean>>): void {
    this.#log('debug', message, undefined, fields);
  }

  /** Emits an `info` record. */
  info(message: string, fields?: Partial<Record<string, string | number | boolean>>): void {
    this.#log('info', message, undefined, fields);
  }

  /** Emits a `warn` record, optionally with an error. */
  warn(
    message: string,
    error?: unknown,
    fields?: Partial<Record<string, string | number | boolean>>,
  ): void {
    this.#log('warn', message, error, fields);
  }

  /** Emits an `error` record, always with error details. */
  error(
    message: string,
    error?: unknown,
    fields?: Partial<Record<string, string | number | boolean>>,
  ): void {
    this.#log('error', message, error, fields);
  }
}

/** Guards whether a value is a valid log level literal. */
export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * Creates a structured logger for the given service context.
 *
 * @example
 * ```ts
 * const log = createLogger({ service: 'projects', tenantId });
 * log.info('project.created', { projectId });
 * ```
 */
export function createLogger(context: LogContext, writer?: LogWriter, minLevel?: LogLevel): Logger {
  return new Logger(context, writer, minLevel);
}
