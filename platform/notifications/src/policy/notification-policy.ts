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
      default:
        // Events outside the catalog produce nothing.
        return { notifications: [], activity: [] };
    }
  }
}
