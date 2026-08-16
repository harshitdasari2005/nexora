/**
 * @nexora/app-api — business-agent proposal provider (S26 Phase 8).
 *
 * The {@link AgentProposalProvider} implementation: derives governed
 * {@link ActionProposal}s from REAL persisted Nexora data through the
 * EXISTING application handlers (measurements, notifications, activity,
 * projects) — never fabricated business state. Every proposal references a
 * real entity (or a real aggregate signal), names the target system and the
 * capability required to act on it, and carries the deterministic approval
 * requirement derived from the capability's write/read classification.
 *
 * Proposals are READ/UNDERSTAND proposals AND grounded governed-write
 * proposals: the agent proposes what to look at or what to do; EXECUTION of
 * a proposal continues through the existing AI Runtime → ToolExecutor →
 * ApprovalEngine path (this module never executes anything). A write
 * proposal is only produced when the agent has the write capability in its
 * registered set AND the trusted workspace scope exists — and it stays
 * gated by the existing approval engine at execution.
 *
 * Security: every handler is called with the TRUSTED context resolved by
 * the route (tenant from authenticated membership, workspace verified
 * against membership). A forged scope can never widen a query. Handlers
 * that fail produce no proposals (fail safe, no internals leaked).
 */

import type {
  ActionProposal,
  AgentTargetSystem,
  BusinessAgentDefinition,
} from '@nexora/contracts/agent';
import type { AgentProposalProvider, BusinessAgentContext } from '@nexora/module-agents';
import type { GetTenantMeasurementsHandler } from '@nexora/module-measurements';
import type { ListProjectsHandler } from '@nexora/application-projects';
import type { ListActivityHandler, ListNotificationsHandler } from '@nexora/module-notifications';

/** Dependencies of the proposal provider (existing handlers only). */
export interface AgentProposalProviderDependencies {
  /** The tenant measurement snapshot (workflow health + overview signals). */
  getTenantMeasurements: GetTenantMeasurementsHandler;
  /** Tenant-scoped project listing. */
  listProjects: ListProjectsHandler;
  /** Tenant/workspace-scoped activity feed. */
  listActivity: ListActivityHandler;
  /** Recipient-scoped notification inbox. */
  listNotifications: ListNotificationsHandler;
}

/** The maximum number of items considered per proposal source. */
const SIGNAL_LIMIT = 8;

/** Maps a capability id to the target system it acts on (WHERE). */
export function targetSystemFor(capabilityId: string): AgentTargetSystem {
  if (capabilityId.startsWith('github.')) {
    return 'github';
  }
  if (capabilityId.startsWith('slack.')) {
    return 'slack';
  }
  if (capabilityId.startsWith('calendar.')) {
    return 'calendar';
  }
  if (capabilityId.startsWith('email.')) {
    return 'email';
  }
  return 'nexora';
}

/** The agent goal that focuses on a capability, when one exists (proposal → goal linkage). */
function goalIdFor(agent: BusinessAgentDefinition, capabilityId: string): string | undefined {
  return agent.goals.find((goal) => goal.capabilityIds.includes(capabilityId))?.id;
}

/** Implements the module proposal-provider port over existing handlers. */
export class ApiAgentProposalProvider implements AgentProposalProvider {
  readonly #deps: AgentProposalProviderDependencies;

  constructor(dependencies: AgentProposalProviderDependencies) {
    this.#deps = dependencies;
  }

  /**
   * Produces governed proposals for an agent under the trusted context.
   * Sources that fail resolve to nothing (fail safe). The proposal set is
   * deterministic: real data → proposal, in a stable order.
   */
  async propose(
    context: BusinessAgentContext,
    agent: BusinessAgentDefinition,
  ): Promise<readonly ActionProposal[]> {
    const proposals: ActionProposal[] = [];

    const [measurements, activity, notifications, projects] = await Promise.all([
      this.#safe(() =>
        this.#deps.getTenantMeasurements.handle({ tenantId: context.tenantId as never }),
      ),
      this.#safe(async () => {
        const result = await this.#deps.listActivity.handle({
          tenantId: context.tenantId as never,
          ...(context.workspaceId === undefined
            ? {}
            : { workspaceId: context.workspaceId as never }),
          limit: SIGNAL_LIMIT,
        });
        return result.ok ? result.value.activity : [];
      }),
      this.#safe(async () => {
        const result = await this.#deps.listNotifications.handle({
          userId: context.userId as never,
          tenantId: context.tenantId as never,
          ...(context.workspaceId === undefined
            ? {}
            : { workspaceId: context.workspaceId as never }),
          limit: SIGNAL_LIMIT,
        });
        return result.ok ? result.value.notifications : [];
      }),
      this.#safe(async () => {
        const result = await this.#deps.listProjects.handle({
          organizationId: context.tenantId as never,
        });
        return result.ok ? result.value : [];
      }),
    ]);

    const failingWorkflows = (measurements?.workflowHealth ?? []).filter(
      (metric) => metric.failed > 0,
    );

    // 1. Attention / notification signals (what needs the user's attention).
    const attentionCount = notifications?.filter((n) => n.status === 'unread').length ?? 0;
    if (attentionCount > 0) {
      proposals.push({
        id: 'propose_review_attention',
        action: 'Review what needs attention',
        reason: `${attentionCount} unread notification${attentionCount === 1 ? '' : 's'} require your attention.`,
        affectedEntity: { type: 'notification', id: 'inbox', title: 'Notification inbox' },
        targetSystem: 'nexora',
        requiredCapability: 'notifications.what_needs_attention',
        requiresApproval: false,
        expectedResult: 'A prioritized list of the real notifications that need your attention.',
        goalId: goalIdFor(agent, 'notifications.what_needs_attention'),
      });
    }

    // 2. Activity signals (recent work in the workspace).
    const recentActivity = activity?.slice(0, 3) ?? [];
    if (recentActivity.length > 0) {
      const latest = recentActivity[0];
      if (latest !== undefined) {
        proposals.push({
          id: 'propose_review_activity',
          action: 'Review recent activity',
          reason: `${recentActivity.length} recent activity item${recentActivity.length === 1 ? '' : 's'} in this workspace, including "${latest.title}".`,
          affectedEntity: {
            type: 'activity',
            id: latest.id,
            title: latest.title,
          },
          targetSystem: 'nexora',
          requiredCapability: 'notifications.what_needs_attention',
          requiresApproval: false,
          expectedResult: 'A readable summary of the latest persisted activity.',
          goalId: goalIdFor(agent, 'notifications.what_needs_attention'),
        });
      }
    }

    // 3. Workflow health signals (workflows that failed — real persisted state).
    if (failingWorkflows.length > 0) {
      const worst = [...failingWorkflows].sort((a, b) => b.failed - a.failed)[0];
      if (worst !== undefined) {
        proposals.push({
          id: 'propose_inspect_workflow_health',
          action: 'Inspect workflow health',
          reason: `${worst.definitionKey} has ${worst.failed} failed run${worst.failed === 1 ? '' : 's'} (${worst.unrecoverableErrorRate}% unrecoverable error rate).`,
          affectedEntity: {
            type: 'workflow',
            id: worst.definitionKey,
            title: worst.definitionKey,
          },
          targetSystem: 'nexora',
          requiredCapability: 'notifications.what_needs_attention',
          requiresApproval: false,
          expectedResult: 'An explainable summary of the failing workflow and its real error rate.',
          goalId: goalIdFor(agent, 'notifications.what_needs_attention'),
        });
      }
    }

    // 4. Project signals (active projects in the tenant).
    const activeProjects = projects?.slice(0, 3) ?? [];
    if (activeProjects.length > 0 && agent.capabilityIds.includes('projects.find_project')) {
      const first = activeProjects[0];
      if (first !== undefined) {
        proposals.push({
          id: 'propose_review_projects',
          // The action names the REAL first project so the existing
          // deterministic parameter extractor can bind it at execution
          // ("Review the <name> project").
          action: `Review the ${first.name} project`,
          reason: `${activeProjects.length} project${activeProjects.length === 1 ? '' : 's'} exist in this organization (first: "${first.name}").`,
          affectedEntity: { type: 'project', id: first.id, title: first.name },
          targetSystem: 'nexora',
          requiredCapability: 'projects.find_project',
          requiresApproval: false,
          expectedResult: 'A real, data-backed overview of the organization’s projects.',
          goalId: goalIdFor(agent, 'projects.find_project'),
        });
      }
    }

    // 5. Governed write (calendar review): failing workflows → propose a
    //    real workspace calendar event to review them. Only when the agent
    //    has the write capability in its registered set AND a verified
    //    workspace scope exists (calendar events are workspace-scoped). The
    //    utterance is phrased for the existing deterministic parameter
    //    extractor (title + relative day + time), and execution stays gated
    //    by the existing approval engine (consequential side effect).
    if (
      failingWorkflows.length > 0 &&
      context.workspaceId !== undefined &&
      agent.capabilityIds.includes('calendar.create_event')
    ) {
      const worst = [...failingWorkflows].sort((a, b) => b.failed - a.failed)[0];
      if (worst !== undefined) {
        proposals.push({
          id: 'propose_schedule_workflow_review',
          // The action is phrased for the EXISTING deterministic calendar
          // parameter extractor (capability tokens + "called <title> …
          // tomorrow at <time>") so the write is executable end-to-end
          // through the runtime — approval still gates it.
          action: 'Schedule a calendar event called Workflow health review tomorrow at 9 AM',
          reason: `${worst.definitionKey} has ${worst.failed} failed run${worst.failed === 1 ? '' : 's'} (${worst.unrecoverableErrorRate}% unrecoverable error rate); a review block will focus on the failure.`,
          affectedEntity: {
            type: 'workflow',
            id: worst.definitionKey,
            title: worst.definitionKey,
          },
          targetSystem: 'calendar',
          requiredCapability: 'calendar.create_event',
          requiresApproval: true,
          expectedResult:
            'A calendar event to review the failing workflow (executes only after approval).',
          goalId: goalIdFor(agent, 'calendar.create_event'),
        });
      }
    }

    return proposals;
  }

  /** Runs a source handler; failures resolve to `undefined` (fail safe). */
  async #safe<T>(run: () => Promise<T>): Promise<T | undefined> {
    try {
      return await run();
    } catch {
      return undefined;
    }
  }
}
