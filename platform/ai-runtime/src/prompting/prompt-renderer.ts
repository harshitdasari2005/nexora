/**
 * @nexora/ai-runtime — prompt renderer.
 *
 * Renders a {@link PromptTemplate} with variables. Rendering is strict:
 * undeclared variables, missing variables, and non-stringifiable values are
 * rejected with a {@link ValidationError} carrying field issues — a
 * half-rendered prompt is worse than none (AIR.md §1.2 R14).
 */

import { ValidationError, type FieldIssue } from '@nexora/shared/errors';
import type { PromptTemplate, PromptVariables } from './prompt-template.js';

/** The renderer contract. */
export interface PromptRenderer {
  /** Renders the template with variables, or a {@link ValidationError}. */
  render(template: PromptTemplate, variables: PromptVariables): Promise<string> | string;
}

/** A strict `{{variable}}` renderer. */
export class TemplateRenderer implements PromptRenderer {
  render(template: PromptTemplate, variables: PromptVariables): string {
    const issues: FieldIssue[] = [];

    for (const name of template.variables) {
      if (variables[name] === undefined) {
        issues.push({ path: name, message: `Variable ${name} is required` });
      }
    }
    for (const name of Object.keys(variables)) {
      if (!template.variables.includes(name)) {
        issues.push({ path: name, message: `Variable ${name} is not declared by the template` });
      }
    }
    if (issues.length > 0) {
      throw new ValidationError('Prompt rendering rejected', issues);
    }

    let rendered = template.text;
    for (const [name, value] of Object.entries(variables)) {
      const token = new RegExp(`\\{\\{\\s*${escapeRegExp(name)}\\s*\\}\\}`, 'g');
      rendered = rendered.replace(token, stringify(value));
    }
    return rendered;
  }
}

/** A no-op renderer that returns the template text unchanged (system prompts). */
export const passthroughRenderer: PromptRenderer = {
  render: (template) => template.text,
};

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
