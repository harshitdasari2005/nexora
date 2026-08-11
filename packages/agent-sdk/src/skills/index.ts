/**
 * @nexora/agent-sdk — skills.
 *
 * Skills bundle a capability with the tools and permissions to execute it
 * (AIR.md §5). The SDK defines the generic `Skill` contract; the canonical
 * manifest shape is `SkillContract` from `@nexora/contracts/ai`.
 */

import type { SkillContract } from '@nexora/contracts/ai';
import type { SkillId } from '../types/index.js';

/** A skill manifest: the declarative contract of a skill. */
export interface SkillManifest {
  /** Skill id, e.g. `hr.hire_employee`. */
  id: SkillId;
  /** Skill name. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Capability ids this skill implements. */
  capabilityIds: readonly string[];
  /** Tool ids this skill may invoke. */
  toolIds: readonly string[];
  /** Autonomy tier allowed for this skill. */
  autonomyTier: SkillContract['autonomyTier'];
  /** Whether executing this skill requires human approval. */
  requiresApproval: boolean;
}

/** The input passed to a skill. */
export interface SkillInput {
  /** The user intent being fulfilled. */
  intent: string;
  /** Structured arguments for the skill. */
  args: Record<string, unknown>;
  /** Tenant scope. */
  tenantId: string;
  /** Workspace scope, when workspace-scoped. */
  workspaceId?: string;
  /** Execution id for tracing. */
  executionId: string;
}

/** The output of a skill execution. */
export interface SkillOutput<TOutput = unknown> {
  /** Whether the execution succeeded. */
  ok: boolean;
  /** Output on success. */
  output?: TOutput;
  /** Error message on failure. */
  error?: string;
}

/** A skill the agent may execute. */
export interface Skill<TInput = SkillInput, TOutput = unknown> {
  /** The skill manifest. */
  readonly manifest: SkillManifest;
  /** Executes the skill. */
  execute(input: TInput): Promise<SkillOutput<TOutput>>;
}

/** Metadata attached to a registered skill. */
export interface SkillMetadata {
  /** Skill id. */
  id: SkillId;
  /** ISO-8601 UTC time the skill was registered. */
  registeredAt: string;
}

/** A registry entry for a registered skill. */
export interface SkillDescriptor {
  /** The skill manifest. */
  manifest: SkillManifest;
  /** Registration metadata. */
  metadata: SkillMetadata;
}

/**
 * The skill registry: registers and resolves skills by id (AIR.md §5 skill
 * registry).
 */
export class SkillRegistry {
  readonly #skills = new Map<string, Skill<unknown, unknown>>();
  readonly #metadata = new Map<string, SkillMetadata>();

  /** Registers a skill. Throws on duplicate ids. */
  register(skill: Skill<unknown, unknown>): void {
    if (this.#skills.has(skill.manifest.id)) {
      throw new Error(`Skill already registered: ${skill.manifest.id}`);
    }
    this.#skills.set(skill.manifest.id, skill);
    this.#metadata.set(skill.manifest.id, {
      id: skill.manifest.id,
      registeredAt: new Date().toISOString(),
    });
  }

  /** Returns the registered skill, or `undefined`. */
  resolve(id: string): Skill<unknown, unknown> | undefined {
    return this.#skills.get(id);
  }

  /** Returns the skill descriptor, or `undefined`. */
  describe(id: string): SkillDescriptor | undefined {
    const manifest = this.#skills.get(id)?.manifest;
    const metadata = this.#metadata.get(id);
    if (manifest === undefined || metadata === undefined) {
      return undefined;
    }
    return { manifest, metadata };
  }

  /** All registered skill ids. */
  ids(): readonly string[] {
    return [...this.#skills.keys()];
  }

  /** The number of registered skills. */
  get size(): number {
    return this.#skills.size;
  }

  /** Converts every registered skill to its canonical contract shape. */
  toContracts(): readonly SkillContract[] {
    return [...this.#skills.values()].map((skill) => ({
      id: skill.manifest.id,
      name: skill.manifest.name,
      description: skill.manifest.description,
      capabilityIds: skill.manifest.capabilityIds,
      toolIds: skill.manifest.toolIds,
      autonomyTier: skill.manifest.autonomyTier,
      requiresApproval: skill.manifest.requiresApproval,
    }));
  }
}
