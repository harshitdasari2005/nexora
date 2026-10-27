/**
 * @nexora/app-api — who may take a stage of an office workflow.
 *
 * A stage names a SEAT; a seat is held through a capability of the caller's
 * resolved role in the workspace they act from. The manager seat belongs to a
 * manager of the team the request was raised from, a step that belongs to the
 * requester can be taken only by them, and a decision that would fall to its
 * own requester goes up to the executive. A seat nobody in the organization
 * holds yet (a young office without that department) falls to the executive
 * too, so no request waits for a person who does not exist. Nobody decides
 * their own request, whoever they are.
 *
 * One place decides this, for the routes and for anything that needs to know
 * whose turn it is (the guided demo).
 */

import type { OfficeRequest, WorkflowSeat, WorkflowStageDefinition } from '@nexora/domain-hr';

import {
  hasPermission,
  resolveEffectivePermissions,
  type EffectivePermissions,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import type { OfficeScope } from '../routes/office-scope.js';
import type { Staffing, StaffingSnapshot } from './staffing.js';

/** The capability that grants each seat (the requester's own seat needs none). */
export const SEAT_CAPABILITY: Record<Exclude<WorkflowSeat, 'requester'>, string> = {
  manager: 'requests.approve_manager',
  executive: 'requests.approve_executive',
  hr: 'requests.approve_hr',
  finance: 'requests.approve_finance',
  it: 'requests.approve_it',
  engineering: 'requests.approve_engineering',
  marketing: 'requests.approve_marketing',
  sales: 'requests.approve_sales',
  support: 'requests.approve_support',
  legal: 'requests.approve_legal',
};

/** The role with nobody above it: its requests need no manager decision. */
export const EXECUTIVE_ROLE_ID = 'executive.ceo';
export const EXECUTIVE_CAPABILITY = SEAT_CAPABILITY.executive;

/** The authority questions of the office workflows. */
export interface RequestAuthority {
  /** Whether a role holds a seat's authority for THIS request, from where they act. */
  holdsSeat(
    request: OfficeRequest,
    seat: WorkflowSeat,
    scope: OfficeScope,
    effective: EffectivePermissions | undefined,
    userId: string,
  ): boolean;
  /** Whether a decision would fall to its requester and so goes up to this executive. */
  escalatesToExecutive(
    request: OfficeRequest,
    stage: WorkflowStageDefinition,
    effective: EffectivePermissions | undefined,
    userId: string,
  ): Promise<boolean>;
  /**
   * Whether NOBODY holds this seat for this request: no manager in the
   * request's own team, or nobody in the organization for any other seat.
   */
  seatIsVacant(
    request: OfficeRequest,
    seat: WorkflowSeat,
    effective: EffectivePermissions | undefined,
  ): Promise<boolean>;
  /** Whether the caller may take the stage the request is waiting at. */
  mayTakePending(
    request: OfficeRequest,
    scope: OfficeScope,
    effective: EffectivePermissions | undefined,
    userId: string,
  ): Promise<boolean>;
}

/** Builds the authority questions over the platform's role resolver. */
export function createRequestAuthority(
  permissions: PermissionResolverDependencies,
  staffing?: Staffing,
): RequestAuthority {
  // Staffing is read once per caller per call: the resolved permissions object
  // lives exactly as long as one request is being answered.
  const staffingOf = new WeakMap<object, Map<string, Promise<StaffingSnapshot>>>();
  const readStaffing = (
    organizationId: string,
    effective: EffectivePermissions | undefined,
  ): Promise<StaffingSnapshot> | undefined => {
    if (staffing === undefined) return undefined;
    if (effective === undefined) return staffing.read(organizationId);
    let perCaller = staffingOf.get(effective);
    if (perCaller === undefined) {
      perCaller = new Map();
      staffingOf.set(effective, perCaller);
    }
    let snapshot = perCaller.get(organizationId);
    if (snapshot === undefined) {
      snapshot = staffing.read(organizationId);
      perCaller.set(organizationId, snapshot);
    }
    return snapshot;
  };

  const seatIsVacant: RequestAuthority['seatIsVacant'] = async (request, seat, effective) => {
    if (seat === 'requester') return false;
    const snapshot = await readStaffing(request.organizationId, effective);
    if (snapshot === undefined) return false;
    const held =
      seat === 'manager' ? snapshot.byTeam.get(request.workspaceId) : snapshot.organization;
    return held?.has(SEAT_CAPABILITY[seat]) !== true;
  };

  const holdsSeat: RequestAuthority['holdsSeat'] = (request, seat, scope, effective, userId) => {
    if (seat === 'requester') return request.requestedBy === userId;
    return (
      hasPermission(effective, SEAT_CAPABILITY[seat]) &&
      // The manager seat belongs to a manager of the team the request came from.
      (seat !== 'manager' || scope.workspaceId === request.workspaceId)
    );
  };

  const escalatesToExecutive: RequestAuthority['escalatesToExecutive'] = async (
    request,
    stage,
    effective,
    userId,
  ) => {
    if (stage.seat === 'requester') return false;
    if (!hasPermission(effective, EXECUTIVE_CAPABILITY) || request.requestedBy === userId) {
      return false;
    }
    // A seat nobody holds yet: the executive covers it, work and decisions alike.
    if (await seatIsVacant(request, stage.seat, effective)) return true;
    if (stage.kind !== 'decide') return false;
    const requesters = await resolveEffectivePermissions(permissions, {
      userId: request.requestedBy,
      tenantId: request.organizationId,
      workspaceId: request.workspaceId,
    });
    return hasPermission(requesters, SEAT_CAPABILITY[stage.seat]);
  };

  const mayTakePending: RequestAuthority['mayTakePending'] = async (
    request,
    scope,
    effective,
    userId,
  ) => {
    const stage = request.pendingStageDefinition;
    if (stage === undefined) return false;
    return (
      holdsSeat(request, stage.seat, scope, effective, userId) ||
      (await escalatesToExecutive(request, stage, effective, userId))
    );
  };

  return { holdsSeat, escalatesToExecutive, seatIsVacant, mayTakePending };
}
