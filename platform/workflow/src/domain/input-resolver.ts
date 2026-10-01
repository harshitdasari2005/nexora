/**
 * @nexora/module-workflow — step input binding.
 *
 * Deterministic step input resolution: a step's declared `input` template is
 * bound from the workflow input and accumulated state at execution time.
 * `{{key}}` placeholders resolve `key` from the workflow input first, then
 * the accumulated state; `{{step.a.b}}` reads a nested value of a step's
 * RECORDED output — from the accumulated state only, never from input. Values that are not placeholders pass through
 * unchanged. Identity, tenant, and scope are NEVER part of step input — they
 * arrive via the trusted execution context, exactly like the AI tools.
 */

/** Resolves a `{{key}}` placeholder from the workflow input/state. */
const PLACEHOLDER = /^\{\{([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}\}$/;

/** Resolves one template value against the available sources. */
export function resolveTemplateValue(
  value: unknown,
  input: Record<string, unknown>,
  state: Record<string, unknown>,
): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const match = value.match(PLACEHOLDER);
  if (match === null) {
    return value;
  }
  const [head, ...rest] = (match[1] as string).split('.');
  const key = head as string;
  if (rest.length > 0) {
    // A dotted path is a reference to a RECORDED step output
    // (`{{hire_employee.employee.id}}`). It resolves from the accumulated
    // step state ONLY — never from caller-supplied workflow input, which
    // could otherwise shadow a step id and redirect the reference (e.g. make
    // a compensation act on an arbitrary record).
    if (!(key in state)) {
      return undefined;
    }
    let resolved: unknown = state[key];
    for (const segment of rest) {
      if (typeof resolved !== 'object' || resolved === null || !(segment in resolved)) {
        return undefined;
      }
      resolved = (resolved as Record<string, unknown>)[segment];
    }
    return resolved;
  }
  if (key in input) {
    return input[key];
  }
  if (key in state) {
    return state[key];
  }
  return undefined;
}

/** Resolves a step input template against the workflow input/state. */
export function resolveStepInput(
  template: Record<string, unknown> | undefined,
  input: Record<string, unknown>,
  state: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(template ?? {})) {
    const bound = resolveTemplateValue(value, input, state);
    if (bound !== undefined) {
      resolved[key] = bound;
    }
  }
  return resolved;
}
