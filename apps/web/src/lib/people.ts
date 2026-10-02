/**
 * @nexora/app-web — people and teams client.
 *
 * Who sits where in the organization, and the one-time invite links that
 * bring a colleague into a seat. The server decides what the caller may do
 * (`can`) and what every seat means (`roleName`); the page only shows it.
 */

import { api } from './api.js';

/** A person in a team. */
export interface TeamMember {
  userId: string;
  name: string;
  seat: string;
  seatLabel: string;
  roleName: string;
  you: boolean;
}

/** A team and the people in it. */
export interface Team {
  id: string;
  name: string;
  type: string;
  members: readonly TeamMember[];
  /** What each seat of this team means, before anyone is invited to it. */
  seats: readonly { seat: string; label: string; roleName: string }[];
}

/** An invite link that has not been used yet. */
export interface OpenInvite {
  id: string;
  teamId: string;
  teamName: string;
  seat: string;
  seatLabel: string;
  roleName: string;
  label: string;
  status: 'open' | 'used' | 'revoked' | 'expired';
  createdAt: string;
  expiresAt: string;
}

/** The people page's read model. */
export interface PeopleDirectory {
  teams: readonly Team[];
  invites: readonly OpenInvite[];
  can: { invite: boolean; appointHeads: boolean; addTeam: boolean };
}

/** What an invite link would give the person opening it. */
export interface InvitePreview {
  organizationId: string;
  organizationName: string;
  teamId: string;
  teamName: string;
  seatLabel: string;
  roleName: string;
  alreadyInTeam: boolean;
}

/** The (organization, own seat) the caller acts from. */
export interface PeopleScope {
  organizationId: string;
  workspaceId?: string;
}

export function fetchPeople(scope: PeopleScope): Promise<PeopleDirectory> {
  const seat =
    scope.workspaceId === undefined ? '' : `&workspaceId=${encodeURIComponent(scope.workspaceId)}`;
  return api(`/people?organizationId=${encodeURIComponent(scope.organizationId)}${seat}`);
}

/** Makes an invite link. The secret `code` is returned once, here. */
export async function createInvite(
  scope: PeopleScope,
  input: { teamId: string; seat: string; label: string },
): Promise<OpenInvite & { code: string }> {
  const response = await api<{ invite: OpenInvite & { code: string } }>('/invites', {
    method: 'POST',
    body: JSON.stringify({ ...scope, ...input }),
  });
  return response.invite;
}

export function revokeInvite(scope: PeopleScope, inviteId: string): Promise<unknown> {
  return api(`/invites/${encodeURIComponent(inviteId)}/revoke`, {
    method: 'POST',
    body: JSON.stringify(scope),
  });
}

export function previewInvite(code: string): Promise<InvitePreview> {
  return api(`/invites/preview?code=${encodeURIComponent(code)}`);
}

export function acceptInvite(
  code: string,
): Promise<{ organizationId: string; workspaceId: string; teamName: string; roleName: string }> {
  return api('/invites/accept', { method: 'POST', body: JSON.stringify({ code }) });
}

export function addTeam(
  organizationId: string,
  input: { name: string; type: string },
): Promise<unknown> {
  return api('/workspaces', {
    method: 'POST',
    body: JSON.stringify({
      organizationId,
      name: input.name,
      slug: teamSlug(input.name),
      type: input.type,
    }),
  });
}

/** The kinds of team an office has, in office words. */
export const TEAM_KINDS: readonly { type: string; label: string; runs: string }[] = [
  { type: 'engineering', label: 'Engineering', runs: 'projects, tasks, bugs and releases' },
  { type: 'general', label: 'Technology and IT', runs: 'access, equipment and incidents' },
  { type: 'hr', label: 'People (HR)', runs: 'hiring, leave and reviews' },
  { type: 'finance', label: 'Finance', runs: 'purchases, expenses and budgets' },
  { type: 'marketing', label: 'Marketing', runs: 'campaigns and content' },
  { type: 'sales', label: 'Sales', runs: 'discounts and contracts' },
  { type: 'customer_success', label: 'Customer support', runs: 'tickets, escalations and refunds' },
  { type: 'legal', label: 'Legal', runs: 'contract and policy reviews' },
];

/** A team kind's office name ("People (HR)"), or the raw type when unknown. */
export function teamKindLabel(type: string): string {
  return TEAM_KINDS.find((kind) => kind.type === type)?.label ?? type.replace(/_/g, ' ');
}

/** The departments of an office that have no team yet. */
export function missingTeamKinds(teams: readonly Pick<Team, 'type'>[]): readonly string[] {
  const present = new Set(teams.map((team) => team.type));
  return TEAM_KINDS.filter((kind) => !present.has(kind.type)).map((kind) => kind.label);
}

/** A URL-safe slug for a new team's name. */
export function teamSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug.length >= 3 ? slug : `team-${slug === '' ? 'new' : slug}`;
}

/** The address an invited person opens. */
export function inviteLink(origin: string, code: string): string {
  return `${origin}/join?code=${encodeURIComponent(code)}`;
}

/** Where a link opened before signing in is kept until the person is back. */
const PENDING_KEY = 'nexora.invite';

export function rememberInvite(code: string): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, code);
  } catch {
    // Storage can be unavailable; the person can simply open the link again.
  }
}

export function pendingInvite(): string | null {
  try {
    return window.sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function forgetInvite(): void {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to forget.
  }
}
