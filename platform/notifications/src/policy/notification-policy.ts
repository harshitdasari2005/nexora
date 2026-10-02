/**
 * @nexora/module-notifications — deterministic notification policy.
 *
 * The ONLY place that decides "who gets a notification and why". The policy
 * maps canonical business events (project.created, employee.created,
 * workflow.*, document.*, knowledge.indexed) to recipient-scoped
 * notification specs and workspace-scoped activity specs.
 *
 * Determinism and security contract:
 * - The recipient is ALWAYS the event actor when the actor is a user — a
 *   server-derived value from the trusted event envelope. A recipient can
 *   never be chosen by the AI, by a client, or from a payload field. If the
 *   actor is an agent or system (no human recipient), no notification is
 *   produced.
 * - The LLM is never the notification authority: this policy is pure,
 *   deterministic code that runs before any notification exists.
 * - Titles/bodies are built from trusted payload fields (names, types)
 *   only; raw payload blobs are never surfaced.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { NotificationPriority } from '@nexora/contracts/notification';

import { type NotificationAction, type NotificationCategory } from '../domain/notification.js';

/** A recipient-scoped notification the policy wants created. */
export interface NotificationSpec {
  /** The recipient user (the trusted event actor). */
  recipientId: string;
  /** The workspace scope, when the event is workspace-scoped. */
  workspaceId?: string;
  /** The source event type. */
  type: string;
  /** The notification category. */
  category: NotificationCategory;
  /** The human-readable title. */
  title: string;
  /** The human-readable body. */
  body: string;
  /** The notification priority. */
  priority: NotificationPriority;
  /** An optional actionable link. */
  action?: NotificationAction;
}

/** A workspace-scoped activity feed entry the policy wants recorded. */
export interface ActivitySpec {
  /** The workspace scope, when the event is workspace-scoped. */
  workspaceId?: string;
  /** The source event type. */
  type: string;
  /** The user-facing activity title. */
  title: string;
  /** The user-facing activity body. */
  body: string;
  /** The acting user, when a user caused the event. */
  actorId?: string;
}

/** The full policy outcome for one event. */
export interface PolicyOutcome {
  /** Recipient-scoped notifications. */
  notifications: readonly NotificationSpec[];
  /** Workspace-scoped activity feed entries. */
  activity: readonly ActivitySpec[];
}

/** A payload accessor for the loosely-typed event payload. */
type Payload = Record<string, unknown>;

/** Reads a safe string field from a payload (never throws). */
function readString(payload: unknown, key: string): string | undefined {
  if (payload === null || typeof payload !== 'object') {
    return undefined;
  }
  const value = (payload as Payload)[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(payload: unknown, key: string): number | undefined {
  if (payload === null || typeof payload !== 'object') {
    return undefined;
  }
  const value = (payload as Payload)[key];
  return typeof value === 'number' ? value : undefined;
}

function readStringList(payload: unknown, key: string): readonly string[] {
  if (payload === null || typeof payload !== 'object') {
    return [];
  }
  const value = (payload as Payload)[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** Formats integer minor units (two decimals) with an ISO currency code. */
function formatMoney(
  minorUnits: number | undefined,
  currency: string | undefined,
): string | undefined {
  if (minorUnits === undefined || currency === undefined || !/^[A-Z]{3}$/.test(currency)) {
    return undefined;
  }
  const major = (minorUnits / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${major}`;
}

/** The in-app destination for an actionable notification. */
const ACTION_DESTINATIONS: Record<string, string> = {
  approvals: '/app/workflows',
  projects: '/app/projects',
  employees: '/app/employees',
  documents: '/app/documents',
  workflows: '/app/workflows',
  calendar: '/app/calendar',
};

/** Builds a navigate/approval action for a notification. */
function action(
  kind: 'approval' | 'navigate',
  destination: string,
  label: string,
): NotificationAction {
  return { kind, href: ACTION_DESTINATIONS[destination] ?? '/app', label };
}

/**
 * The deterministic notification policy. Map a canonical business event to
 * its notification + activity outcome; events outside the catalog produce
 * nothing (the consumer ignores them).
 */
export class NotificationPolicy {
  /** Evaluates one event envelope against the policy. */
  evaluate(event: EventEnvelope): PolicyOutcome {
    const actorId = event.actor.kind === 'user' ? event.actor.id : undefined;
    const workspaceId =
      typeof event.workspaceId === 'string' && event.workspaceId.length > 0
        ? event.workspaceId
        : undefined;

    switch (event.type) {
      case 'project.created': {
        const name = readString(event.payload, 'name') ?? 'Project';
        return {
          notifications: actorId
            ? [
                {
                  recipientId: actorId,
                  workspaceId,
                  type: event.type,
                  category: 'project',
                  title: 'Project created',
                  body: `Project "${name}" was created.`,
                  priority: 'normal',
                  action: action('navigate', 'projects', 'Open project'),
                },
              ]
            : [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: 'Project created',
              body: `Project "${name}" was created.`,
              actorId,
            },
          ],
        };
      }
      case 'employee.created': {
        const name = readString(event.payload, 'name') ?? 'Employee';
        return {
          notifications: actorId
            ? [
                {
                  recipientId: actorId,
                  workspaceId,
                  type: event.type,
                  category: 'employee',
                  title: 'Employee hired',
                  body: `${name} was hired.`,
                  priority: 'normal',
                  action: action('navigate', 'employees', 'Open employees'),
                },
              ]
            : [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: 'Employee hired',
              body: `${name} was hired.`,
              actorId,
            },
          ],
        };
      }
      // Finance decisions are auditable business events: an expense being
      // submitted, approved or rejected appears in the workspace activity feed
      // (and therefore the Audit Center) with the trusted actor. Activity only —
      // no notification (the approval flow already notifies the humans involved).
      case 'finance.expense.submitted': {
        const amount = formatMoney(
          readNumber(event.payload, 'amountMinorUnits'),
          readString(event.payload, 'currency'),
        );
        return {
          notifications: [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: 'Expense submitted',
              body:
                amount === undefined
                  ? 'An expense was submitted.'
                  : `An expense of ${amount} was submitted.`,
              actorId,
            },
          ],
        };
      }
      case 'finance.expense.approved':
      case 'finance.expense.rejected': {
        const approved = event.type === 'finance.expense.approved';
        return {
          notifications: [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: approved ? 'Expense approved' : 'Expense rejected',
              body: approved
                ? 'An expense was approved and now counts against its budget.'
                : 'An expense was rejected; it does not count against its budget.',
              actorId,
            },
          ],
        };
      }
      // The hiring chain is an auditable business process: every step (raised,
      // decided, returned, resubmitted, withdrawn) appears in the activity feed
      // — and therefore the Audit Center — with the trusted actor. Activity only:
      // the people whose turn it is see the request on the Hiring page.
      case 'hiring.requisition.submitted':
      case 'hiring.requisition.stage_approved':
      case 'hiring.requisition.approved':
      case 'hiring.requisition.changes_requested':
      case 'hiring.requisition.resubmitted':
      case 'hiring.requisition.withdrawn': {
        const jobTitle = readString(event.payload, 'jobTitle') ?? 'a role';
        const stage = readString(event.payload, 'stage');
        const stageLabel = stage === 'finance' ? 'Finance' : 'the executive';
        const wording: Record<string, { title: string; body: string }> = {
          'hiring.requisition.submitted': {
            title: 'Hiring request raised',
            body: `A hiring request for ${jobTitle} was raised.`,
          },
          'hiring.requisition.stage_approved': {
            title: 'Hiring request approved by the executive',
            body: `The hiring request for ${jobTitle} was approved by the executive and now waits for Finance.`,
          },
          'hiring.requisition.approved': {
            title: 'Hiring request approved',
            body: `The hiring request for ${jobTitle} was approved by Finance and is ready for HR.`,
          },
          'hiring.requisition.changes_requested': {
            title: 'Hiring request returned',
            body: `The hiring request for ${jobTitle} was returned to the requester by ${stageLabel}.`,
          },
          'hiring.requisition.resubmitted': {
            title: 'Hiring request resubmitted',
            body: `The hiring request for ${jobTitle} was revised and resubmitted.`,
          },
          'hiring.requisition.withdrawn': {
            title: 'Hiring request withdrawn',
            body: `The hiring request for ${jobTitle} was withdrawn by the requester.`,
          },
        };
        const text = wording[event.type];
        return {
          notifications: [],
          activity:
            text === undefined
              ? []
              : [{ workspaceId, type: event.type, title: text.title, body: text.body, actorId }],
        };
      }
      case 'workflow.completed':
        return {
          notifications: actorId
            ? [
                {
                  recipientId: actorId,
                  workspaceId,
                  type: event.type,
                  category: 'workflow',
                  title: 'Workflow completed',
                  body: 'Your workflow completed successfully.',
                  priority: 'normal',
                  action: action('navigate', 'workflows', 'View workflow'),
                },
              ]
            : [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: 'Workflow completed',
              body: 'A workflow completed successfully.',
              actorId,
            },
          ],
        };
      case 'workflow.failed':
        return {
          notifications: actorId
            ? [
                {
                  recipientId: actorId,
                  workspaceId,
                  type: event.type,
                  category: 'workflow',
                  title: 'Workflow failed',
                  body: 'Your workflow failed. Review the workflow to recover.',
                  priority: 'high',
                  action: action('navigate', 'workflows', 'Review workflow'),
                },
              ]
            : [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: 'Workflow failed',
              body: 'A workflow failed and needs attention.',
              actorId,
            },
          ],
        };
      case 'workflow.waiting_for_approval':
        return {
          notifications: actorId
            ? [
                {
                  recipientId: actorId,
                  workspaceId,
                  type: event.type,
                  category: 'approval',
                  title: 'Approval required',
                  body: 'A step in your workflow requires your approval before it can continue.',
                  priority: 'high',
                  action: action('approval', 'approvals', 'Review'),
                },
              ]
            : [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: 'Approval requested',
              body: 'A workflow is waiting for approval.',
              actorId,
            },
          ],
        };
      case 'document.available':
        return {
          notifications: actorId
            ? [
                {
                  recipientId: actorId,
                  workspaceId,
                  type: event.type,
                  category: 'document',
                  title: 'Document ready',
                  body: 'Your document has finished processing and is available.',
                  priority: 'normal',
                  action: action('navigate', 'documents', 'Open documents'),
                },
              ]
            : [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: 'Document ready',
              body: 'A document finished processing and is available.',
              actorId,
            },
          ],
        };
      case 'document.processing_failed':
        return {
          notifications: actorId
            ? [
                {
                  recipientId: actorId,
                  workspaceId,
                  type: event.type,
                  category: 'document',
                  title: 'Document processing failed',
                  body: 'Your document could not be processed. You may retry the upload.',
                  priority: 'high',
                  action: action('navigate', 'documents', 'Open documents'),
                },
              ]
            : [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: 'Document processing failed',
              body: 'A document failed processing.',
              actorId,
            },
          ],
        };
      case 'knowledge.indexed':
        return {
          notifications: [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: 'Knowledge indexed',
              body: 'A document is now available to knowledge search.',
              actorId,
            },
          ],
        };
      case 'workspace.plugin_installed':
      case 'workspace.plugin_updated':
      case 'workspace.plugin_removed': {
        // S19 marketplace audit trail: every install/update/uninstall is
        // recorded in the workspace activity feed (BKD §10.2 lifecycle,
        // FR-14/17 audit). The plugin id comes from the trusted event
        // payload — never from model or client output.
        const appId = readString(event.payload, 'pluginId') ?? 'App';
        const verb =
          event.type === 'workspace.plugin_installed'
            ? 'installed'
            : event.type === 'workspace.plugin_updated'
              ? 'updated'
              : 'uninstalled';
        return {
          notifications: actorId
            ? [
                {
                  recipientId: actorId,
                  workspaceId,
                  type: event.type,
                  category: 'system',
                  title: `App ${verb}`,
                  body: `App "${appId}" was ${verb} in this workspace.`,
                  priority: 'low',
                },
              ]
            : [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: `App ${verb}`,
              body: `App "${appId}" was ${verb} in this workspace.`,
              actorId,
            },
          ],
        };
      }
      case 'calendar.event.created':
      case 'calendar.event.updated':
      case 'calendar.event.cancelled': {
        const title = readString(event.payload, 'title') ?? 'Calendar event';
        const verb =
          event.type === 'calendar.event.created'
            ? 'created'
            : event.type === 'calendar.event.updated'
              ? 'updated'
              : 'cancelled';
        return {
          notifications: actorId
            ? [
                {
                  recipientId: actorId,
                  workspaceId,
                  type: event.type,
                  category: 'calendar',
                  title: `Calendar event ${verb}`,
                  body: `Calendar event "${title}" was ${verb}.`,
                  priority: 'normal',
                  action: action('navigate', 'calendar', 'Open calendar'),
                },
              ]
            : [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: `Calendar event ${verb}`,
              body: `Calendar event "${title}" was ${verb}.`,
              actorId,
            },
          ],
        };
      }
      case 'problem.detected': {
        // S27 §15: proactive problem notifications through the EXISTING
        // notification system — never a second one. The recipient is the
        // actor (the trusted user whose scope detected the problem); the
        // notification consumer's idempotency key (source event = the
        // problem's correlation identity) guarantees a repeatedly-detected
        // problem never creates infinite notifications. Payload carries
        // only the trusted problem facts (title + severity), never raw
        // evidence or payload blobs.
        const title = readString(event.payload, 'title') ?? 'A problem needs attention';
        const severity = readString(event.payload, 'severity') ?? 'medium';
        return {
          notifications: actorId
            ? [
                {
                  recipientId: actorId,
                  workspaceId,
                  type: event.type,
                  category: 'workflow',
                  title: `${severity === 'high' ? '⚠️ ' : ''}${title}`,
                  body: 'Nexora detected this condition automatically. The investigation, evidence, and any known solution are available in the Agent console.',
                  priority: severity === 'high' ? 'high' : 'normal',
                  action: action('navigate', 'workflows', 'Open agent console'),
                },
              ]
            : [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title,
              body: `Detected ${severity} severity. Investigated automatically — see the Agent console.`,
              actorId,
            },
          ],
        };
      }
      case 'connector.external_write': {
        // S25 Phase 7: governed external writes (GitHub/Slack via the
        // connector surface) project a workspace activity entry — the
        // external audit trail. The payload carries only the provider/
        // tool identity + verified output summary — never credentials or
        // raw provider internals.
        const provider = readString(event.payload, 'provider') ?? 'External system';
        const toolId = readString(event.payload, 'toolId') ?? 'external action';
        return {
          notifications: [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: `${provider} action completed`,
              body: `${provider} ${toolId} completed.`,
              actorId,
            },
          ],
        };
      }
      case 'ai.security.blocked': {
        // A blocked AI action (forged scope/authority in tool arguments, a
        // capability outside the caller's ceiling, approved arguments that
        // no longer match, a refused approval decision, a narration that
        // disclosed system instructions). Projected as a workspace activity
        // entry so the Audit Center shows it. The body is the structured
        // decision metadata only — never argument values or secrets.
        const field = (key: string) => readString(event.payload, key);
        const target = field('capabilityId') ?? field('toolId') ?? field('action') ?? 'AI action';
        const lines = [
          `agent: ${field('agent') ?? 'unknown'}`,
          ...(field('agentId') === undefined ? [] : [`agent id: ${field('agentId')}`]),
          ...(field('delegationId') === undefined ? [] : [`delegation: ${field('delegationId')}`]),
          `invocation: ${field('invocationId') ?? event.correlationId}`,
          `organization: ${field('organizationId') ?? event.tenantId}`,
          ...(field('workspaceId') === undefined ? [] : [`workspace: ${field('workspaceId')}`]),
          ...(field('toolId') === undefined ? [] : [`tool: ${field('toolId')}`]),
          `action: ${field('action') ?? 'unknown'}`,
          ...(field('policyId') === undefined
            ? []
            : [`policy: ${field('policyId')}@${field('policyVersion') ?? '1'}`]),
          ...(readStringList(event.payload, 'policyRules').length === 0
            ? []
            : [`policy rules: ${readStringList(event.payload, 'policyRules').join(' ')}`]),
          `policy decision: ${field('policyDecision') ?? 'deny'}`,
          `reason: ${field('reasonCode') ?? 'UNKNOWN'} — ${field('reason') ?? ''}`,
          `outcome: ${field('outcome') ?? 'blocked'}`,
        ];
        return {
          notifications: [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: `AI action blocked: ${target}`,
              body: lines.join('\n'),
              actorId,
            },
          ],
        };
      }
      case 'agent.created':
      case 'agent.suspended':
      case 'agent.reactivated':
      case 'agent.revoked':
      case 'agent.delegation.granted':
      case 'agent.delegation.revoked': {
        // Prompt 4: agent identity + delegation lifecycle — the audit trail
        // of WHO created/suspended/revoked an agent and WHO granted/revoked
        // WHICH capability, in WHICH scope, until WHEN. Structured fields
        // only (ids, capability, scope, expiry) — never secrets.
        const field = (key: string) => readString(event.payload, key);
        const scope = event.payload as { resourceScope?: { kind?: string; id?: string } };
        const agentName = field('agentName') ?? field('agentId') ?? 'agent';
        const titles: Record<string, string> = {
          'agent.created': `Agent created: ${agentName}`,
          'agent.suspended': `Agent suspended: ${agentName}`,
          'agent.reactivated': `Agent reactivated: ${agentName}`,
          'agent.revoked': `Agent revoked: ${agentName}`,
          'agent.delegation.granted': `Capability delegated to ${agentName}: ${field('capabilityId') ?? ''}`,
          'agent.delegation.revoked': `Delegation revoked from ${agentName}: ${field('capabilityId') ?? ''}`,
        };
        const lines = [
          `agent id: ${field('agentId') ?? 'unknown'}`,
          ...(field('delegationId') === undefined ? [] : [`delegation: ${field('delegationId')}`]),
          ...(field('capabilityId') === undefined ? [] : [`capability: ${field('capabilityId')}`]),
          ...(scope.resourceScope?.kind === undefined
            ? []
            : [`resource scope: ${scope.resourceScope.kind} ${scope.resourceScope.id ?? ''}`]),
          ...(field('expiresAt') === undefined ? [] : [`expires: ${field('expiresAt')}`]),
          ...(field('definitionId') === undefined ? [] : [`definition: ${field('definitionId')}`]),
          ...(field('status') === undefined ? [] : [`status: ${field('status')}`]),
        ];
        return {
          notifications: [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: titles[event.type] ?? event.type,
              body: lines.join('\n'),
              actorId,
            },
          ],
        };
      }
      case 'policy.version_created':
      case 'policy.enabled':
      case 'policy.disabled': {
        // Prompt 8: policy administration audit trail. Ids, versions, the
        // change type, the config hash and the actor — NEVER configuration
        // values (the hash proves integrity without disclosing content).
        const field = (key: string) => readString(event.payload, key);
        const version = readNumber(event.payload, 'version');
        const policyId = field('policyId') ?? 'policy';
        const titles: Record<string, string> = {
          'policy.version_created': `Policy version created: ${policyId}${version === undefined ? '' : ` v${version}`}`,
          'policy.enabled': `Policy enabled: ${policyId}${version === undefined ? '' : ` v${version}`}`,
          'policy.disabled': `Policy disabled: ${policyId}${version === undefined ? '' : ` v${version}`}`,
        };
        const lines = [
          `policy: ${policyId}`,
          ...(version === undefined ? [] : [`version: ${version}`]),
          ...(readNumber(event.payload, 'previousVersion') === undefined
            ? []
            : [`previous version: ${readNumber(event.payload, 'previousVersion')}`]),
          `change type: ${field('changeType') ?? 'version'}`,
          ...(field('configHash') === undefined ? [] : [`config hash: ${field('configHash')}`]),
          `actor: ${field('actorId') ?? actorId ?? 'unknown'}`,
          `organization: ${field('organizationId') ?? event.tenantId}`,
          ...(field('workspaceId') === undefined ? [] : [`workspace: ${field('workspaceId')}`]),
        ];
        return {
          notifications: [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: titles[event.type] ?? event.type,
              body: lines.join('\n'),
              actorId,
            },
          ],
        };
      }
      case 'policy.admin_denied': {
        // An unauthorized policy administration attempt (read or mutate),
        // recorded after the caller's scope membership was verified. No
        // configuration values — only who, what, where and why.
        const field = (key: string) => readString(event.payload, key);
        const lines = [
          `actor: ${field('actorId') ?? actorId ?? 'unknown'}`,
          `organization: ${field('organizationId') ?? event.tenantId}`,
          ...(field('workspaceId') === undefined ? [] : [`workspace: ${field('workspaceId')}`]),
          `action: ${field('action') ?? 'unknown'}`,
          `required capability: ${field('requiredCapability') ?? 'unknown'}`,
          ...(field('policyId') === undefined ? [] : [`policy: ${field('policyId')}`]),
          `reason: ${field('reasonCode') ?? 'FORBIDDEN'}`,
          'outcome: blocked',
        ];
        return {
          notifications: [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: `Policy administration denied: ${field('action') ?? 'access'}`,
              body: lines.join('\n'),
              actorId,
            },
          ],
        };
      }
      case 'approval.granted':
      case 'approval.rejected':
      case 'approval.expired':
      case 'approval.recovery_required': {
        // Prompt 8: approval lifecycle audit trail (published once per
        // transition). Ids and classifications only — never the approved
        // arguments or any payload.
        const field = (key: string) => readString(event.payload, key);
        const recovery = event.type === 'approval.recovery_required';
        const verb = event.type.slice('approval.'.length);
        const capability = field('capabilityId') ?? field('toolId') ?? 'action';
        const lines = [
          `approval: ${field('approvalId') ?? 'unknown'}`,
          `capability: ${field('capabilityId') ?? 'unknown'}`,
          ...(field('toolId') === undefined ? [] : [`tool: ${field('toolId')}`]),
          ...(field('requesterId') === undefined ? [] : [`requester: ${field('requesterId')}`]),
          ...(event.type === 'approval.expired' || recovery
            ? []
            : [`actor: ${field('decidedBy') ?? actorId ?? 'unknown'}`]),
          ...(recovery
            ? ['outcome: unknown; verify state before re-requesting (never auto-retried)']
            : []),
          ...(field('expiresAt') === undefined ? [] : [`expires: ${field('expiresAt')}`]),
          `organization: ${field('organizationId') ?? event.tenantId}`,
          ...(field('workspaceId') === undefined ? [] : [`workspace: ${field('workspaceId')}`]),
        ];
        return {
          notifications: [],
          activity: [
            {
              workspaceId,
              type: event.type,
              title: recovery
                ? `Approval recovery required: ${capability}`
                : `Approval ${verb}: ${capability}`,
              body: lines.join('\n'),
              actorId,
            },
          ],
        };
      }
      default:
        // Events outside the catalog produce nothing.
        return { notifications: [], activity: [] };
    }
  }
}
