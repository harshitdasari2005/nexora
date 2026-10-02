/**
 * @nexora/app-web — office workflows client.
 *
 * Every department's everyday work on one engine: a request follows the chain
 * its workflow defines (leave to the manager and HR, a campaign to the
 * marketing head, Finance and Legal, a customer problem to support and
 * engineering…). The server publishes the catalog, computes what the caller
 * may do with every request (`actions`), and the page only shows it.
 *
 * The assistant (`draft`, `brief`, `write`) only suggests; whatever it
 * produces is sent by a person through the same calls as anything typed.
 */

import { api } from './api.js';
import type { HiringScope } from './hiring.js';

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export type StageState = 'done' | 'current' | 'waiting' | 'skipped' | 'returned';
export type StageKind = 'decide' | 'do';
export type FieldType = 'text' | 'longtext' | 'date' | 'money' | 'number' | 'choice';

/** One field of a workflow's form. */
export interface WorkflowField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: readonly string[];
  placeholder?: string;
}

/** One workflow of the catalog. */
export interface Workflow {
  key: string;
  name: string;
  description: string;
  reasonLabel: string;
  fields: readonly WorkflowField[];
  stages: readonly { label: string; kind: StageKind }[];
}

/** The catalog: every department and its workflows. */
export interface WorkflowCatalog {
  departments: readonly { name: string; workflows: readonly Workflow[] }[];
  /** Whether an AI model is connected (otherwise the assistant works by plain rules). */
  assistant: { connected: boolean; model?: string };
}

/** A request as the caller may see it. */
export interface OfficeRequest {
  id: string;
  /** The workflow key. */
  type: string;
  /** The workflow's name ("Leave", "Marketing campaign"). */
  workflow: string;
  department: string;
  /** What it asks for, in one line. */
  summary: string;
  reasonLabel: string;
  reason: string;
  fields: readonly { label: string; value: string; long: boolean }[];
  status: RequestStatus;
  /** The stage it is waiting at. */
  pending?: {
    key: string;
    label: string;
    kind: StageKind;
    noteRequired: boolean;
    noteLabel?: string;
    /** Nobody in the organization holds this seat yet: it falls to the chief executive. */
    vacant?: boolean;
  };
  stages: readonly { key: string; label: string; kind: StageKind; state: StageState }[];
  requestedBy: string;
  requestedByName?: string;
  /** The caller raised this request. */
  mine: boolean;
  history: readonly {
    at: string;
    actorId: string;
    actorName?: string;
    action: 'submitted' | 'not_required' | 'approved' | 'rejected' | 'withdrawn' | 'assisted';
    stage?: string;
    stageLabel?: string;
    comment?: string;
  }[];
  createdAt: string;
  updatedAt: string;
  actions: { canDecide: boolean; decideBlockedReason?: string; canWithdraw: boolean };
}

/** A filled-in request suggested by the assistant. */
export interface RequestDraft {
  values: Record<string, string | number>;
  reason: string;
  source: 'ai' | 'rules';
}

/** What the assistant prepares for the person who must decide. */
export interface RequestBrief {
  recommendation: 'approve' | 'look_closer' | 'reject';
  summary: string;
  facts: readonly { label: string; value: string; tone: 'ok' | 'warn' | 'info' }[];
  source: 'ai' | 'rules';
}

const query = (scope: HiringScope): string =>
  `organizationId=${encodeURIComponent(scope.organizationId)}&workspaceId=${encodeURIComponent(scope.workspaceId)}`;
const post = <T>(path: string, scope: HiringScope, body: Record<string, unknown> = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify({ ...scope, ...body }) });

export function listRequests(
  scope: HiringScope,
): Promise<{ requests: OfficeRequest[]; canCreate: boolean }> {
  return api(`/requests?${query(scope)}`);
}

export function fetchCatalog(scope: HiringScope): Promise<WorkflowCatalog> {
  return api(`/requests/catalog?${query(scope)}`);
}

export function raiseRequest(
  scope: HiringScope,
  input: {
    type: string;
    reason: string;
    values: Record<string, string | number>;
    draftedWithAssistant: boolean;
  },
): Promise<unknown> {
  return post('/requests', scope, {
    type: input.type,
    reason: input.reason,
    values: input.values,
    ...(input.draftedWithAssistant ? { draftedWithAssistant: true } : {}),
  });
}

export function decideRequest(
  scope: HiringScope,
  id: string,
  decision: 'approve' | 'reject',
  comment: string,
): Promise<unknown> {
  const trimmed = comment.trim();
  return post(`/requests/${encodeURIComponent(id)}/decision`, scope, {
    decision,
    ...(trimmed.length === 0 ? {} : { comment: trimmed }),
  });
}

export function withdrawRequest(scope: HiringScope, id: string): Promise<unknown> {
  return post(`/requests/${encodeURIComponent(id)}/withdraw`, scope);
}

/** Asks the assistant to fill in a workflow's form from one sentence. */
export async function draftRequest(
  scope: HiringScope,
  type: string,
  sentence: string,
): Promise<RequestDraft> {
  return (await post<{ draft: RequestDraft }>('/requests/draft', scope, { type, sentence })).draft;
}

/** Asks the assistant to prepare the caller for the stage that is theirs. */
export async function briefRequest(scope: HiringScope, id: string): Promise<RequestBrief> {
  return (await post<{ brief: RequestBrief }>(`/requests/${encodeURIComponent(id)}/brief`, scope))
    .brief;
}

/** Asks the assistant to draft the written part of the caller's stage. */
export async function writeForRequest(
  scope: HiringScope,
  id: string,
): Promise<{ text: string; source: 'ai' | 'rules' }> {
  return (
    await post<{ written: { text: string; source: 'ai' | 'rules' } }>(
      `/requests/${encodeURIComponent(id)}/write`,
      scope,
    )
  ).written;
}

/** A request's name in a list: "Leave: 10 Nov, 14 Nov, vacation". */
export function requestTitle(request: Pick<OfficeRequest, 'workflow' | 'summary'>): string {
  return request.summary === '' ? request.workflow : `${request.workflow}: ${request.summary}`;
}

/** Where a request stands, in plain words. */
export function requestStatusLabel(request: Pick<OfficeRequest, 'status' | 'pending'>): string {
  switch (request.status) {
    case 'pending':
      return request.pending === undefined ? 'In progress' : `Now: ${request.pending.label}`;
    case 'approved':
      return 'Completed';
    case 'rejected':
      return 'Refused';
    case 'withdrawn':
      return 'Withdrawn';
  }
}

/** The route of a request: raised, then each stage. */
export function requestRoute(
  request: Pick<OfficeRequest, 'stages'>,
): { label: string; state: StageState }[] {
  return [
    { label: 'Raised', state: 'done' },
    ...request.stages.map((stage) => ({ label: stage.label, state: stage.state })),
  ];
}

/** How the assistant's help is described to the person. */
export function assistantSourceLabel(
  source: 'ai' | 'rules',
  assistant: WorkflowCatalog['assistant'],
): string {
  return source === 'ai'
    ? `Suggested by the assistant${assistant.model === undefined ? '' : ` (${assistant.model})`}. Check it before you send it.`
    : 'Filled in by plain rules: no AI model is connected. Check it before you send it.';
}

/** Turns the form's text inputs into the values the server expects. */
export function valuesFromForm(
  workflow: Workflow,
  form: Readonly<Record<string, string>>,
): { values: Record<string, string | number>; problem: string | null } {
  const values: Record<string, string | number> = {};
  for (const field of workflow.fields) {
    const raw = (form[field.key] ?? '').trim();
    if (raw === '') {
      if (field.required) return { values, problem: `${field.label} is needed.` };
      continue;
    }
    if (field.type === 'money' || field.type === 'number') {
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < 0 || (field.type === 'money' && amount <= 0)) {
        return { values, problem: `${field.label} must be a number.` };
      }
      values[field.key] = field.type === 'money' ? Math.round(amount * 100) : amount;
    } else {
      values[field.key] = raw;
    }
  }
  return { values, problem: null };
}

/** Turns suggested values back into what the form's inputs show. */
export function formFromValues(
  workflow: Workflow,
  values: Readonly<Record<string, string | number>>,
): Record<string, string> {
  const form: Record<string, string> = {};
  for (const field of workflow.fields) {
    const value = values[field.key];
    if (value === undefined) continue;
    form[field.key] =
      field.type === 'money' && typeof value === 'number' ? String(value / 100) : String(value);
  }
  return form;
}
