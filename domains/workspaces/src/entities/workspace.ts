/**
 * @nexora/domain-workspaces — Workspace aggregate root.
 *
 * The operational boundary of Nexora (DOMAIN_MODEL.md §1 Tenancy; PSD.md §4
 * WS-1): a scoped container inside one organization that owns collaboration
 * and execution — settings, branding, preferences, feature flags, and the
 * bindings to agents, knowledge, workflows, search providers, and
 * notification providers. A workspace belongs to exactly one organization
 * (the `organizationId`, immutable). All state changes flow through aggregate
 * methods, which enforce business invariants and record domain events.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { nowIso } from '@nexora/shared/time';
import type { TenantId } from '@nexora/contracts/common';

import type { WorkspaceEventContext } from '../events/index.js';
import {
  agentBoundEvent,
  agentUnboundEvent,
  knowledgeAttachedEvent,
  knowledgeDetachedEvent,
  notificationProviderAttachedEvent,
  searchProviderAttachedEvent,
  workflowAttachedEvent,
  workflowDetachedEvent,
  workspaceActivatedEvent,
  workspaceArchivedEvent,
  workspaceBrandingUpdatedEvent,
  workspaceCreatedEvent,
  workspaceSettingsUpdatedEvent,
  workspaceSuspendedEvent,
} from '../events/index.js';
import {
  AgentAlreadyBoundError,
  AgentNotBoundError,
  KnowledgeAlreadyAttachedError,
  KnowledgeNotAttachedError,
  WorkflowAlreadyAttachedError,
  WorkflowNotAttachedError,
  WorkspaceStateTransitionError,
} from '../errors/index.js';
import { WORKSPACE_TRANSITIONS } from '../policies/index.js';
import type { WorkspaceId } from '../value-objects/workspace-id.js';
import { WorkspaceId as WorkspaceIdFactory } from '../value-objects/workspace-id.js';
import { WorkspaceName } from '../value-objects/workspace-name.js';
import type { WorkspaceSlug } from '../value-objects/workspace-slug.js';
import { WorkspaceStatus } from '../value-objects/workspace-status.js';
import { WorkspaceVisibility } from '../value-objects/workspace-visibility.js';
import type { WorkspaceType } from '../value-objects/workspace-type.js';
import { WorkspaceAgentBinding } from './workspace-agent-binding.js';
import { WorkspaceKnowledgeBinding } from './workspace-knowledge-binding.js';
import { WorkspaceWorkflowBinding } from './workspace-workflow-binding.js';
import { WorkspaceSearchBinding } from './workspace-search-binding.js';
import { WorkspaceNotificationBinding } from './workspace-notification-binding.js';
import { WorkspaceBranding } from './workspace-branding.js';
import type { WorkspaceBrandingUpdate } from './workspace-branding.js';
import { WorkspacePreferences } from './workspace-preferences.js';
import type { WorkspacePreferencesUpdate } from './workspace-preferences.js';
import { WorkspaceSettings } from './workspace-settings.js';
import type { WorkspaceSettingsUpdate } from './workspace-settings.js';
import { WorkspaceFeature } from './workspace-feature.js';

/** Input for creating a new {@link Workspace}. */
export interface CreateWorkspaceInput {
  /** The owning organization (tenant) id — immutable. */
  organizationId: TenantId;
  /** The slug, unique within the organization (validated). */
  slug: WorkspaceSlug;
  /** The workspace name. */
  name: string;
  /** The template type. */
  type: WorkspaceType;
  /** The visibility scope (defaults to `private`). */
  visibility?: WorkspaceVisibility;
  /** Optional initial status (defaults to `provisioning`). */
  status?: WorkspaceStatus;
}

/**
 * A persistence snapshot of the {@link Workspace} aggregate (PERSISTENCE.md
 * §4 aggregate ownership). Plain data produced by {@link Workspace.snapshot}
 * and consumed by {@link Workspace.hydrate} — no behavior.
 */
export interface WorkspaceSnapshot {
  /** The workspace id. */
  id: WorkspaceId;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The slug, unique within the organization. */
  slug: WorkspaceSlug;
  /** The workspace name. */
  name: string;
  /** The template type. */
  type: WorkspaceType;
  /** The visibility value. */
  visibility: string;
  /** The lifecycle status value. */
  status: string;
  /** The owned settings. */
  settings: {
    /** Default locale. */
    defaultLocale: string;
    /** Default timezone. */
    defaultTimezone: string;
    /** Whether AI agents are enabled. */
    aiEnabled: boolean;
    /** Whether guests may be invited. */
    guestAccessEnabled: boolean;
    /** ISO-8601 UTC settings update time. */
    updatedAt: string;
  };
  /** The owned branding. */
  branding: {
    /** Accent color hex. */
    color: string;
    /** Icon token. */
    icon: string;
    /** ISO-8601 UTC branding update time. */
    updatedAt: string;
  };
  /** The owned preferences. */
  preferences: {
    /** Theme preference. */
    theme: string;
    /** UI density. */
    density: string;
    /** ISO-8601 UTC preferences update time. */
    updatedAt: string;
  };
  /** The feature flags. */
  features: readonly {
    /** Feature name. */
    name: string;
    /** Whether the feature is enabled. */
    enabled: boolean;
    /** ISO-8601 UTC creation time. */
    createdAt: string;
    /** ISO-8601 UTC last toggle time. */
    updatedAt: string;
  }[];
  /** The bound agent ids. */
  agentBindings: readonly {
    /** The bound agent id. */
    agentId: string;
    /** ISO-8601 UTC bind time. */
    boundAt: string;
  }[];
  /** The attached knowledge source ids. */
  knowledgeBindings: readonly {
    /** The attached knowledge source id. */
    knowledgeId: string;
    /** ISO-8601 UTC attach time. */
    boundAt: string;
  }[];
  /** The attached workflow ids. */
  workflowBindings: readonly {
    /** The attached workflow id. */
    workflowId: string;
    /** ISO-8601 UTC attach time. */
    boundAt: string;
  }[];
  /** The active search provider, when attached. */
  searchBinding?: {
    /** The search provider key. */
    provider: string;
    /** ISO-8601 UTC attach time. */
    boundAt: string;
  };
  /** The active notification provider, when attached. */
  notificationBinding?: {
    /** The notification provider key. */
    provider: string;
    /** ISO-8601 UTC attach time. */
    boundAt: string;
  };
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last mutation time. */
  updatedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link Workspace} aggregate root. Use {@link Workspace.create} to
 * construct; mutate only through aggregate methods so invariants stay
 * protected.
 */
export class Workspace {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #id: WorkspaceId;
  readonly #organizationId: TenantId;
  readonly #slug: WorkspaceSlug;
  readonly #name: WorkspaceName;
  readonly #type: WorkspaceType;
  #visibility: WorkspaceVisibility;
  #status: WorkspaceStatus;
  #settings: WorkspaceSettings;
  #branding: WorkspaceBranding;
  #preferences: WorkspacePreferences;
  readonly #features = new Map<string, WorkspaceFeature>();
  readonly #agentBindings = new Map<string, WorkspaceAgentBinding>();
  readonly #knowledgeBindings = new Map<string, WorkspaceKnowledgeBinding>();
  readonly #workflowBindings = new Map<string, WorkspaceWorkflowBinding>();
  #searchBinding?: WorkspaceSearchBinding;
  #notificationBinding?: WorkspaceNotificationBinding;
  readonly #createdAt: string;
  #updatedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: CreateWorkspaceInput, createdAt: string) {
    this.#id = WorkspaceIdFactory.create();
    this.#organizationId = input.organizationId;
    this.#slug = input.slug;
    this.#name = WorkspaceName.create(input.name);
    this.#type = input.type;
    this.#visibility = input.visibility ?? WorkspaceVisibility.private();
    this.#status = input.status ?? WorkspaceStatus.provisioning();
    this.#settings = WorkspaceSettings.create(this.#id, createdAt);
    this.#branding = WorkspaceBranding.create(this.#id, createdAt);
    this.#preferences = WorkspacePreferences.create(this.#id, createdAt);
    this.#createdAt = createdAt;
    this.#updatedAt = createdAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link Workspace} in `provisioning` status and records a
   * {@link workspaceCreatedEvent}.
   *
   * @param input   - creation data.
   * @param context - event context (actor, correlation id, organization id).
   * @param now     - ISO-8601 UTC creation time (defaults to now).
   */
  static create(
    input: CreateWorkspaceInput,
    context: WorkspaceEventContext,
    now = nowIso(),
  ): Workspace {
    const workspace = new Workspace(input, now);
    workspace.#events.push(
      workspaceCreatedEvent(context, workspace.#id, {
        workspaceId: workspace.#id,
        slug: workspace.#slug.value,
        name: workspace.#name.value,
        organizationId: workspace.#organizationId,
        type: workspace.#type.value,
        status: workspace.#status.value,
      }),
    );
    return workspace;
  }

  /** The workspace id. */
  get id(): WorkspaceId {
    return this.#id;
  }

  /** The owning organization (tenant) id — immutable (exactly one organization). */
  get organizationId(): TenantId {
    return this.#organizationId;
  }

  /** The slug, unique within the organization. */
  get slug(): WorkspaceSlug {
    return this.#slug;
  }

  /** The workspace name. */
  get name(): WorkspaceName {
    return this.#name;
  }

  /** The template type. */
  get type(): WorkspaceType {
    return this.#type;
  }

  /** The visibility scope. */
  get visibility(): WorkspaceVisibility {
    return this.#visibility;
  }

  /** The lifecycle status. */
  get status(): WorkspaceStatus {
    return this.#status;
  }

  /** The operational settings (owned child entity). */
  get settings(): WorkspaceSettings {
    return this.#settings;
  }

  /** The visual branding (owned child entity). */
  get branding(): WorkspaceBranding {
    return this.#branding;
  }

  /** The display preferences (owned child entity). */
  get preferences(): WorkspacePreferences {
    return this.#preferences;
  }

  /** The feature flags (owned child entities). */
  get features(): readonly WorkspaceFeature[] {
    return [...this.#features.values()];
  }

  /** The bound agent ids. */
  get boundAgentIds(): readonly string[] {
    return [...this.#agentBindings.keys()];
  }

  /** The attached knowledge source ids. */
  get boundKnowledgeIds(): readonly string[] {
    return [...this.#knowledgeBindings.keys()];
  }

  /** The attached workflow ids. */
  get boundWorkflowIds(): readonly string[] {
    return [...this.#workflowBindings.keys()];
  }

  /** The active search provider, when attached. */
  get searchProvider(): string | undefined {
    return this.#searchBinding?.provider;
  }

  /** The active notification provider, when attached. */
  get notificationProvider(): string | undefined {
    return this.#notificationBinding?.provider;
  }

  /** ISO-8601 UTC creation time. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** ISO-8601 UTC time of the last mutation. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /** Monotonic version for optimistic concurrency (EntityMeta). */
  get version(): number {
    return this.#version;
  }

  /** Whether the workspace is fully operational. */
  isActive(): boolean {
    return this.#status.isActive();
  }

  /** Whether the given feature is enabled. */
  isFeatureEnabled(name: string): boolean {
    return this.#features.get(name)?.enabled ?? false;
  }

  /** Whether the given agent is bound. */
  hasAgentBound(agentId: string): boolean {
    return this.#agentBindings.has(agentId);
  }

  /** Whether the given knowledge source is attached. */
  hasKnowledgeAttached(knowledgeId: string): boolean {
    return this.#knowledgeBindings.has(knowledgeId);
  }

  /** Whether the given workflow is attached. */
  hasWorkflowAttached(workflowId: string): boolean {
    return this.#workflowBindings.has(workflowId);
  }

  /**
   * Activates the workspace (`provisioning` → `active`) and records a
   * {@link workspaceActivatedEvent}.
   *
   * @throws {WorkspaceStateTransitionError} when the transition is not allowed.
   */
  activate(context: WorkspaceEventContext, now = nowIso()): void {
    this.#transitionTo(WorkspaceStatus.active(), 'activate', now);
    this.#events.push(workspaceActivatedEvent(context, this.#id));
  }

  /**
   * Suspends the workspace (`active` → `suspended`) and records a
   * {@link workspaceSuspendedEvent}. A suspended workspace cannot execute
   * workflows and cannot accept new members.
   *
   * @param reason - why the workspace is being suspended.
   * @throws {WorkspaceStateTransitionError} when the transition is not allowed.
   */
  suspend(reason: string, context: WorkspaceEventContext, now = nowIso()): void {
    this.#transitionTo(WorkspaceStatus.suspended(), 'suspend', now);
    this.#events.push(workspaceSuspendedEvent(context, this.#id, reason));
  }

  /**
   * Archives the workspace (`active`/`suspended` → `archived`) and records a
   * {@link workspaceArchivedEvent}. Archived is terminal in v1: the workspace
   * is immutable and retains data and audit (PSD.md WS-R5).
   *
   * @param reason - why the workspace is being archived.
   * @throws {WorkspaceStateTransitionError} when the transition is not allowed.
   */
  archive(reason: string, context: WorkspaceEventContext, now = nowIso()): void {
    this.#transitionTo(WorkspaceStatus.archived(), 'archive', now);
    this.#events.push(workspaceArchivedEvent(context, this.#id, reason));
  }

  /**
   * Applies a partial settings update and records a
   * {@link workspaceSettingsUpdatedEvent} with the changed keys. An empty
   * update is a no-op (no version bump, no event).
   *
   * @throws {InvalidWorkspaceValueError} when a value is invalid.
   */
  updateSettings(
    update: WorkspaceSettingsUpdate,
    context: WorkspaceEventContext,
    now = nowIso(),
  ): void {
    const changed = this.#settings.update(update, now);
    if (changed.length > 0) {
      this.#bump(now);
      this.#events.push(workspaceSettingsUpdatedEvent(context, this.#id, changed));
    }
  }

  /**
   * Applies a partial branding update and records a
   * {@link workspaceBrandingUpdatedEvent} with the changed keys.
   *
   * @throws {InvalidWorkspaceValueError} when a value is invalid.
   */
  updateBranding(
    update: WorkspaceBrandingUpdate,
    context: WorkspaceEventContext,
    now = nowIso(),
  ): void {
    const changed = this.#branding.update(update, now);
    if (changed.length > 0) {
      this.#bump(now);
      this.#events.push(workspaceBrandingUpdatedEvent(context, this.#id, changed));
    }
  }

  /**
   * Applies a partial preferences update. Silent in v1 (no event in the
   * catalog).
   *
   * @throws {InvalidWorkspaceValueError} when a value is invalid.
   */
  updatePreferences(update: WorkspacePreferencesUpdate, now = nowIso()): void {
    const changed = this.#preferences.update(update, now);
    if (changed.length > 0) {
      this.#bump(now);
    }
  }

  /**
   * Enables a feature flag, creating it when absent. Silent in v1.
   *
   * @param name - a lowercase dotted feature name.
   * @throws {InvalidWorkspaceValueError} when the feature name is invalid.
   */
  enableFeature(name: string, now = nowIso()): void {
    const existing = this.#features.get(name);
    if (existing === undefined) {
      this.#features.set(name, WorkspaceFeature.create(this.#id, name, true, now));
      this.#bump(now);
      return;
    }
    if (existing.enable(now)) {
      this.#bump(now);
    }
  }

  /**
   * Disables a feature flag. No-op when the feature does not exist.
   */
  disableFeature(name: string, now = nowIso()): void {
    const existing = this.#features.get(name);
    if (existing === undefined) {
      return;
    }
    if (existing.disable(now)) {
      this.#bump(now);
    }
  }

  /**
   * Binds an agent to the workspace and records an {@link agentBoundEvent}.
   *
   * @throws {AgentAlreadyBoundError} when the agent is already bound.
   */
  attachAgent(agentId: string, context: WorkspaceEventContext, now = nowIso()): void {
    if (this.#agentBindings.has(agentId)) {
      throw new AgentAlreadyBoundError({ workspaceId: this.#id, agentId });
    }
    const binding = WorkspaceAgentBinding.create(this.#id, agentId, now);
    this.#agentBindings.set(agentId, binding);
    this.#bump(now);
    this.#events.push(
      agentBoundEvent(context, { workspaceId: this.#id, bindingId: binding.id, agentId }),
    );
  }

  /**
   * Unbinds an agent from the workspace and records an {@link agentUnboundEvent}.
   *
   * @throws {AgentNotBoundError} when the agent is not bound.
   */
  detachAgent(agentId: string, context: WorkspaceEventContext, now = nowIso()): void {
    const binding = this.#agentBindings.get(agentId);
    if (binding === undefined) {
      throw new AgentNotBoundError({ workspaceId: this.#id, agentId });
    }
    this.#agentBindings.delete(agentId);
    this.#bump(now);
    this.#events.push(
      agentUnboundEvent(context, { workspaceId: this.#id, bindingId: binding.id, agentId }),
    );
  }

  /**
   * Attaches a knowledge source and records a {@link knowledgeAttachedEvent}.
   *
   * @throws {KnowledgeAlreadyAttachedError} when already attached.
   */
  attachKnowledge(knowledgeId: string, context: WorkspaceEventContext, now = nowIso()): void {
    if (this.#knowledgeBindings.has(knowledgeId)) {
      throw new KnowledgeAlreadyAttachedError({ workspaceId: this.#id, knowledgeId });
    }
    const binding = WorkspaceKnowledgeBinding.create(this.#id, knowledgeId, now);
    this.#knowledgeBindings.set(knowledgeId, binding);
    this.#bump(now);
    this.#events.push(
      knowledgeAttachedEvent(context, {
        workspaceId: this.#id,
        bindingId: binding.id,
        knowledgeId,
      }),
    );
  }

  /**
   * Detaches a knowledge source and records a {@link knowledgeDetachedEvent}.
   *
   * @throws {KnowledgeNotAttachedError} when not attached.
   */
  detachKnowledge(knowledgeId: string, context: WorkspaceEventContext, now = nowIso()): void {
    const binding = this.#knowledgeBindings.get(knowledgeId);
    if (binding === undefined) {
      throw new KnowledgeNotAttachedError({ workspaceId: this.#id, knowledgeId });
    }
    this.#knowledgeBindings.delete(knowledgeId);
    this.#bump(now);
    this.#events.push(
      knowledgeDetachedEvent(context, {
        workspaceId: this.#id,
        bindingId: binding.id,
        knowledgeId,
      }),
    );
  }

  /**
   * Attaches a workflow and records a {@link workflowAttachedEvent}.
   *
   * @throws {WorkflowAlreadyAttachedError} when already attached.
   */
  attachWorkflow(workflowId: string, context: WorkspaceEventContext, now = nowIso()): void {
    if (this.#workflowBindings.has(workflowId)) {
      throw new WorkflowAlreadyAttachedError({ workspaceId: this.#id, workflowId });
    }
    const binding = WorkspaceWorkflowBinding.create(this.#id, workflowId, now);
    this.#workflowBindings.set(workflowId, binding);
    this.#bump(now);
    this.#events.push(
      workflowAttachedEvent(context, { workspaceId: this.#id, bindingId: binding.id, workflowId }),
    );
  }

  /**
   * Detaches a workflow and records a {@link workflowDetachedEvent}.
   *
   * @throws {WorkflowNotAttachedError} when not attached.
   */
  detachWorkflow(workflowId: string, context: WorkspaceEventContext, now = nowIso()): void {
    const binding = this.#workflowBindings.get(workflowId);
    if (binding === undefined) {
      throw new WorkflowNotAttachedError({ workspaceId: this.#id, workflowId });
    }
    this.#workflowBindings.delete(workflowId);
    this.#bump(now);
    this.#events.push(
      workflowDetachedEvent(context, { workspaceId: this.#id, bindingId: binding.id, workflowId }),
    );
  }

  /**
   * Attaches the active search provider (single-slot: replaces the previous
   * provider) and records a {@link searchProviderAttachedEvent}. Attaching
   * the same provider is a no-op.
   *
   * @returns true when the provider changed.
   */
  attachSearchProvider(provider: string, context: WorkspaceEventContext, now = nowIso()): boolean {
    if (this.#searchBinding?.provider === provider) {
      return false;
    }
    const binding = WorkspaceSearchBinding.create(this.#id, provider, now);
    this.#searchBinding = binding;
    this.#bump(now);
    this.#events.push(
      searchProviderAttachedEvent(context, {
        workspaceId: this.#id,
        bindingId: binding.id,
        provider,
      }),
    );
    return true;
  }

  /**
   * Attaches the active notification provider (single-slot: replaces the
   * previous provider) and records a
   * {@link notificationProviderAttachedEvent}. Attaching the same provider is
   * a no-op.
   *
   * @returns true when the provider changed.
   */
  attachNotificationProvider(
    provider: string,
    context: WorkspaceEventContext,
    now = nowIso(),
  ): boolean {
    if (this.#notificationBinding?.provider === provider) {
      return false;
    }
    const binding = WorkspaceNotificationBinding.create(this.#id, provider, now);
    this.#notificationBinding = binding;
    this.#bump(now);
    this.#events.push(
      notificationProviderAttachedEvent(context, {
        workspaceId: this.#id,
        bindingId: binding.id,
        provider,
      }),
    );
    return true;
  }

  /**
   * Produces a persistence snapshot of the workspace (PERSISTENCE.md §4
   * aggregate ownership).
   */
  static snapshot(workspace: Workspace): WorkspaceSnapshot {
    return {
      id: workspace.id,
      organizationId: workspace.organizationId,
      slug: workspace.slug,
      name: workspace.name.value,
      type: workspace.type,
      visibility: workspace.visibility.value,
      status: workspace.status.value,
      settings: {
        defaultLocale: workspace.settings.defaultLocale.value,
        defaultTimezone: workspace.settings.defaultTimezone.value,
        aiEnabled: workspace.settings.aiEnabled,
        guestAccessEnabled: workspace.settings.guestAccessEnabled,
        updatedAt: workspace.settings.updatedAt,
      },
      branding: {
        color: workspace.branding.color.value,
        icon: workspace.branding.icon.value,
        updatedAt: workspace.branding.updatedAt,
      },
      preferences: {
        theme: workspace.preferences.theme,
        density: workspace.preferences.density,
        updatedAt: workspace.preferences.updatedAt,
      },
      features: [...workspace.#features.values()].map((feature) => ({
        name: feature.name,
        enabled: feature.enabled,
        createdAt: feature.createdAt,
        updatedAt: feature.updatedAt,
      })),
      agentBindings: [...workspace.#agentBindings.values()].map((binding) => ({
        agentId: binding.agentId,
        boundAt: binding.boundAt,
      })),
      knowledgeBindings: [...workspace.#knowledgeBindings.values()].map((binding) => ({
        knowledgeId: binding.knowledgeId,
        boundAt: binding.boundAt,
      })),
      workflowBindings: [...workspace.#workflowBindings.values()].map((binding) => ({
        workflowId: binding.workflowId,
        boundAt: binding.boundAt,
      })),
      searchBinding: workspace.#searchBinding
        ? { provider: workspace.#searchBinding.provider, boundAt: workspace.#searchBinding.boundAt }
        : undefined,
      notificationBinding: workspace.#notificationBinding
        ? {
            provider: workspace.#notificationBinding.provider,
            boundAt: workspace.#notificationBinding.boundAt,
          }
        : undefined,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      version: workspace.version,
    };
  }

  /**
   * Reconstructs a {@link Workspace} from a persistence snapshot without
   * emitting domain events (DDD reconstitution factory). Reuses the id from
   * the snapshot; children are rebuilt through their public factories so
   * values are validated at load. Feature `updatedAt` is reconstructed as the
   * feature's `createdAt` (silent toggle timestamps are not preserved —
   * documented fidelity limit).
   */
  static hydrate(snapshot: WorkspaceSnapshot): Workspace {
    const workspace = new Workspace(
      {
        organizationId: snapshot.organizationId,
        slug: snapshot.slug,
        name: snapshot.name,
        type: snapshot.type,
        visibility: WorkspaceVisibility.from(snapshot.visibility),
        status: WorkspaceStatus.from(snapshot.status),
      },
      snapshot.createdAt,
    );
    workspace.#id = snapshot.id;

    const settings = WorkspaceSettings.create(workspace.#id, snapshot.settings.updatedAt);
    settings.update(
      {
        defaultLocale: snapshot.settings.defaultLocale,
        defaultTimezone: snapshot.settings.defaultTimezone,
        aiEnabled: snapshot.settings.aiEnabled,
        guestAccessEnabled: snapshot.settings.guestAccessEnabled,
      },
      snapshot.settings.updatedAt,
    );
    workspace.#settings = settings;

    const branding = WorkspaceBranding.create(workspace.#id, snapshot.branding.updatedAt);
    branding.update(
      { color: snapshot.branding.color, icon: snapshot.branding.icon },
      snapshot.branding.updatedAt,
    );
    workspace.#branding = branding;

    const preferences = WorkspacePreferences.create(workspace.#id, snapshot.preferences.updatedAt);
    preferences.update(
      {
        theme: snapshot.preferences.theme as WorkspacePreferencesUpdate['theme'],
        density: snapshot.preferences.density as WorkspacePreferencesUpdate['density'],
      },
      snapshot.preferences.updatedAt,
    );
    workspace.#preferences = preferences;

    for (const feature of snapshot.features) {
      workspace.#features.set(
        feature.name,
        WorkspaceFeature.create(workspace.#id, feature.name, feature.enabled, feature.createdAt),
      );
    }
    for (const binding of snapshot.agentBindings) {
      workspace.#agentBindings.set(
        binding.agentId,
        WorkspaceAgentBinding.create(workspace.#id, binding.agentId, binding.boundAt),
      );
    }
    for (const binding of snapshot.knowledgeBindings) {
      workspace.#knowledgeBindings.set(
        binding.knowledgeId,
        WorkspaceKnowledgeBinding.create(workspace.#id, binding.knowledgeId, binding.boundAt),
      );
    }
    for (const binding of snapshot.workflowBindings) {
      workspace.#workflowBindings.set(
        binding.workflowId,
        WorkspaceWorkflowBinding.create(workspace.#id, binding.workflowId, binding.boundAt),
      );
    }
    if (snapshot.searchBinding) {
      workspace.#searchBinding = WorkspaceSearchBinding.create(
        workspace.#id,
        snapshot.searchBinding.provider,
        snapshot.searchBinding.boundAt,
      );
    }
    if (snapshot.notificationBinding) {
      workspace.#notificationBinding = WorkspaceNotificationBinding.create(
        workspace.#id,
        snapshot.notificationBinding.provider,
        snapshot.notificationBinding.boundAt,
      );
    }

    workspace.#updatedAt = snapshot.updatedAt;
    workspace.#version = snapshot.version;
    return workspace;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }

  /** Enforces the workspace lifecycle transition table. */
  #transitionTo(target: WorkspaceStatus, action: string, now: string): void {
    const allowed = WORKSPACE_TRANSITIONS[this.#status.value];
    if (!allowed.includes(target.value)) {
      throw new WorkspaceStateTransitionError(
        `Cannot ${action} a workspace in status ${this.#status.value}`,
        { workspaceId: this.#id, from: this.#status.value, to: target.value },
      );
    }
    this.#status = target;
    this.#bump(now);
  }

  /** Bumps the version and updated-at timestamp (optimistic concurrency). */
  #bump(now = nowIso()): void {
    this.#version += 1;
    this.#updatedAt = now;
  }
}
