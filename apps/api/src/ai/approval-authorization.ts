/**
 * @nexora/app-api — approval decision authorization (Prompt 8).
 *
 * The ONE deterministic rule set for who may decide an AI approval request,
 * shared by every decision channel (the REST decision route, the signed
 * inbound-email action, and the pending-approvals list that computes
 * `canDecide`). Every input is trusted server-side state (the approval
 * record, the authenticated or allowlisted identity, memberships, the role
 * catalog) — NEVER a request body field, header, model claim or frontend
 * flag. A `role` / `approver` / `authority` value in a request is ignored.
 *
 * A decision (approve OR reject) is allowed only when ALL hold:
 * 1. the decider is an authenticated member of the approval's organization
 *    AND of the approval's workspace (and the channel's workspace, when it
 *    names one, is the approval's workspace);
 * 2. the decider's trusted role grants `approvals.decide` in that workspace;
 * 3. the approval is not expired (`APPROVAL_EXPIRED`);
 * 4. when the approval carries `requiredApproverRoleId`, the decider's
 *    RESOLVED role in the approval's workspace equals it
 *    (`WRONG_APPROVER_ROLE`) — whoever requested it: a requester with a
 *    different role is not valid, and neither is an arbitrary
 *    `approvals.decide` holder;
 * 5. when the approval carries `separationOfDuties`, the decider is NOT the
 *    requester (`SELF_APPROVAL_FORBIDDEN`);
 * 6. LEGACY (neither 4 nor 5 set — no POLICY_APPROVAL_AUTHORITY matched):
 *    the decider must be the requester (`NOT_REQUESTER`), unchanged;
 * 7. the gated executable capability is still within the REQUESTER's
 *    effective capability set (a role change since the request fails
 *    closed; an EMPTY set is never "unrestricted"). The resumed run executes AS the requester, never as the
 *    approver — an approver grants, they do not lend authority.
 */

import type { WorkspaceId } from '@nexora/contracts/common';
import type { AIBusinessContext, ApprovalRequestRecord } from '@nexora/ai-runtime';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';

/** Dependencies of {@link authorizeApprovalDecision}. */
export interface ApprovalDecisionAuthorizationDependencies {
  listOrganizations: ListOrganizationsHandler;
  /** Membership-scoped workspace listing (the decider must be in the approval's workspace). */
  listMyWorkspaces: ListMyWorkspacesHandler;
  permissions: PermissionResolverDependencies;
  buildBusinessContext: (context: {
    userId: string;
    tenantId: string;
    workspaceId?: string;
  }) => Promise<AIBusinessContext | undefined>;
}

/** Why a decision was refused (stable, safe to show and to audit). */
export type ApprovalDecisionRefusal =
  | 'NOT_REQUESTER'
  | 'NOT_A_MEMBER'
  | 'DECIDE_NOT_PERMITTED'
  | 'CAPABILITY_NOT_PERMITTED'
  | 'WORKSPACE_MISMATCH'
  | 'WRONG_APPROVER_ROLE'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'APPROVAL_EXPIRED';

/** The outcome of {@link authorizeApprovalDecision}. */
export type ApprovalDecisionAuthorization =
  | {
      ok: true;
      /** The requester's trusted business context (reused for the resumed run). */
      businessContext: AIBusinessContext | undefined;
      /** The requester's effective executable capability ids. */
      executableCapabilityIds: readonly string[];
      /** The decider's trusted resolved role in the approval's workspace. */
      deciderRoleId: string;
    }
  | { ok: false; refusal: ApprovalDecisionRefusal; message: string };

/** Authorizes one approval decision (see module docs for the rules). */
export async function authorizeApprovalDecision(
  dependencies: ApprovalDecisionAuthorizationDependencies,
  input: {
    approval: ApprovalRequestRecord;
    /** The trusted identity of the decider. */
    deciderId: string;
    /** The workspace the decision channel is scoped to, when it names one. */
    channelWorkspaceId?: string;
  },
): Promise<ApprovalDecisionAuthorization> {
  const { approval, deciderId } = input;
  const governed = approval.requiredApproverRoleId !== undefined || approval.separationOfDuties;
  if (!governed && approval.userId !== deciderId) {
    // Legacy rule (no POLICY_APPROVAL_AUTHORITY requirement): only the
    // requester decides their own approval.
    return {
      ok: false,
      refusal: 'NOT_REQUESTER',
      message: 'You are not the requester of this approval',
    };
  }
  if (
    input.channelWorkspaceId !== undefined &&
    (approval.workspaceId ?? undefined) !== input.channelWorkspaceId
  ) {
    return {
      ok: false,
      refusal: 'WORKSPACE_MISMATCH',
      message: 'This approval does not belong to that workspace',
    };
  }
  const membership = await dependencies.listOrganizations.handle({ userId: deciderId as never });
  const stillMember = membership.ok && membership.value.some((org) => org.id === approval.tenantId);
  if (!stillMember) {
    return {
      ok: false,
      refusal: 'NOT_A_MEMBER',
      message: 'You are not a member of this organization',
    };
  }
  if (approval.workspaceId !== undefined) {
    const mine = await dependencies.listMyWorkspaces.handle({
      userId: deciderId as never,
      organizationId: approval.tenantId as never,
    });
    const inWorkspace =
      mine.ok && mine.value.some((workspace) => workspace.id === approval.workspaceId);
    if (!inWorkspace) {
      return {
        ok: false,
        refusal: 'NOT_A_MEMBER',
        message: 'You are not a member of this workspace',
      };
    }
  }
  const decide = await authorizePermission(
    dependencies.permissions,
    { userId: deciderId, tenantId: approval.tenantId, workspaceId: approval.workspaceId },
    'approvals.decide',
  );
  if (!decide.ok) {
    return {
      ok: false,
      refusal: 'DECIDE_NOT_PERMITTED',
      message: 'Your current role does not have permission to decide this approval',
    };
  }
  if (approval.status === 'expired') {
    return {
      ok: false,
      refusal: 'APPROVAL_EXPIRED',
      message: 'This approval request has expired',
    };
  }
  const deciderRoleId = decide.effective.roleId;
  if (
    approval.requiredApproverRoleId !== undefined &&
    deciderRoleId !== approval.requiredApproverRoleId
  ) {
    return {
      ok: false,
      refusal: 'WRONG_APPROVER_ROLE',
      message: 'Your role is not the approver role required for this approval',
    };
  }
  if (approval.separationOfDuties && approval.userId === deciderId) {
    return {
      ok: false,
      refusal: 'SELF_APPROVAL_FORBIDDEN',
      message: 'You cannot decide an approval you requested (separation of duties)',
    };
  }
  const businessContext = await dependencies.buildBusinessContext({
    userId: approval.userId,
    tenantId: approval.tenantId,
    workspaceId: approval.workspaceId as WorkspaceId | undefined,
  });
  const executableCapabilityIds = businessContext?.capabilityIds ?? [];
  // Fail closed: a requester whose role now yields NO executable capability
  // (role removed, membership gone, an unmapped role) does not hold the gated
  // capability either. An empty set is never "unrestricted" here.
  if (
    approval.capabilityId.length > 0 &&
    !executableCapabilityIds.includes(approval.capabilityId)
  ) {
    return {
      ok: false,
      refusal: 'CAPABILITY_NOT_PERMITTED',
      message: 'Your current role does not have permission to execute this action',
    };
  }
  return { ok: true, businessContext, executableCapabilityIds, deciderRoleId };
}
