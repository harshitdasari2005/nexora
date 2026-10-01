/**
 * Telemetry redaction (Prompt 7). Observability records ids, codes, counts,
 * durations and fingerprints — never prompts, arguments, documents, secrets or
 * reasoning — so the primary control is STRUCTURAL: the run builder only
 * accepts those shapes. This module is the second line: {@link safeCode}
 * bounds the free-form strings that do enter a record (error codes), and
 * {@link findSecrets} is the detector tests and the writer use to prove a
 * record carries nothing that looks like a credential.
 */

/** Patterns that identify credential-looking material. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bsk-[A-Za-z0-9_-]{8,}/,
  /\bgsk_[A-Za-z0-9]{8,}/,
  /\bAKIA[0-9A-Z]{12,}/,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:authorization|cookie|set-cookie|x-api-key)\s*[:=]/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd)\b\s*["']?\s*[:=]/i,
  /\bnexora_session=/i,
];

/** Keys whose VALUES must never be recorded, whatever they contain. */
const FORBIDDEN_KEY =
  /^(?:authorization|cookie|password|passwd|secret|token|apikey|api_key|prompt|messages|content|input|arguments|args|body|reasoning|thinking)$/i;

/**
 * Bounds a code-like string to identifier characters and a maximum length.
 * Anything else (a message, a URL with a query, a stack) is replaced by
 * `REDACTED`, so a free-form error can never leak through a code field.
 */
export function safeCode(value: string | undefined, maxLength = 80): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return /^[A-Za-z0-9_.:@/-]+$/.test(value) && value.length <= maxLength ? value : 'REDACTED';
}

/** Returns the names of the secret patterns found anywhere in a JSON-serializable value. */
export function findSecrets(value: unknown): readonly string[] {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  return SECRET_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

/** Returns the paths of forbidden KEYS (prompt, arguments, authorization, …) present in a value. */
export function findForbiddenKeys(value: unknown, path = '$'): readonly string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => found.push(...findForbiddenKeys(item, `${path}[${index}]`)));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY.test(key)) {
        found.push(`${path}.${key}`);
      }
      found.push(...findForbiddenKeys(child, `${path}.${key}`));
    }
  }
  return found;
}
