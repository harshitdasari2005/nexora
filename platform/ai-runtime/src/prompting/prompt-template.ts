/**
 * @nexora/ai-runtime — prompting.
 *
 * The governed prompt runtime (AIR.md §1.2 R14): versioned templates,
 * structural separation of instructions from content, and safe rendering.
 * Prompts are versioned artifacts — every change is a new version, never an
 * in-place edit.
 */

import type { SemVer } from '@nexora/contracts/common';

/** Template variables: string keys to JSON-compatible values. */
export type PromptVariables = Record<string, unknown>;

/** A versioned prompt template with declared variables. */
export interface PromptTemplate {
  /** Stable template id, e.g. `ai.narration.summary`. */
  id: string;
  /** Template semantic version. */
  version: SemVer;
  /** Human-readable description. */
  description?: string;
  /** The template text with `{{variable}}` placeholders. */
  text: string;
  /** Declared variables the template expects. */
  variables: readonly string[];
  /** ISO-8601 UTC time the version was created. */
  createdAt: string;
}

/**
 * Builds a new template version. When `variables` is omitted, declared
 * variables are extracted from the `{{variable}}` placeholders in `text`.
 */
export function createTemplate(input: {
  id: string;
  version: SemVer;
  text: string;
  description?: string;
  variables?: readonly string[];
}): PromptTemplate {
  const variables = input.variables ?? Array.from(textVariables(input.text));
  return {
    id: input.id,
    version: input.version,
    description: input.description,
    text: input.text,
    variables,
    createdAt: new Date().toISOString(),
  };
}

/** Extracts unique `{{name}}` variable tokens from a template text. */
function textVariables(text: string): Set<string> {
  const variables = new Set<string>();
  const pattern = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    variables.add(match[1] as string);
  }
  return variables;
}
