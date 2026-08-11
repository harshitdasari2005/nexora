/**
 * @nexora/ai-runtime — prompt registry.
 *
 * The versioned store of prompt templates (AIR.md §1.2 R14 Prompt Runtime).
 * Resolves a template by id, optionally pinning a version; `latest` returns
 * the highest semver version registered for an id.
 */

import { NotFoundError } from '@nexora/shared/errors';
import type { PromptTemplate } from './prompt-template.js';

/** Parses a semantic version into comparable parts (loose). */
function parseVersion(version: string): number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

/** Compares two semver strings: -1, 0, or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff < 0 ? -1 : 1;
    }
  }
  return 0;
}

/** The versioned prompt template registry. */
export class PromptRegistry {
  readonly #templates = new Map<string, PromptTemplate[]>();

  /** Registers a template version. Throws on duplicate id@version. */
  register(template: PromptTemplate): void {
    const versions = this.#templates.get(template.id) ?? [];
    if (versions.some((existing) => existing.version === template.version)) {
      throw new Error(`Template ${template.id}@${template.version} is already registered`);
    }
    versions.push(template);
    versions.sort((a, b) => compareVersions(b.version, a.version));
    this.#templates.set(template.id, versions);
  }

  /** Resolves a template by id and optional version; latest when omitted. */
  resolve(id: string, version?: string): PromptTemplate {
    const versions = this.#templates.get(id);
    if (versions === undefined || versions.length === 0) {
      throw new NotFoundError(`Prompt template not found: ${id}`);
    }
    if (version === undefined) {
      return versions[0] as PromptTemplate;
    }
    const match = versions.find((template) => template.version === version);
    if (match === undefined) {
      throw new NotFoundError(`Prompt template ${id}@${version} not found`);
    }
    return match;
  }

  /** All registered versions for an id (highest first). */
  versions(id: string): readonly PromptTemplate[] {
    return this.#templates.get(id) ?? [];
  }

  /** Every registered template id. */
  ids(): readonly string[] {
    return [...this.#templates.keys()];
  }

  /** The number of registered template versions. */
  get size(): number {
    return [...this.#templates.values()].reduce((sum, versions) => sum + versions.length, 0);
  }
}
