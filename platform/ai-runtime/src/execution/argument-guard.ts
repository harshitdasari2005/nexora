/**
 * @nexora/ai-runtime — tool argument guard.
 *
 * Tool arguments are UNTRUSTED (TRUST_MODEL.md): they are produced by
 * deterministic extraction from user text, by a model, or by an external MCP
 * client. Before any tool runs, the {@link ToolExecutor} passes them through
 * this guard, which enforces two deterministic rules:
 *
 * 1. **No trusted-scope fields.** Identity, tenant, workspace, role,
 *    capability, and approval state come ONLY from the authenticated
 *    execution context. An argument that tries to supply one — at any depth,
 *    under any common spelling — is rejected, never silently ignored, so a
 *    forged scope is visible (and audited) instead of merely harmless.
 * 2. **Schema conformance.** Arguments must satisfy the tool's declared JSON
 *    schema (`required`, types, bounds, `additionalProperties: false`). The
 *    guard is the one central check; tools still validate and authorize
 *    their own business values (defense in depth), and resource ownership
 *    (e.g. a model-supplied `budgetId`) is always re-checked against the
 *    trusted tenant/workspace by the owning application service.
 */

import { Ajv, type ValidateFunction } from 'ajv';

/**
 * Argument keys that name trusted scope or authority. Compared
 * case-insensitively with `_`/`-` removed, so `organization_id`,
 * `OrganizationID`, and `organization-id` are all caught.
 */
export const RESERVED_ARGUMENT_KEYS: readonly string[] = [
  'organizationid',
  'orgid',
  'tenantid',
  'workspaceid',
  'userid',
  'actorid',
  'requesterid',
  'role',
  'roles',
  'roleid',
  'capability',
  'capabilities',
  'capabilityid',
  'capabilityids',
  'allowedcapabilityids',
  'permission',
  'permissions',
  'grant',
  'grants',
  'approval',
  'approvalid',
  'approvalstate',
  'approvalstatus',
  'approved',
  'autoapprove',
  'autonomytier',
  'isadmin',
  'admin',
  // Prompt 5 — policy claims. A policy decision comes only from the
  // server-side engine over trusted state; a model or client naming one
  // (or asking to skip / override it) is a forged authority claim.
  'policy',
  'policyid',
  'policyversion',
  'policydecision',
  'policyoutcome',
  'policyoverride',
  'policycheck',
  'skippolicy',
  'bypasspolicy',
  'skipapproval',
  'bypassapproval',
  'requiresapproval',
  'approvalrequired',
  'preapproved',
];

/**
 * Argument keys that name an AGENT principal or its delegated authority
 * (Prompt 4). An agent's identity and delegations come only from persisted,
 * server-resolved state — a model or client naming them is a forged agent
 * context (`FORGED_AGENT_CONTEXT`), rejected and audited.
 */
export const RESERVED_AGENT_ARGUMENT_KEYS: readonly string[] = [
  'agent',
  'agentid',
  'agentidentityid',
  'principal',
  'principalid',
  'delegation',
  'delegationid',
  'delegations',
  'onbehalfof',
  'actingas',
  'owneruserid',
  'grantedby',
  'grantedbyuserid',
];

const RESERVED = new Set(RESERVED_ARGUMENT_KEYS);
const RESERVED_AGENT = new Set(RESERVED_AGENT_ARGUMENT_KEYS);

/**
 * Deepest nesting inspected for reserved keys (arguments are shallow by
 * contract). Arguments nested DEEPER than this are not silently ignored:
 * the guard fails closed with `ARGUMENT_TOO_DEEP` (Prompt 9, G8a), so a
 * reserved key can never hide below the inspected depth.
 */
export const MAX_ARGUMENT_DEPTH = 6;
const MAX_DEPTH = MAX_ARGUMENT_DEPTH;

/** The outcome of {@link ArgumentGuard.check}. */
export type ArgumentCheck =
  | { ok: true }
  | {
      ok: false;
      /**
       * `FORGED_AGENT_CONTEXT` (an agent principal/delegation named in the
       * arguments), `RESERVED_ARGUMENT` (forged scope/authority),
       * `ARGUMENT_TOO_DEEP` (nesting beyond {@link MAX_ARGUMENT_DEPTH}; a
       * security block, fail closed) or `INVALID_ARGUMENTS` (schema).
       */
      code:
        'FORGED_AGENT_CONTEXT' | 'RESERVED_ARGUMENT' | 'ARGUMENT_TOO_DEEP' | 'INVALID_ARGUMENTS';
      /** A safe, structured reason (field paths and rule names — never values). */
      reason: string;
    };

/** Normalizes a key for the reserved-key comparison. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s.]/g, '');
}

/** Finds the paths of every reserved key in a value (depth-bounded). */
export function findReservedArgumentPaths(value: unknown, path = '', depth = 0): string[] {
  if (depth > MAX_DEPTH || typeof value !== 'object' || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findReservedArgumentPaths(item, `${path}[${index}]`, depth + 1),
    );
  }
  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path.length > 0 ? `${path}.${key}` : key;
    const normalized = normalizeKey(key);
    if (RESERVED.has(normalized) || RESERVED_AGENT.has(normalized)) {
      found.push(childPath);
    }
    found.push(...findReservedArgumentPaths(child, childPath, depth + 1));
  }
  return found;
}

/**
 * The path of the first value nested deeper than {@link MAX_ARGUMENT_DEPTH}
 * (an object or array below the inspected depth), or `undefined`. Pure and
 * itself depth-bounded, so a cyclic structure terminates.
 */
export function findTooDeepArgumentPath(value: unknown, path = '', depth = 0): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  if (depth > MAX_DEPTH) {
    return path.length > 0 ? path : '<root>';
  }
  const children: [string, unknown][] = Array.isArray(value)
    ? value.map((item, index) => [`${path}[${index}]`, item])
    : Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        path.length > 0 ? `${path}.${key}` : key,
        child,
      ]);
  for (const [childPath, child] of children) {
    const deep = findTooDeepArgumentPath(child, childPath, depth + 1);
    if (deep !== undefined) {
      return deep;
    }
  }
  return undefined;
}

/**
 * The schema-independent trust checks over untrusted arguments: no reserved
 * scope/authority/agent key at any inspected depth (`RESERVED_ARGUMENT` /
 * `FORGED_AGENT_CONTEXT`) and no nesting beyond {@link MAX_ARGUMENT_DEPTH}
 * (`ARGUMENT_TOO_DEEP`, fail closed). Shared by the {@link ArgumentGuard} and
 * by entry points that screen arguments before a tool is resolved (MCP).
 */
export function checkArgumentTrust(input: unknown): ArgumentCheck {
  const reserved = findReservedArgumentPaths(input);
  if (reserved.length > 0) {
    const forgedAgent = reserved.some((path) => isAgentPath(path));
    return {
      ok: false,
      code: forgedAgent ? 'FORGED_AGENT_CONTEXT' : 'RESERVED_ARGUMENT',
      reason: `arguments may not set trusted scope or authority fields: ${reserved.slice(0, 5).join(', ')}`,
    };
  }
  const tooDeep = findTooDeepArgumentPath(input);
  if (tooDeep !== undefined) {
    // Fail closed: keys below the inspected depth were never checked, so the
    // whole argument set is refused (never ignored, never executed).
    return {
      ok: false,
      code: 'ARGUMENT_TOO_DEEP',
      reason: `arguments are nested deeper than ${MAX_DEPTH} levels at: ${tooDeep.slice(0, 120)}`,
    };
  }
  return { ok: true };
}

/**
 * The argument guard. Compiled schemas are cached per tool id (a manifest is
 * immutable once registered).
 */
export class ArgumentGuard {
  readonly #ajv = new Ajv({ allErrors: true, strict: false });
  readonly #compiled = new Map<string, ValidateFunction | null>();

  /**
   * Checks tool arguments.
   *
   * @param toolId      - the tool id (schema cache key).
   * @param inputSchema - the tool's declared JSON schema.
   * @param input       - the untrusted arguments.
   */
  check(toolId: string, inputSchema: Record<string, unknown>, input: unknown): ArgumentCheck {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return { ok: false, code: 'INVALID_ARGUMENTS', reason: 'arguments must be an object' };
    }
    const trust = checkArgumentTrust(input);
    if (!trust.ok) {
      return trust;
    }
    const validate = this.#compile(toolId, inputSchema);
    if (validate === null) {
      // A schema that cannot compile must never let arguments through.
      return { ok: false, code: 'INVALID_ARGUMENTS', reason: 'the tool input schema is invalid' };
    }
    if (validate(input)) {
      return { ok: true };
    }
    const reason = (validate.errors ?? [])
      .slice(0, 5)
      .map((issue) => {
        const where = issue.instancePath.length > 0 ? issue.instancePath : '<root>';
        const extra =
          issue.keyword === 'additionalProperties'
            ? ` (${String((issue.params as { additionalProperty?: string }).additionalProperty)})`
            : '';
        return `${where}: ${issue.keyword}${extra}`;
      })
      .join('; ');
    return {
      ok: false,
      code: 'INVALID_ARGUMENTS',
      reason: `arguments do not match the tool schema — ${reason}`,
    };
  }

  #compile(toolId: string, schema: Record<string, unknown>): ValidateFunction | null {
    if (this.#compiled.has(toolId)) {
      return this.#compiled.get(toolId) ?? null;
    }
    let compiled: ValidateFunction | null;
    try {
      // An empty schema declares no contract; treat it as "any object".
      compiled = this.#ajv.compile(Object.keys(schema).length === 0 ? { type: 'object' } : schema);
    } catch {
      compiled = null;
    }
    this.#compiled.set(toolId, compiled);
    return compiled;
  }
}

/** Whether a reserved path's final key names an agent principal / delegation. */
export function isAgentPath(path: string): boolean {
  const last =
    path
      .replace(/\[\d+\]$/, '')
      .split('.')
      .pop() ?? '';
  return RESERVED_AGENT.has(normalizeKey(last));
}
