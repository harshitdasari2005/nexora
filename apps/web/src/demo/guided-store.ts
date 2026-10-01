/**
 * @nexora/app-web — Guided Demo pointers.
 *
 * The Guided Demo survives persona switches (each switch reloads the session
 * and remounts the pages), so it remembers POINTERS to backend records: the
 * approval ids it raised and the CEO's real refusal responses. A pointer is
 * only a handle — every stage is still derived from reading the backend by that
 * id; nothing stored here can mark a stage done.
 */

import type { JourneyFacts, SelfApprovalAttempt } from './journey.js';

const KEY = 'nexora.demo.run';

export interface GuidedRun {
  /** Facts previously read from the backend (each tagged with the persona who read it). */
  facts?: JourneyFacts;
  hireApprovalId?: string;
  financeApprovalId?: string;
  hireSelfApproval?: SelfApprovalAttempt;
  financeSelfApproval?: SelfApprovalAttempt;
  /** Utilization (spent minor units) first read while the expense was pending. */
  utilizationBefore?: {
    budgetId: string;
    name: string;
    currency: string;
    allocatedMinorUnits: number;
    spentMinorUnits: number;
    utilizationPercent: number;
    observedAs: 'controller' | 'cfo';
  };
}

export function loadGuidedRun(): GuidedRun {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw === null ? {} : (JSON.parse(raw) as GuidedRun);
  } catch {
    return {};
  }
}

export function saveGuidedRun(patch: Partial<GuidedRun>): GuidedRun {
  const next = { ...loadGuidedRun(), ...patch };
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable (private mode): the run then re-discovers itself from the backend.
  }
  return next;
}

export function clearGuidedRun(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
