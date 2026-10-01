/**
 * @nexora/app-api — the per-tool verification table (Prompt: verification hardening).
 *
 * Declares, per registered tool, WHICH verification source it declares and how
 * strong that evidence is. It is DATA, kept in lock-step with the tool
 * manifests by `test/tool-verification-table.test.ts` (every registered tool
 * must have exactly one row and each row must equal what the manifest
 * declares) and mirrored in platform/ai-runtime/docs/GOVERNED_EXECUTION.md §6.
 *
 * Strength:
 * - `independent`  the changed state is re-read (from persisted state or the
 *                  provider) by a path that is not the write handler's own report;
 *                  a lying handler yields `UNVERIFIED`.
 * - `shape`        only the response shape is checked; the object is not re-read.
 * - `handler-only` only the handler's success report; NO independent verification
 *                  (a limitation is always declared). Never labelled independent.
 */

import type { ToolVerificationSource } from '@nexora/agent-sdk/tools';

/** How strong a verification source is. */
export type VerificationStrength = 'independent' | 'shape' | 'handler-only';

/** One row of {@link TOOL_VERIFICATION_TABLE}. */
export interface ToolVerificationRow {
  readonly tool: string;
  readonly source: ToolVerificationSource;
  readonly strength: VerificationStrength;
  /** What the verification does NOT prove (required unless independent and unqualified). */
  readonly limitation: string;
}

/** The strength a declared source earns. `handler_result` is never independent. */
export function strengthOfSource(source: ToolVerificationSource): VerificationStrength {
  switch (source) {
    case 'state_readback':
    case 'provider_readback':
    case 'redetection':
      return 'independent';
    case 'response_shape':
      return 'shape';
    case 'handler_result':
      return 'handler-only';
  }
}

const READ_ONLY =
  'read-only tool; nothing changed, so there is no state to read back (the handler result is the answer)';

/** The verification of every registered tool (native and connector). */
export const TOOL_VERIFICATION_TABLE: readonly ToolVerificationRow[] = [
  {
    tool: 'hr.create_employee',
    source: 'state_readback',
    strength: 'independent',
    limitation: 'employee re-read by id (tenant-scoped); as strong as the HR read model',
  },
  {
    tool: 'hr.revoke_hire',
    source: 'state_readback',
    strength: 'independent',
    limitation: 'employee re-read by id and must be persisted `offboarded`; the record is retained',
  },
  {
    tool: 'projects.assign_employee',
    source: 'state_readback',
    strength: 'independent',
    limitation: 'assignment must appear in the project member list',
  },
  {
    tool: 'projects.create_project',
    source: 'state_readback',
    strength: 'independent',
    limitation: 'project re-read in the trusted tenant',
  },
  {
    tool: 'calendar.create_event',
    source: 'state_readback',
    strength: 'independent',
    limitation: 'persisted calendar entry re-read from the workspace list',
  },
  {
    tool: 'finance.submit_expense',
    source: 'state_readback',
    strength: 'independent',
    limitation: 'persisted expense re-read from the workspace list',
  },
  {
    tool: 'finance.flag_over_budget_items',
    source: 'state_readback',
    strength: 'independent',
    limitation:
      'flagged budgets re-read from the workspace budget list; when nothing was flagged there is nothing to read back',
  },
  {
    tool: 'notifications.mark_all_read',
    source: 'state_readback',
    strength: 'independent',
    limitation: 'unread count re-read and must be zero',
  },
  {
    tool: 'workspaces.create_workspace',
    source: 'state_readback',
    strength: 'independent',
    limitation:
      "re-read through the creator's membership-scoped workspace list (tenant, name, slug, status), not a raw repository read",
  },
  {
    tool: 'workflow.hire_and_assign_employee',
    source: 'state_readback',
    strength: 'independent',
    limitation:
      'after the instance succeeded: hired employee, project and assignment re-read; the journal and inner-step verification are not re-derived',
  },
  {
    tool: 'workflow.create_project_and_assign_employee',
    source: 'state_readback',
    strength: 'independent',
    limitation:
      'after the instance succeeded: created project, employee and assignment re-read; the journal and inner-step verification are not re-derived',
  },
  {
    tool: 'github.issues.create',
    source: 'provider_readback',
    strength: 'independent',
    limitation: "depends on the provider's read consistency",
  },
  {
    tool: 'slack.messages.send',
    source: 'response_shape',
    strength: 'shape',
    limitation:
      'the provider response carried a message identifier; the message was not re-read from Slack',
  },
  ...[
    'workspaces.list_workspaces',
    'projects.find_project',
    'projects.list',
    'hr.find_employee',
    'knowledge.search',
    'documents.search',
    'notifications.list',
    'notifications.what_needs_attention',
    'github.repositories.list',
    'github.repositories.get',
    'github.issues.list',
    'slack.channels.list',
    'slack.messages.recent',
  ].map((tool): ToolVerificationRow => ({
    tool,
    source: 'handler_result',
    strength: 'handler-only',
    limitation: READ_ONLY,
  })),
];
