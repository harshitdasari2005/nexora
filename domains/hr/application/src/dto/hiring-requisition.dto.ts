/**
 * @nexora/application-hr — HiringRequisition DTO.
 */

import {
  HiringRequisition,
  type RequisitionHistoryEntry,
  type RequisitionStage,
} from '@nexora/domain-hr';

/** A hiring requisition as exposed outside the domain. */
export interface HiringRequisitionDto {
  id: string;
  organizationId: string;
  workspaceId: string;
  requestedBy: string;
  jobTitle: string;
  department: string;
  projectId?: string;
  headcount: number;
  employmentType: string;
  salaryMinMinorUnits: number;
  salaryMaxMinorUnits: number;
  currency: string;
  justification: string;
  urgency: string;
  targetStartDate?: string;
  status: string;
  /** The stage the request is waiting at, when it is waiting for a decision. */
  pendingStage?: RequisitionStage;
  round: number;
  history: readonly RequisitionHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

/** Maps the aggregate to its DTO. */
export function toHiringRequisitionDto(requisition: HiringRequisition): HiringRequisitionDto {
  const { version: _version, ...snapshot } = HiringRequisition.snapshot(requisition);
  void _version;
  const pendingStage = requisition.pendingStage;
  return {
    ...snapshot,
    history: [...snapshot.history],
    ...(pendingStage === undefined ? {} : { pendingStage }),
  };
}
