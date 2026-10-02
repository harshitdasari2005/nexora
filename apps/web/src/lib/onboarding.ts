/**
 * @nexora/app-web — onboarding client.
 *
 * Typed wrappers over `/api/onboarding` and the assignment that follows. Which
 * checklist items the caller may tick (`canComplete`) and whether they may
 * assign the new colleague (`canAssign`) are computed by the server.
 */

import { api } from './api.js';
import type { HiringScope } from './hiring.js';

export type OnboardingOwner = 'hr' | 'it' | 'manager';

export interface OnboardingItem {
  key: string;
  owner: OnboardingOwner;
  title: string;
  done: boolean;
  doneByName?: string;
  doneAt?: string;
  note?: string;
  canComplete: boolean;
}

export interface OnboardingRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  status: 'in_progress' | 'completed';
  employeeStatus?: string;
  jobTitle?: string;
  startDate?: string;
  hiringManagerName?: string;
  projectId?: string;
  projectName?: string;
  assignedToProject: boolean;
  canAssign: boolean;
  items: readonly OnboardingItem[];
}

/** A hired person whose onboarding HR has not started yet. */
export interface ReadyHire {
  employeeId: string;
  name: string;
  jobTitle?: string;
  department?: string;
  startDate?: string;
}

const query = (scope: HiringScope): string =>
  `organizationId=${encodeURIComponent(scope.organizationId)}&workspaceId=${encodeURIComponent(scope.workspaceId)}`;

export function listOnboardings(
  scope: HiringScope,
): Promise<{ onboardings: OnboardingRecord[]; readyToStart: ReadyHire[]; canStart: boolean }> {
  return api(`/onboarding?${query(scope)}`);
}

export function startOnboarding(scope: HiringScope, employeeId: string): Promise<unknown> {
  return api('/onboarding', { method: 'POST', body: JSON.stringify({ ...scope, employeeId }) });
}

export function completeItem(
  scope: HiringScope,
  onboardingId: string,
  item: string,
  note?: string,
): Promise<unknown> {
  const trimmed = note?.trim() ?? '';
  return api(
    `/onboarding/${encodeURIComponent(onboardingId)}/items/${encodeURIComponent(item)}/complete`,
    {
      method: 'POST',
      body: JSON.stringify({ ...scope, ...(trimmed === '' ? {} : { note: trimmed }) }),
    },
  );
}

export function assignToProject(
  scope: HiringScope,
  projectId: string,
  employeeId: string,
): Promise<unknown> {
  return api(`/projects/${encodeURIComponent(projectId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ ...scope, employeeId }),
  });
}

export const OWNER_LABEL: Record<OnboardingOwner, string> = {
  hr: 'HR',
  it: 'IT',
  manager: 'Hiring manager',
};

/** "3 of 5 done". */
export function progressLabel(record: Pick<OnboardingRecord, 'items'>): string {
  const done = record.items.filter((item) => item.done).length;
  return `${done} of ${record.items.length} done`;
}
