/**
 * @nexora/app-web — the weekly review client.
 *
 * The server counts everything from the records; the assistant only puts the
 * counts into sentences. The page shows both and says which is which.
 */

import { api } from './api.js';
import type { HiringScope } from './hiring.js';

export interface WaitingStep {
  step: string;
  department: string;
  count: number;
  longestHours: number;
}

export interface WaitingRequest {
  id: string;
  workflow: string;
  summary: string;
  step: string;
  requestedByName?: string;
  waitingHours: number;
  stuck: boolean;
}

export interface DepartmentWeek {
  department: string;
  raised: number;
  finished: number;
  inMotion: number;
  typicalHours?: number;
}

/** The counted facts of the last seven days. */
export interface WeeklyReview {
  from: string;
  to: string;
  requests: {
    raised: number;
    finished: number;
    refused: number;
    withdrawn: number;
    inMotion: number;
    typicalHours?: number;
    draftedWithAssistant: number;
    assistantHelps: number;
  };
  waitingAt: readonly WaitingStep[];
  waitingLongest: readonly WaitingRequest[];
  departments: readonly DepartmentWeek[];
  tasks: { done: number; inReview: number; inProgress: number; todo: number; overdue: number };
}

export interface ReviewResponse {
  review: WeeklyReview;
  /** The counts in plain sentences, written by rules (always available). */
  summary: string;
  assistant: { connected: boolean; model?: string };
}

const query = (scope: HiringScope): string =>
  `organizationId=${encodeURIComponent(scope.organizationId)}&workspaceId=${encodeURIComponent(scope.workspaceId)}`;

export function fetchReview(scope: HiringScope): Promise<ReviewResponse> {
  return api(`/review?${query(scope)}`);
}

/** The same counts worded by the assistant (or by rules when no model is connected). */
export async function fetchReviewSummary(
  scope: HiringScope,
): Promise<{ text: string; source: 'ai' | 'rules' }> {
  return (
    await api<{ summary: { text: string; source: 'ai' | 'rules' } }>(
      `/review/summary?${query(scope)}`,
    )
  ).summary;
}

/** "3 hours", "2 days" — how a person says a length of time. */
export function spokenHours(hours: number): string {
  if (hours < 1) return 'less than an hour';
  if (hours < 36) {
    const whole = Math.round(hours);
    return `${whole} ${whole === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
