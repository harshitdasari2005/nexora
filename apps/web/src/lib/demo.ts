/**
 * @nexora/app-web — Demo World client.
 *
 * Typed wrappers over the config-gated `/api/demo/*` endpoints. The browser
 * only ever names a persona KEY from the server's fixed list; the backend
 * maps it to a real seeded user and a REAL session. Nothing here decides who
 * a user is or what they may do — every later request is authorized by the
 * normal pipeline.
 */

import { api, ApiError } from './api.js';

/** Every person in the demo office (the server's fixed list). */
export type DemoPersonaKey =
  'ceo' | 'cto' | 'manager' | 'dev_aarav' | 'dev_meghna' | 'hr' | 'cfo' | 'controller';

/** A demo persona as published by the server (no email, no user id). */
export interface DemoPersona {
  key: DemoPersonaKey;
  displayName: string;
  title: string;
  responsibility: string;
  /** The workspace the persona starts in (a server-published scope id). */
  workspaceId: string;
}

/**
 * Where a person lands after signing in: their desk in their own workspace —
 * what is waiting for them, with the guided story's next step on top.
 */
export function demoHomePath(organizationId: string, persona: DemoPersona): string {
  return `/app/desk?${demoScopeQuery(organizationId, persona)}`;
}

/** The trusted scope query of a persona's own workspace. */
export function demoScopeQuery(organizationId: string, persona: DemoPersona): string {
  return `organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(persona.workspaceId)}`;
}

/** What the guided story suggests typing into the forms (the user may change any of it). */
export interface DemoHiringSuggestion {
  jobTitle: string;
  department: string;
  projectId: string;
  headcount: number;
  employmentType: 'full_time' | 'part_time' | 'contract' | 'intern';
  salaryMinMinorUnits: number;
  salaryMaxMinorUnits: number;
  currency: string;
  urgency: 'low' | 'normal' | 'high';
  justification: string;
  jobPosting: string;
  candidateName: string;
  candidateEmail: string;
}

/** `GET /api/demo/config` when demo mode is enabled. */
export interface DemoConfig {
  enabled: true;
  seeded: boolean;
  organizationId: string;
  personas: readonly DemoPersona[];
  story: {
    hireRequest: string;
    projectName: string;
    budgetName: string;
    expense: { description: string; amountMinorUnits: number; currency: string };
    /** Absent on an older backend. */
    hiring?: DemoHiringSuggestion;
  };
}

/** Reads the demo config; `null` when demo mode is disabled (the endpoint answers 404). */
export async function fetchDemoConfig(): Promise<DemoConfig | null> {
  try {
    return await api<DemoConfig>('/demo/config');
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** Starts a real session for a demo persona (the cookie is set by the server). */
export async function demoLogin(persona: DemoPersona['key']): Promise<void> {
  await api<{ persona: DemoPersona }>('/demo/login', {
    method: 'POST',
    body: JSON.stringify({ persona }),
  });
}

/** Resets the demo world (server-fixed target) and re-establishes the same persona's session. */
export async function demoReset(): Promise<{ resetAt: string }> {
  return api<{ resetAt: string }>('/demo/reset', { method: 'POST' });
}

/** The screen a step of the guided story is done on. */
export type StoryScreen = 'hiring' | 'recruiting' | 'onboarding';

/** One step of the guided story, as derived by the backend from the hiring records. */
export interface StoryStep {
  key: string;
  title: string;
  state: 'done' | 'current' | 'waiting' | 'skipped' | 'returned';
  detail: string;
  /** Who acts now (set on the current step only). */
  who: readonly DemoPersonaKey[];
  screen: StoryScreen;
}

/** `GET /api/demo/story`: where the hiring story stands and whose turn it is. */
export interface DemoStory {
  subject?: string;
  steps: readonly StoryStep[];
  next?: { step: string; who: readonly DemoPersonaKey[]; action: string; screen: StoryScreen };
  finished: boolean;
}

/** Reads the guided story (derived on the server; the browser decides nothing). */
export function fetchDemoStory(): Promise<DemoStory> {
  return api<DemoStory>('/demo/story');
}

/** The approval as read back from `GET /api/approvals/:id` (persisted state). */
export interface ApprovalStateDto {
  id: string;
  capabilityId: string;
  toolId: string;
  requesterId: string;
  requesterName?: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  requiredApproverRoleId?: string;
  separationOfDuties: boolean;
  policy?: { policyId: string; version: string; outcome: string };
  reason: string;
  canDecide: boolean;
  denyReason?: string;
  runId: string;
  intent: string;
  decision?: 'grant' | 'reject';
  decidedById?: string;
  decidedByName?: string;
  decidedAt?: string;
  executedAt?: string;
  error?: string;
}

/** Reads one approval's persisted state in a workspace scope. */
export async function fetchApproval(
  approvalId: string,
  scope: { organizationId: string; workspaceId: string },
): Promise<ApprovalStateDto> {
  const query = new URLSearchParams(scope).toString();
  const result = await api<{ approval: ApprovalStateDto }>(
    `/approvals/${encodeURIComponent(approvalId)}?${query}`,
  );
  return result.approval;
}
