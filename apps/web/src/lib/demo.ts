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
  | 'ceo'
  | 'cto'
  | 'manager'
  | 'dev_aarav'
  | 'dev_meghna'
  | 'hr'
  | 'cfo'
  | 'controller'
  | 'marketing'
  | 'sales'
  | 'support'
  | 'legal';

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

/** The screen a step of a guided story is done on. */
export type StoryScreen = 'hiring' | 'recruiting' | 'onboarding' | 'requests' | 'tasks';

/** One step of a guided story, as derived by the backend from the real records. */
export interface StoryStep {
  key: string;
  title: string;
  state: 'done' | 'current' | 'waiting' | 'skipped' | 'returned';
  detail: string;
  /** Who acts now (set on the current step only). */
  who: readonly DemoPersonaKey[];
  screen: StoryScreen;
  /** Whose job this step is in an office. */
  owner?: string;
}

/** A story line the guided demo can follow. */
export interface StoryInfo {
  key: string;
  title: string;
  department: string;
  about: string;
}

/** `GET /api/demo/story`: where a story stands and whose turn it is. */
export interface DemoStory extends StoryInfo {
  subject?: string;
  steps: readonly StoryStep[];
  next?: {
    step: string;
    who: readonly DemoPersonaKey[];
    action: string;
    screen: StoryScreen;
    /** The workspace each of those people acts from, when it is not their own. */
    at?: Readonly<Partial<Record<DemoPersonaKey, string>>>;
  };
  finished: boolean;
}

/** One entry of `GET /api/demo/stories`. */
export interface StorySummary extends StoryInfo {
  status: 'not_started' | 'in_progress' | 'finished';
  stepCount: number;
  stepsDone: number;
  waitingFor: readonly DemoPersonaKey[];
  /** What happens, step by step. */
  steps?: readonly string[];
}

/** The story the demo opens with. */
export const DEFAULT_STORY = 'hiring';
const STORY_STORAGE_KEY = 'nexora.demo.story';
/** Fired in this browser when the viewer picks another story to follow. */
export const STORY_EVENT = 'nexora:story';

/** The story this viewer chose to follow (a per-browser convenience, nothing more). */
export function selectedStoryKey(): string {
  try {
    return window.localStorage.getItem(STORY_STORAGE_KEY) ?? DEFAULT_STORY;
  } catch {
    return DEFAULT_STORY;
  }
}

/** Follows another story from now on. */
export function selectStory(key: string): void {
  try {
    window.localStorage.setItem(STORY_STORAGE_KEY, key);
  } catch {
    // Storage is unavailable (private window): the choice lasts for this page only.
  }
  window.dispatchEvent(new CustomEvent(STORY_EVENT, { detail: key }));
}

/** Reads a guided story (derived on the server; the browser decides nothing). */
export function fetchDemoStory(key: string = DEFAULT_STORY): Promise<DemoStory> {
  return api<DemoStory>(`/demo/story?story=${encodeURIComponent(key)}`);
}

/** Reads every story line with where it stands. */
export async function fetchDemoStories(): Promise<StorySummary[]> {
  return (await api<{ stories: StorySummary[] }>('/demo/stories')).stories;
}

/** The same list for the demo's front door (no session needed in demo mode). */
export async function fetchDemoStorylines(): Promise<StorySummary[]> {
  return (await api<{ stories: StorySummary[] }>('/demo/storylines')).stories;
}
