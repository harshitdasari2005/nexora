/**
 * @nexora/agent-sdk — builders.
 *
 * Fluent builders for constructing manifests and agent instances. Builders
 * reduce boilerplate when domains define their agents and keep manifest
 * construction consistent (ENGINEERING_PLAYBOOK.md §2 conventions).
 */

import type {
  AgentIdentity,
  AgentManifest,
  AgentSkill,
  AgentTool,
  CapabilityContract,
  SideEffectClass,
} from '@nexora/contracts/ai';

/** A fluent builder for an {@link AgentIdentity}. */
export class IdentityBuilder {
  #id = '';
  #name = '';
  #displayName = '';

  /** Sets the agent id (`agt_...`). */
  withId(id: string): this {
    this.#id = id;
    return this;
  }

  /** Sets the stable agent name (the owning bounded context). */
  withName(name: string): this {
    this.#name = name;
    return this;
  }

  /** Sets the human-readable display name. */
  withDisplayName(displayName: string): this {
    this.#displayName = displayName;
    return this;
  }

  /** Builds the identity. */
  build(): AgentIdentity {
    return { id: this.#id, name: this.#name, displayName: this.#displayName };
  }
}

/** A fluent builder for an {@link AgentSkill}. */
export class SkillBuilder {
  #id = '';
  #description = '';
  #toolIds: string[] = [];
  #autonomyTier: AgentSkill['autonomyTier'] = 'supervised';
  #requiresApproval = false;

  /** Sets the skill id. */
  withId(id: string): this {
    this.#id = id;
    return this;
  }

  /** Sets the description. */
  withDescription(description: string): this {
    this.#description = description;
    return this;
  }

  /** Adds tool ids the skill may invoke. */
  withToolIds(...toolIds: string[]): this {
    this.#toolIds.push(...toolIds);
    return this;
  }

  /** Sets the autonomy tier. */
  withAutonomyTier(tier: AgentSkill['autonomyTier']): this {
    this.#autonomyTier = tier;
    return this;
  }

  /** Marks the skill as requiring human approval. */
  requiringApproval(): this {
    this.#requiresApproval = true;
    return this;
  }

  /** Builds the skill contract. */
  build(): AgentSkill {
    return {
      id: this.#id,
      description: this.#description,
      toolIds: this.#toolIds,
      autonomyTier: this.#autonomyTier,
      requiresApproval: this.#requiresApproval,
    };
  }
}

/** A fluent builder for an {@link AgentTool}. */
export class ToolBuilder {
  #id = '';
  #sideEffectClass: SideEffectClass = 'read_only';
  #idempotent = false;
  #timeoutMs = 10_000;
  #inputSchema: Record<string, unknown> = {};

  /** Sets the tool id. */
  withId(id: string): this {
    this.#id = id;
    return this;
  }

  /** Sets the side-effect class (drives approval routing). */
  withSideEffectClass(sideEffectClass: SideEffectClass): this {
    this.#sideEffectClass = sideEffectClass;
    return this;
  }

  /** Marks the tool as idempotent-safe. */
  idempotent(): this {
    this.#idempotent = true;
    return this;
  }

  /** Sets the invocation timeout, in milliseconds. */
  withTimeout(timeoutMs: number): this {
    this.#timeoutMs = timeoutMs;
    return this;
  }

  /** Sets the input JSON schema. */
  withInputSchema(inputSchema: Record<string, unknown>): this {
    this.#inputSchema = inputSchema;
    return this;
  }

  /** Builds the tool contract. */
  build(): AgentTool {
    return {
      id: this.#id,
      sideEffectClass: this.#sideEffectClass,
      idempotent: this.#idempotent,
      timeoutMs: this.#timeoutMs,
      inputSchema: this.#inputSchema,
    };
  }
}

/** A fluent builder for a {@link CapabilityContract}. */
export class CapabilityBuilder {
  #id = '';
  #name = '';
  #description = '';
  #skillId = '';
  #sideEffectClass: SideEffectClass = 'read_only';
  #mutatesState = false;

  /** Sets the capability id. */
  withId(id: string): this {
    this.#id = id;
    return this;
  }

  /** Sets the capability name. */
  withName(name: string): this {
    this.#name = name;
    return this;
  }

  /** Sets the description for the planner. */
  withDescription(description: string): this {
    this.#description = description;
    return this;
  }

  /** Sets the implementing skill id. */
  implementedBy(skillId: string): this {
    this.#skillId = skillId;
    return this;
  }

  /** Sets the side-effect class. */
  withSideEffectClass(sideEffectClass: SideEffectClass): this {
    this.#sideEffectClass = sideEffectClass;
    return this;
  }

  /** Marks the capability as state-mutating. */
  mutatesState(): this {
    this.#mutatesState = true;
    return this;
  }

  /** Builds the capability contract. */
  build(): CapabilityContract {
    return {
      id: this.#id,
      name: this.#name,
      description: this.#description,
      skillId: this.#skillId,
      sideEffectClass: this.#sideEffectClass,
      mutatesState: this.#mutatesState,
    };
  }
}

/** A fluent builder for an {@link AgentManifest}. */
export class ManifestBuilder {
  #identity: AgentIdentity = { id: '', name: '', displayName: '' };
  #version = '0.1.0';
  #skills: AgentSkill[] = [];
  #tools: AgentTool[] = [];
  #knowledgeScopes: string[] = [];
  #policyIds: string[] = [];
  #emittedEventTypes: string[] = [];
  #subscribedEventTypes: string[] = [];

  /** Sets the agent identity. */
  withIdentity(identity: AgentIdentity): this {
    this.#identity = identity;
    return this;
  }

  /** Sets the semantic version. */
  withVersion(version: string): this {
    this.#version = version;
    return this;
  }

  /** Adds skills to the manifest. */
  withSkills(...skills: AgentSkill[]): this {
    this.#skills.push(...skills);
    return this;
  }

  /** Adds tools to the manifest. */
  withTools(...tools: AgentTool[]): this {
    this.#tools.push(...tools);
    return this;
  }

  /** Adds knowledge scopes the agent may read. */
  withKnowledgeScopes(...scopes: string[]): this {
    this.#knowledgeScopes.push(...scopes);
    return this;
  }

  /** Adds policy ids the agent is bound by. */
  withPolicyIds(...policyIds: string[]): this {
    this.#policyIds.push(...policyIds);
    return this;
  }

  /** Adds event types the agent emits. */
  emitting(...eventTypes: string[]): this {
    this.#emittedEventTypes.push(...eventTypes);
    return this;
  }

  /** Adds event types the agent subscribes to. */
  subscribing(...eventTypes: string[]): this {
    this.#subscribedEventTypes.push(...eventTypes);
    return this;
  }

  /** Builds the agent manifest. */
  build(): AgentManifest {
    return {
      identity: this.#identity,
      version: this.#version,
      skills: this.#skills,
      tools: this.#tools,
      knowledgeScopes: this.#knowledgeScopes,
      policyIds: this.#policyIds,
      emittedEventTypes: this.#emittedEventTypes,
      subscribedEventTypes: this.#subscribedEventTypes,
      updatedAt: new Date().toISOString(),
    };
  }
}
