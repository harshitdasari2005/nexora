/**
 * @nexora/ai-runtime — system prompt builder.
 *
 * Composes a system prompt from structurally separated sections (AIR.md
 * §1.2 R14: instructions separated from content). Used by the orchestrator
 * when a model provider narrates; keeps instruction hygiene explicit.
 */

/** A system prompt section. */
export interface PromptSection {
  /** Section heading. */
  heading: string;
  /** Section body. */
  body: string;
}

/** Builds a system prompt from ordered sections. */
export class SystemPromptBuilder {
  readonly #sections: PromptSection[] = [];

  /** Appends a section (replaces an existing section with the same heading). */
  section(heading: string, body: string): this {
    const existing = this.#sections.findIndex((entry) => entry.heading === heading);
    if (existing >= 0) {
      this.#sections[existing] = { heading, body };
    } else {
      this.#sections.push({ heading, body });
    }
    return this;
  }

  /** Appends a role/identity section. */
  role(body: string): this {
    return this.section('Role', body);
  }

  /** Appends a workspace context section. */
  context(body: string): this {
    return this.section('Context', body);
  }

  /** Appends a policy section. */
  policy(body: string): this {
    return this.section('Policies', body);
  }

  /** Appends an instruction section. */
  instruction(body: string): this {
    return this.section('Instructions', body);
  }

  /** Builds the composed system prompt. */
  build(): string {
    return this.#sections.map((entry) => `# ${entry.heading}\n${entry.body}`).join('\n\n');
  }

  /** The current sections (for inspection). */
  sections(): readonly PromptSection[] {
    return [...this.#sections];
  }
}
