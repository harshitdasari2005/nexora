/**
 * @nexora/app-api — deterministic intent parameter extraction.
 *
 * Binds the user-controlled business parameters of an intent into the plan
 * step input (AIR.md §6.3). For the create-workspace capability the only
 * parameter is the workspace `name`; for the create-project capability the
 * `name` (and optional `description`) — extracted from standard phrasings
 * ("called X", "named X", "create the X workspace/project"). Identity,
 * tenant, and scope are NEVER extracted here: they always arrive via the
 * trusted execution context (AI security contract). This seam is replaced
 * by LLM tool-calling in a future phase without changing the planner.
 */

/** The maximum name length (mirrors the application validators). */
const NAME_MAX_LENGTH = 80;

/** The maximum description length (mirrors the application validator). */
const DESCRIPTION_MAX_LENGTH = 2000;

/**
 * A clause-introducing word: when a space is followed by one of these, the
 * name phrase ends ("called Payroll **in** organization X").
 */
const CLAUSE_WORDS = /\s+(?:in|for|with|as|to|under|from|at|by|on|of|belonging)\b/i;

/** Truncates a raw name at the first clause boundary and trims. */
export function boundName(raw: string): string {
  const clause = raw.match(CLAUSE_WORDS);
  if (clause?.index !== undefined) {
    return raw.slice(0, clause.index).trim();
  }
  return raw.trim();
}

/**
 * Extracts `{ name }` from a create-workspace intent. Returns `{}` when no
 * name can be determined — the tool then fails validation rather than
 * inventing input. The signature is the runtime's {@link
 * IntentParameterExtractor} contract.
 *
 * The name is always **clause-bounded**: trailing clauses ("in organization
 * X", "with role admin", "as owner") are never part of the name — a
 * prompt-injection attempt can pollute the action input, but never the
 * identity, tenant, or scope (those arrive only via the trusted execution
 * context).
 */
export function extractCreateWorkspaceParameters(input: {
  /** The user intent. */
  intent: string;
  /** The tool's JSON-schema input contract (name is the only property). */
  inputSchema: Record<string, unknown>;
}): Record<string, unknown> {
  const patterns: readonly RegExp[] = [
    // "create a workspace called Engineering" / "... named Engineering"
    /(?:called|named)\s+["'`]?([A-Za-z0-9][A-Za-z0-9 _-]{0,78})["'`]?(?=[\s.,!?]|$)/i,
    // "create the Mobile App workspace" / "create an Engineering workspace"
    /(?:create|make|add|set up|setup)\s+(?:a|an|the|new)?\s*["'`]?([A-Za-z0-9][A-Za-z0-9 _-]{0,78}?)["'`]?(?=\s+workspace\b|$)/i,
  ];
  for (const pattern of patterns) {
    const match = input.intent.match(pattern);
    if (match === null) {
      continue;
    }
    const name = boundName(match[1] ?? '');
    if (name.length === 0 || name.length > NAME_MAX_LENGTH || /^workspace$/i.test(name)) {
      continue;
    }
    return { name };
  }
  return {};
}

/**
 * Extracts `{ name, description? }` from a create-project intent. Returns
 * `{}` when no name can be determined — the tool then fails validation
 * rather than inventing input. The name is clause-bounded exactly like the
 * workspace extractor; the description is captured from a "with the
 * description …" clause when present.
 */
export function extractCreateProjectParameters(input: {
  /** The user intent. */
  intent: string;
  /** The tool's JSON-schema input contract (name + description). */
  inputSchema: Record<string, unknown>;
}): Record<string, unknown> {
  const patterns: readonly RegExp[] = [
    // "create a project called Mobile Banking" / "... named X"
    /(?:called|named)\s+["'`]?([A-Za-z0-9][A-Za-z0-9 _-]{0,78})["'`]?(?=[\s.,!?]|$)/i,
    // "create the Mobile Banking project" / "create a Mobile Banking project"
    /(?:create|make|add|start|open)\s+(?:a|an|the|new)?\s*["'`]?([A-Za-z0-9][A-Za-z0-9 _-]{0,78}?)["'`]?(?=\s+project\b|$)/i,
  ];
  for (const pattern of patterns) {
    const match = input.intent.match(pattern);
    if (match === null) {
      continue;
    }
    const name = boundName(match[1] ?? '');
    if (name.length === 0 || name.length > NAME_MAX_LENGTH || /^project$/i.test(name)) {
      continue;
    }
    const result: Record<string, unknown> = { name };
    const description = extractProjectDescription(input.intent);
    if (description !== undefined) {
      result.description = description;
    }
    return result;
  }
  return {};
}

/**
 * Extracts an optional project description from "with (the|a) description …"
 * clauses. Bounded to the description length and truncated at the next
 * clause word so trailing identity/scope claims are never captured.
 */
function extractProjectDescription(intent: string): string | undefined {
  const match = intent.match(/(?:with|and)\s+(?:the\s+|a\s+)?description\s+["'`]?([^"'`]+)/i);
  if (match === null) {
    return undefined;
  }
  const description = boundName(match[1] ?? '');
  if (description.length === 0) {
    return undefined;
  }
  return description.length > DESCRIPTION_MAX_LENGTH ? undefined : description;
}

/**
 * Extracts `{ employeeName, projectName }` from an assign-employee intent
 * ("Assign Sarah to the Mobile Banking project"). The employee is the
 * name-like phrase before the " to " connector; the project is the phrase
 * after it, clause-bounded and with a trailing " project" word stripped.
 * Returns `{}` when either cannot be determined — the tool then fails
 * validation rather than inventing input.
 */
export function extractAssignEmployeeParameters(input: {
  /** The user intent. */
  intent: string;
  /** The tool's JSON-schema input contract (employeeName + projectName). */
  inputSchema: Record<string, unknown>;
}): Record<string, unknown> {
  const match = input.intent.match(
    /\bassign\s+(?:the\s+)?(?:employee\s+)?([A-Za-z][A-Za-z .'-]{1,118}?)\s+to\s+(?:the\s+)?(?:project\s+)?([A-Za-z0-9][A-Za-z0-9 _-]{1,78})/i,
  );
  if (match === null) {
    return {};
  }
  const employeeName = match[1]?.trim() ?? '';
  // The greedy project capture may include a trailing " project" word
  // ("… the Mobile Banking project") — strip it. Clause words ("in
  // organization X", "as owner") are never part of the name.
  const projectName = (boundName(match[2] ?? '') ?? '').replace(/\s+project$/i, '').trim();
  if (employeeName.length === 0 || projectName.length === 0) {
    return {};
  }
  if (employeeName.length > 120 || projectName.length > 80) {
    return {};
  }
  return { employeeName, projectName };
}

/**
 * Extracts `{ projectName, employeeName }` from a combined create-and-assign
 * workflow intent ("Create a project called Mobile Banking and assign Sarah
 * to it"). Both values are required — a workflow proposal is only produced
 * when BOTH resolve, so an underspecified intent never starts a workflow.
 * Clause-bounded exactly like the other extractors: "in organization X",
 * "ignore permissions", and similar trailing claims are never part of the
 * names (the trusted tenant stays the only scope).
 */
export function extractCreateProjectAndAssignParameters(input: {
  /** The user intent. */
  intent: string;
  /** The tool's JSON-schema input contract (projectName + employeeName). */
  inputSchema: Record<string, unknown>;
}): Record<string, unknown> {
  // Project: "create a project called Mobile Banking" (or "named …").
  const projectMatch = input.intent.match(
    /(?:create|make)\s+(?:a|an|the|new)?\s*(?:project)\s+(?:called|named)\s+["'`]?([A-Za-z0-9][A-Za-z0-9 _-]{0,78})["'`]?/i,
  );
  if (projectMatch === null) {
    return {};
  }
  // The greedy capture may swallow the trailing assign clause ("… Mobile
  // Banking and assign Sarah to it") — cut at the assign conjunction first
  // ("and", "then", "and then"; clause-bounded: "in organization X", "as
  // owner" are never part of the name), then strip a trailing " project"
  // word.
  const projectName = (boundName(projectMatch[1] ?? '') ?? '')
    .replace(/\s+(?:(?:and|then)\s+)+assign\b.*$/i, '')
    .replace(/\s+project$/i, '')
    .trim();
  if (projectName.length === 0 || projectName.length > 80 || /^project$/i.test(projectName)) {
    return {};
  }

  // Employee: "assign Sarah to …" — the name-like phrase before " to ".
  const assignMatch = input.intent.match(
    /\bassign\s+(?:the\s+)?(?:employee\s+)?([A-Za-z][A-Za-z .'-]{1,118}?)\s+to\b/i,
  );
  if (assignMatch === null) {
    return {};
  }
  const employeeName = (assignMatch[1] ?? '').trim();
  if (employeeName.length === 0 || employeeName.length > 120) {
    return {};
  }

  return { projectName, employeeName };
}

/**
 * Extracts `{ employeeName, projectName }` from the flagship hire-and-assign
 * workflow intent ("Hire Sarah and assign her to the Mobile Banking
 * project"). Both values are required — a workflow proposal is only produced
 * when BOTH resolve, so an underspecified intent never starts a workflow.
 * The employee is the name-like phrase after "hire" (bounded at the "and
 * assign" conjunction); the project is the name-like phrase after "assign
 * her to", clause-bounded and with a trailing " project" word stripped.
 * Clause-bounded exactly like the other extractors: "in organization X",
 * "ignore permissions" are never part of the names (the trusted tenant
 * stays the only scope), and pronouns ("it", "her") are never project
 * names — a reference to an unnamed project produces no proposal.
 */
export function extractHireAndAssignParameters(input: {
  /** The user intent. */
  intent: string;
  /** The tool's JSON-schema input contract (employeeName + projectName). */
  inputSchema: Record<string, unknown>;
}): Record<string, unknown> {
  // Employee: "hire Sarah …" — the name-like phrase before " and|then
  // assign". The body is deliberately loose (any non-sentence character): a
  // trailing clause ("in organization org_alien") is allowed into the
  // capture so the match cannot break on punctuation, and `boundName` then
  // cuts the name at the first clause boundary — the clause is never part
  // of the employee name.
  const hireMatch = input.intent.match(
    /\bhire\s+(?:the\s+)?(?:employee\s+)?([A-Za-z][^.!?\n]{1,118}?)\s+(?:(?:and|then)\s+)+assign\b/i,
  );
  if (hireMatch === null) {
    return {};
  }
  const employeeName = (boundName(hireMatch[1] ?? '') ?? '').trim();
  if (employeeName.length === 0 || employeeName.length > 120) {
    return {};
  }

  // Project: "assign (her|him|them|the employee) to (the) (project) X" —
  // clause-bounded and with a trailing " project" word stripped.
  const projectMatch = input.intent.match(
    /\bassign\s+(?:her|him|them|the\s+employee|this\s+employee|the\s+person)\s+to\s+(?:the\s+)?(?:project\s+)?([A-Za-z0-9][A-Za-z0-9 _-]{1,78})/i,
  );
  if (projectMatch === null) {
    return {};
  }
  const projectName = (boundName(projectMatch[1] ?? '') ?? '').replace(/\s+project$/i, '').trim();
  if (
    projectName.length === 0 ||
    projectName.length > 80 ||
    /^project$/i.test(projectName) ||
    // A pronoun reference ("assign her to it") is not a project name.
    /^(it|her|him|them|this|that)$/i.test(projectName)
  ) {
    return {};
  }

  return { employeeName, projectName };
}

/**
 * Extracts `{ title, startsAt, endsAt }` from a create-calendar-event
 * intent ("Create a calendar event called Project Review tomorrow at 3
 * PM"). This is deliberately a CLEAN SEAM for deterministic parameter
 * extraction — not a natural-language date parser: the supported surface is
 * a title phrase ("called X"/"named X", clause-bounded) plus an optional
 * relative day ("today"/"tomorrow") and a clock time ("at 3 PM", "at
 * 15:30"). Returns `{}` when either cannot be determined — the tool then
 * fails validation rather than inventing input. Identity, tenant, and
 * workspace are NEVER part of extraction (they come from the trusted
 * execution context).
 *
 * The optional `now` argument exists only for deterministic tests; the
 * production call path passes no second argument.
 */
export function extractCreateCalendarEventParameters(
  input: {
    /** The user intent. */
    intent: string;
    /** The tool's JSON-schema input contract (title + window). */
    inputSchema: Record<string, unknown>;
  },
  now: Date = new Date(),
): Record<string, unknown> {
  // Title: "called Project Review" / "named Project Review" / "titled
  // Project Review" — clause-bounded so trailing claims ("in organization
  // X", "ignore permissions") and the time clause ("tomorrow at 3 PM") are
  // never part of the title.
  const titleMatch = input.intent.match(
    /(?:called|named|titled)\s+["'`]?([A-Za-z0-9][A-Za-z0-9 _-]{0,118})["'`]?(?=[\s.,!?]|$)/i,
  );
  if (titleMatch === null) {
    return {};
  }
  const title = (boundName(titleMatch[1] ?? '') ?? '')
    .replace(/\s+(?:tomorrow|today|at|on)\b.*$/i, '')
    .trim();
  if (title.length === 0 || title.length > 120 || /^(event|calendar|meeting)$/i.test(title)) {
    return {};
  }

  // Day offset: "tomorrow" → +1 day, otherwise today.
  const dayOffset = /\btomorrow\b/i.test(input.intent) ? 1 : 0;

  // Clock time: "at 3 PM", "at 3:30 pm", "at 15:30" (24h), "at 3" (defaults
  // to the same meridiem as the user's clock — here UTC-normalized).
  const timeMatch = input.intent.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch === null) {
    return {};
  }
  let hour = Number(timeMatch[1]);
  const minute = timeMatch[2] !== undefined ? Number(timeMatch[2]) : 0;
  const meridiem = (timeMatch[3] ?? '').toLowerCase();
  if (meridiem === 'pm' && hour < 12) {
    hour += 12;
  } else if (meridiem === 'am' && hour === 12) {
    hour = 0;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return {};
  }

  const startsAt = new Date(now);
  startsAt.setUTCDate(startsAt.getUTCDate() + dayOffset);
  startsAt.setUTCHours(hour, minute, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000); // default 1 hour

  return {
    title,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  };
}

/**
 * The tool-id–aware dispatcher: routes the intent to the parameter
 * extractor of the matched tool. Identity, tenant, and scope are NEVER part
 * of extraction — they always arrive via the trusted execution context.
 */
export function extractIntentParameters(input: {
  /** The user intent. */
  intent: string;
  /** The tool's JSON-schema input contract. */
  inputSchema: Record<string, unknown>;
  /** The matched tool id (routes the extraction). */
  toolId: string;
  /** The matched capability id. */
  capabilityId: string;
  /** The clock time-relative phrases ("tomorrow") resolve against (tests inject one). */
  now?: Date;
}): Record<string, unknown> {
  if (
    input.toolId === 'workflow.hire_and_assign_employee' ||
    input.capabilityId === 'workflow.hire_and_assign_employee'
  ) {
    return extractHireAndAssignParameters(input);
  }
  if (
    input.toolId === 'workflow.create_project_and_assign_employee' ||
    input.capabilityId === 'workflow.create_project_and_assign_employee'
  ) {
    return extractCreateProjectAndAssignParameters(input);
  }
  if (
    input.toolId === 'projects.assign_employee' ||
    input.capabilityId === 'projects.assign_employee'
  ) {
    return extractAssignEmployeeParameters(input);
  }
  if (
    input.toolId === 'projects.create_project' ||
    input.capabilityId === 'projects.create_project'
  ) {
    return extractCreateProjectParameters(input);
  }
  if (
    input.toolId === 'workspaces.create_workspace' ||
    input.capabilityId === 'workspaces.create_workspace'
  ) {
    return extractCreateWorkspaceParameters(input);
  }
  if (input.toolId === 'knowledge.search' || input.capabilityId === 'knowledge.search') {
    return extractKnowledgeQuestionParameters(input);
  }
  if (input.toolId === 'calendar.create_event' || input.capabilityId === 'calendar.create_event') {
    return extractCreateCalendarEventParameters(input, input.now);
  }
  if (input.toolId === 'projects.find_project' || input.capabilityId === 'projects.find_project') {
    return extractFindProjectParameters(input);
  }
  if (
    input.toolId === 'finance.submit_expense' ||
    input.capabilityId === 'finance.submit_expense'
  ) {
    return extractSubmitExpenseParameters(input.intent);
  }
  if (input.toolId.startsWith('github.') || input.toolId.startsWith('slack.')) {
    return extractConnectorParameters(input.toolId, input.intent);
  }
  return {};
}

/** A GitHub `owner/repo` reference (never a URL path segment). */
const GITHUB_REPOSITORY =
  /(?<![\w/:.])([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})(?![\w/])/;

/** A Slack channel reference (`#engineering`). */
const SLACK_CHANNEL = /(?:^|\s)#([a-z0-9][a-z0-9_-]{0,79})\b/i;

/**
 * Extracts connector tool arguments (GitHub / Slack) from the intent.
 *
 * Only the business values the connector schema names are ever produced:
 * a repository written as `owner/repo`, an issue title ("titled …" /
 * "called …" / "for …"), a Slack `#channel`, and message text ("saying …").
 * Anything the utterance does not state is left OUT — the executor's
 * argument guard then rejects the call against the tool's required fields,
 * so an incomplete request fails closed instead of reaching the provider
 * with empty values (previously `/repos//issues`).
 */
export function extractConnectorParameters(
  toolId: string,
  intent: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (toolId.startsWith('github.') && toolId !== 'github.repositories.list') {
    const repository = intent.match(GITHUB_REPOSITORY);
    if (repository !== null) {
      out['owner'] = repository[1];
      out['repo'] = repository[2]?.replace(/\.+$/, '');
    }
    if (toolId === 'github.issues.list') {
      const state = intent.match(/\b(open|closed)\b/i)?.[1]?.toLowerCase();
      if (state !== undefined) {
        out['state'] = state;
      }
    }
    if (toolId === 'github.issues.create') {
      const title = intent.match(
        /\b(?:titled|called|named|issue\s+(?:for|about))\s+["'`]?(.+?)["'`]?(?=\s+(?:in|on|to|at)\s+[A-Za-z0-9-]+\/|,|;|\s+then\b|$)/i,
      )?.[1];
      const bounded = title?.trim();
      if (bounded !== undefined && bounded.length > 0 && bounded.length <= 200) {
        out['title'] = bounded;
      }
    }
  }
  if (toolId === 'slack.messages.send' || toolId === 'slack.messages.recent') {
    const channel = intent.match(SLACK_CHANNEL)?.[1];
    if (channel !== undefined) {
      out['channel'] = `#${channel}`;
    }
    if (toolId === 'slack.messages.send') {
      const text = intent.match(
        /\b(?:saying|that says|with the text)\s+["'`]?(.+?)["'`]?\s*$/i,
      )?.[1];
      if (text !== undefined && text.trim().length > 0 && text.length <= 4000) {
        out['text'] = text.trim();
      }
    }
  }
  return out;
}

/**
 * Extracts `{ name }` from a find-project intent ("Find the Mobile Banking
 * project" / "…project called Mobile Banking" / "Review the Mobile Banking
 * project"). Clause-bounded exactly like the other extractors — trailing
 * clauses ("in organization X") are never part of the name. Returns `{}`
 * when no name can be determined — the tool then fails validation rather
 * than inventing input.
 */
export function extractFindProjectParameters(input: {
  /** The user intent. */
  intent: string;
  /** The tool's JSON-schema input contract (name is the only property). */
  inputSchema: Record<string, unknown>;
}): Record<string, unknown> {
  const patterns: readonly RegExp[] = [
    // "…project called Mobile Banking" / "…project named Mobile Banking"
    /(?:called|named)\s+["'`]?([A-Za-z0-9][A-Za-z0-9 _-]{0,78})["'`]?(?=[\s.,!?]|$)/i,
    // "find|show|open|get|review the Mobile Banking project" (optional
    // "the project" article; the name is the phrase before " project").
    /(?:find|show|open|get|review)\s+(?:the\s+)?(?:project\s+)?["'`]?([A-Za-z0-9][A-Za-z0-9 _-]{0,78}?)["'`]?(?=\s+project\b|$)/i,
  ];
  for (const pattern of patterns) {
    const match = input.intent.match(pattern);
    if (match === null) {
      continue;
    }
    const name = boundName(match[1] ?? '').trim();
    if (name.length === 0 || name.length > NAME_MAX_LENGTH || /^project$/i.test(name)) {
      continue;
    }
    return { name };
  }
  return {};
}

/**
 * Extracts `{ question }` for the knowledge.search tool: the user's intent
 * IS the question (the whole utterance, trimmed and bounded). The question
 * is the only user-controlled value — tenant/workspace/scope are never
 * part of extraction (they come from the trusted execution context, and
 * retrieval is permission-filtered BEFORE any content reaches the model).
 */
export function extractKnowledgeQuestionParameters(input: {
  /** The user intent. */
  intent: string;
  /** The tool's JSON-schema input contract (question is the only property). */
  inputSchema: Record<string, unknown>;
}): Record<string, unknown> {
  const question = input.intent.trim();
  if (question.length === 0) {
    return {};
  }
  if (question.length > 1000) {
    return { question: question.slice(0, 1000) };
  }
  return { question };
}

/** Currency symbols recognised in an expense request. */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  '₹': 'INR',
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
};

/**
 * Extracts `finance.submit_expense` arguments from an expense request such as
 * "Submit an expense of ₹75,000 for the Q3 campaign against budget bud_x".
 *
 * Only the four business values the tool schema names are ever produced, and
 * only when the utterance states them: the amount (converted to minor units,
 * two decimals), the currency (a code or a symbol), the description ("for
 * …"), and the budget id ("against budget …"). The budget id is a LOOKUP
 * KEY only — the policy engine and the tool resolve it inside the trusted
 * organization/workspace, so naming another tenant's id resolves to nothing.
 * Whatever is missing is left out and the executor's argument guard fails the
 * request closed against the tool's required fields.
 */
export function extractSubmitExpenseParameters(intent: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // The budget clause is removed first so digits inside a budget id can never
  // be mistaken for the amount; the amount must be introduced explicitly
  // ("of 1,000", a currency symbol, or a currency code) so digits inside
  // ordinary words ("Q3", "bud-123") are never read as money.
  const withoutBudget = intent.replace(
    /\b(?:against|on|from)\s+budget\s+[A-Za-z0-9_-]{1,64}/gi,
    ' ',
  );
  const amount =
    withoutBudget.match(
      /(?<![\w.-])(₹|\$|€|£)\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(INR|USD|EUR|GBP)?(?![\w-])/i,
    ) ??
    withoutBudget.match(
      /\bof\s+(?:(₹|\$|€|£)\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(INR|USD|EUR|GBP)?(?![\w-])/i,
    ) ??
    withoutBudget.match(/(?<![\w.-])()(\d[\d,]*(?:\.\d{1,2})?)\s*(INR|USD|EUR|GBP)(?![\w-])/i);
  if (amount !== null) {
    const value = Number((amount[2] ?? '').replace(/,/g, ''));
    if (Number.isFinite(value) && value > 0) {
      out['amountMinorUnits'] = Math.round(value * 100);
    }
    const currency = (amount[3] ?? CURRENCY_SYMBOLS[amount[1] ?? ''] ?? '').toUpperCase();
    if (currency.length === 3) {
      out['currency'] = currency;
    }
  }
  const budget = intent.match(/\b(?:against|on|from)\s+budget\s+([A-Za-z0-9_-]{1,64})/i);
  if (budget !== null) {
    out['budgetId'] = budget[1];
  }
  const description = intent.match(
    /\bfor\s+(.{1,120}?)(?=\s+(?:against|on|from)\s+budget\b|[.?!]?$)/i,
  );
  if (description !== null) {
    const text = (description[1] ?? '').trim();
    if (text.length > 0) {
      out['description'] = text.slice(0, 120);
    }
  }
  return out;
}
