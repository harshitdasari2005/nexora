/**
 * @nexora/domain-workspaces — WorkspaceDomainService.
 *
 * Orchestrates the {@link Workspace} aggregate lifecycle (DOMAIN_MODEL.md §1,
 * §7): creation, activation, suspension, archival, settings/branding/
 * preferences updates, feature toggles, and the agent/knowledge/workflow/
 * search/notification bindings. Owns the use-case workflows that span the
 * aggregate and its repository; the aggregate enforces its own invariants.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import { ok, err } from '@nexora/shared/result';
import type { TenantId } from '@nexora/contracts/common';

import type { WorkspaceEventContext } from '../events/index.js';
import { Workspace } from '../entities/workspace.js';
import type { WorkspaceBrandingUpdate } from '../entities/workspace-branding.js';
import type { WorkspacePreferencesUpdate } from '../entities/workspace-preferences.js';
import type { WorkspaceSettingsUpdate } from '../entities/workspace-settings.js';
import type {
  InvalidWorkspaceValueError,
  SlugAlreadyExistsError,
  WorkspaceArchivedError,
  WorkspaceStateTransitionError,
} from '../errors/index.js';
import { toWorkspaceError, WorkspaceNotFoundError } from '../errors/index.js';
import type { WorkspaceRepository } from '../repositories/index.js';
import {
  SlugUniquenessPolicy,
  WorkspaceArchivalPolicy,
  WorkspaceBindingPolicy,
  WorkspaceLifecyclePolicy,
} from '../policies/index.js';
import type { WorkspaceId } from '../value-objects/workspace-id.js';
import { WorkspaceSlug } from '../value-objects/workspace-slug.js';
import { WorkspaceStatus } from '../value-objects/workspace-status.js';
import { WorkspaceType } from '../value-objects/workspace-type.js';
import { WorkspaceVisibility } from '../value-objects/workspace-visibility.js';

/** Input for creating a workspace. */
export interface CreateWorkspaceCommand {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The slug, unique within the organization. */
  slug: string;
  /** The workspace name. */
  name: string;
  /** The template type (one of `WORKSPACE_TYPES`). */
  type: string;
  /** The visibility scope (defaults to `private`). */
  visibility?: string;
  /** Optional initial status (defaults to `provisioning`). */
  status?: string;
}

/** The outcome of a workspace command: the aggregate plus emitted events. */
export interface WorkspaceCommandResult {
  /** The mutated aggregate. */
  workspace: Workspace;
  /** Domain events emitted by the operation (publish via the event bus). */
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link WorkspaceDomainService}. */
export interface WorkspaceDomainServiceDependencies {
  /** Workspace persistence. */
  workspaces: WorkspaceRepository;
  /** Lifecycle policy (status transitions, execution eligibility). */
  lifecycle?: WorkspaceLifecyclePolicy;
  /** Archival policy (archival + mutation gating). */
  archival?: WorkspaceArchivalPolicy;
  /** Binding policy (attach/detach gating). */
  binding?: WorkspaceBindingPolicy;
  /** Slug uniqueness policy (per-organization domain contract). */
  slugPolicy?: SlugUniquenessPolicy;
}

/**
 * The workspace lifecycle use-case service. All methods return a `Result` so
 * expected failures are explicit values, not exceptions.
 */
export class WorkspaceDomainService {
  readonly #workspaces: WorkspaceRepository;
  readonly #lifecycle: WorkspaceLifecyclePolicy;
  readonly #archival: WorkspaceArchivalPolicy;
  readonly #binding: WorkspaceBindingPolicy;
  readonly #slugPolicy: SlugUniquenessPolicy;

  constructor(dependencies: WorkspaceDomainServiceDependencies) {
    this.#workspaces = dependencies.workspaces;
    this.#lifecycle = dependencies.lifecycle ?? new WorkspaceLifecyclePolicy();
    this.#archival = dependencies.archival ?? new WorkspaceArchivalPolicy();
    this.#binding = dependencies.binding ?? new WorkspaceBindingPolicy();
    this.#slugPolicy = dependencies.slugPolicy ?? new SlugUniquenessPolicy();
  }

  /**
   * Creates a workspace: validates the input, checks slug uniqueness within
   * the organization, creates the aggregate in `provisioning`, and persists
   * it.
   */
  async create(
    input: CreateWorkspaceCommand,
    context: WorkspaceEventContext,
  ): Promise<Result<WorkspaceCommandResult, InvalidWorkspaceValueError | SlugAlreadyExistsError>> {
    try {
      const slug = WorkspaceSlug.create(input.slug);
      this.#slugPolicy.assertSlugAvailable(
        await this.#workspaces.existsBySlug(input.organizationId, slug),
      );
      const workspace = Workspace.create(
        {
          organizationId: input.organizationId,
          slug,
          name: input.name,
          type: WorkspaceType.from(input.type),
          visibility:
            input.visibility === undefined ? undefined : WorkspaceVisibility.from(input.visibility),
          status: input.status === undefined ? undefined : WorkspaceStatus.from(input.status),
        },
        context,
      );
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(toWorkspaceError(error) as InvalidWorkspaceValueError | SlugAlreadyExistsError);
    }
  }

  /** Activates a workspace (`provisioning` → `active`). */
  async activate(
    workspaceId: WorkspaceId,
    context: WorkspaceEventContext,
  ): Promise<
    Result<WorkspaceCommandResult, WorkspaceNotFoundError | WorkspaceStateTransitionError>
  > {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#lifecycle.assertCanTransition(workspace.status, WorkspaceStatus.active());
      workspace.activate(context);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(toWorkspaceError(error) as WorkspaceNotFoundError | WorkspaceStateTransitionError);
    }
  }

  /** Suspends a workspace (`active` → `suspended`). */
  async suspend(
    workspaceId: WorkspaceId,
    reason: string,
    context: WorkspaceEventContext,
  ): Promise<
    Result<WorkspaceCommandResult, WorkspaceNotFoundError | WorkspaceStateTransitionError>
  > {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#lifecycle.assertCanTransition(workspace.status, WorkspaceStatus.suspended());
      workspace.suspend(reason, context);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(toWorkspaceError(error) as WorkspaceNotFoundError | WorkspaceStateTransitionError);
    }
  }

  /**
   * Archives a workspace (`active`/`suspended` → `archived`). Archived is
   * terminal in v1: the workspace is immutable, data and audit are retained
   * (PSD.md WS-R5; the active-workflow/finalized-approval check of BR-3 is a
   * cross-domain concern enforced by the workflow/approval contexts at the
   * application layer — docs/BUSINESS_RULES.md).
   */
  async archive(
    workspaceId: WorkspaceId,
    reason: string,
    context: WorkspaceEventContext,
  ): Promise<
    Result<WorkspaceCommandResult, WorkspaceNotFoundError | WorkspaceStateTransitionError>
  > {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#archival.assertCanArchive(workspace.status);
      workspace.archive(reason, context);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(toWorkspaceError(error) as WorkspaceNotFoundError | WorkspaceStateTransitionError);
    }
  }

  /** Updates workspace settings and emits `workspace.settings_updated`. */
  async updateSettings(
    workspaceId: WorkspaceId,
    update: WorkspaceSettingsUpdate,
    context: WorkspaceEventContext,
  ): Promise<
    Result<
      WorkspaceCommandResult,
      WorkspaceNotFoundError | WorkspaceArchivedError | InvalidWorkspaceValueError
    >
  > {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#archival.assertCanMutate(workspace.status);
      workspace.updateSettings(update, context);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(
        toWorkspaceError(error) as
          WorkspaceNotFoundError | WorkspaceArchivedError | InvalidWorkspaceValueError,
      );
    }
  }

  /** Updates workspace branding and emits `workspace.branding_updated`. */
  async updateBranding(
    workspaceId: WorkspaceId,
    update: WorkspaceBrandingUpdate,
    context: WorkspaceEventContext,
  ): Promise<
    Result<
      WorkspaceCommandResult,
      WorkspaceNotFoundError | WorkspaceArchivedError | InvalidWorkspaceValueError
    >
  > {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#archival.assertCanMutate(workspace.status);
      workspace.updateBranding(update, context);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(
        toWorkspaceError(error) as
          WorkspaceNotFoundError | WorkspaceArchivedError | InvalidWorkspaceValueError,
      );
    }
  }

  /** Updates workspace preferences (silent in v1 — no event). */
  async updatePreferences(
    workspaceId: WorkspaceId,
    update: WorkspacePreferencesUpdate,
  ): Promise<
    Result<
      WorkspaceCommandResult,
      WorkspaceNotFoundError | WorkspaceArchivedError | InvalidWorkspaceValueError
    >
  > {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#archival.assertCanMutate(workspace.status);
      workspace.updatePreferences(update);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(
        toWorkspaceError(error) as
          WorkspaceNotFoundError | WorkspaceArchivedError | InvalidWorkspaceValueError,
      );
    }
  }

  /** Enables a feature flag (silent in v1). */
  async enableFeature(
    workspaceId: WorkspaceId,
    featureName: string,
  ): Promise<Result<WorkspaceCommandResult, WorkspaceNotFoundError | WorkspaceArchivedError>> {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#archival.assertCanMutate(workspace.status);
      workspace.enableFeature(featureName);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(toWorkspaceError(error) as WorkspaceNotFoundError | WorkspaceArchivedError);
    }
  }

  /** Disables a feature flag (silent in v1). */
  async disableFeature(
    workspaceId: WorkspaceId,
    featureName: string,
  ): Promise<Result<WorkspaceCommandResult, WorkspaceNotFoundError | WorkspaceArchivedError>> {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#archival.assertCanMutate(workspace.status);
      workspace.disableFeature(featureName);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(toWorkspaceError(error) as WorkspaceNotFoundError | WorkspaceArchivedError);
    }
  }

  /** Binds an agent to the workspace (workspace.agent_bound). */
  async attachAgent(
    workspaceId: WorkspaceId,
    agentId: string,
    context: WorkspaceEventContext,
  ): Promise<Result<WorkspaceCommandResult, WorkspaceNotFoundError | WorkspaceArchivedError>> {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#binding.assertCanChangeBindings(workspace.status);
      workspace.attachAgent(agentId, context);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(toWorkspaceError(error) as WorkspaceNotFoundError | WorkspaceArchivedError);
    }
  }

  /** Unbinds an agent from the workspace (workspace.agent_unbound). */
  async detachAgent(
    workspaceId: WorkspaceId,
    agentId: string,
    context: WorkspaceEventContext,
  ): Promise<Result<WorkspaceCommandResult, WorkspaceNotFoundError | WorkspaceArchivedError>> {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#binding.assertCanChangeBindings(workspace.status);
      workspace.detachAgent(agentId, context);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(toWorkspaceError(error) as WorkspaceNotFoundError | WorkspaceArchivedError);
    }
  }

  /** Attaches a knowledge source (workspace.knowledge_attached). */
  async attachKnowledge(
    workspaceId: WorkspaceId,
    knowledgeId: string,
    context: WorkspaceEventContext,
  ): Promise<Result<WorkspaceCommandResult, WorkspaceNotFoundError | WorkspaceArchivedError>> {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#binding.assertCanChangeBindings(workspace.status);
      workspace.attachKnowledge(knowledgeId, context);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(toWorkspaceError(error) as WorkspaceNotFoundError | WorkspaceArchivedError);
    }
  }

  /** Detaches a knowledge source (workspace.knowledge_detached). */
  async detachKnowledge(
    workspaceId: WorkspaceId,
    knowledgeId: string,
    context: WorkspaceEventContext,
  ): Promise<Result<WorkspaceCommandResult, WorkspaceNotFoundError | WorkspaceArchivedError>> {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#binding.assertCanChangeBindings(workspace.status);
      workspace.detachKnowledge(knowledgeId, context);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(toWorkspaceError(error) as WorkspaceNotFoundError | WorkspaceArchivedError);
    }
  }

  /** Attaches a workflow (workspace.workflow_attached). */
  async attachWorkflow(
    workspaceId: WorkspaceId,
    workflowId: string,
    context: WorkspaceEventContext,
  ): Promise<Result<WorkspaceCommandResult, WorkspaceNotFoundError | WorkspaceArchivedError>> {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#binding.assertCanChangeBindings(workspace.status);
      workspace.attachWorkflow(workflowId, context);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(toWorkspaceError(error) as WorkspaceNotFoundError | WorkspaceArchivedError);
    }
  }

  /** Detaches a workflow (workspace.workflow_detached). */
  async detachWorkflow(
    workspaceId: WorkspaceId,
    workflowId: string,
    context: WorkspaceEventContext,
  ): Promise<Result<WorkspaceCommandResult, WorkspaceNotFoundError | WorkspaceArchivedError>> {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#binding.assertCanChangeBindings(workspace.status);
      workspace.detachWorkflow(workflowId, context);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(toWorkspaceError(error) as WorkspaceNotFoundError | WorkspaceArchivedError);
    }
  }

  /**
   * Attaches the active search provider (workspace.search_provider_attached).
   * The provider slot is single-valued: attaching the same provider again is
   * a no-op and returns `ok` with no events.
   */
  async attachSearchProvider(
    workspaceId: WorkspaceId,
    provider: string,
    context: WorkspaceEventContext,
  ): Promise<Result<WorkspaceCommandResult, WorkspaceNotFoundError | WorkspaceArchivedError>> {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#binding.assertCanChangeBindings(workspace.status);
      workspace.attachSearchProvider(provider, context);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(toWorkspaceError(error) as WorkspaceNotFoundError | WorkspaceArchivedError);
    }
  }

  /**
   * Attaches the active notification provider
   * (workspace.notification_provider_attached). The provider slot is
   * single-valued: attaching the same provider again is a no-op and returns
   * `ok` with no events.
   */
  async attachNotificationProvider(
    workspaceId: WorkspaceId,
    provider: string,
    context: WorkspaceEventContext,
  ): Promise<Result<WorkspaceCommandResult, WorkspaceNotFoundError | WorkspaceArchivedError>> {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#binding.assertCanChangeBindings(workspace.status);
      workspace.attachNotificationProvider(provider, context);
      await this.#workspaces.save(workspace);
      return ok({ workspace, events: workspace.pullDomainEvents() });
    } catch (error) {
      return err(toWorkspaceError(error) as WorkspaceNotFoundError | WorkspaceArchivedError);
    }
  }

  /** Finds a workspace by id, or returns a {@link WorkspaceNotFoundError}. */
  async findById(workspaceId: WorkspaceId): Promise<Result<Workspace, WorkspaceNotFoundError>> {
    const workspace = await this.#workspaces.findById(workspaceId);
    if (workspace === undefined) {
      return err(new WorkspaceNotFoundError({ workspaceId }));
    }
    return ok(workspace);
  }

  /** Finds a workspace by slug within an organization. */
  async findBySlug(
    organizationId: TenantId,
    slug: string,
  ): Promise<Result<Workspace, WorkspaceNotFoundError | InvalidWorkspaceValueError>> {
    try {
      const workspace = await this.#workspaces.findBySlug(
        organizationId,
        WorkspaceSlug.create(slug),
      );
      if (workspace === undefined) {
        return err(new WorkspaceNotFoundError({ organizationId, slug }));
      }
      return ok(workspace);
    } catch (error) {
      return err(toWorkspaceError(error) as WorkspaceNotFoundError | InvalidWorkspaceValueError);
    }
  }

  /** Lists the workspaces of an organization. */
  async listByOrganization(organizationId: TenantId): Promise<Result<readonly Workspace[], never>> {
    return ok(await this.#workspaces.listByOrganization(organizationId));
  }

  /**
   * Batched workspace lookup by ids (single query — avoids N+1 on
   * membership-driven read paths). Missing ids are simply absent from the
   * result.
   */
  async listByIds(ids: readonly WorkspaceId[]): Promise<Result<readonly Workspace[], never>> {
    if (ids.length === 0) {
      return ok([]);
    }
    return ok(await this.#workspaces.listByIds(ids));
  }

  /** Loads a workspace or throws {@link WorkspaceNotFoundError}. */
  async #requireWorkspace(workspaceId: WorkspaceId): Promise<Workspace> {
    const workspace = await this.#workspaces.findById(workspaceId);
    if (workspace === undefined) {
      throw new WorkspaceNotFoundError({ workspaceId });
    }
    return workspace;
  }
}
