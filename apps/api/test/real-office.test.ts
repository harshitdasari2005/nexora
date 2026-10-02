/**
 * A real organization (no demo mode) through the real API: the founder
 * creates the organization and its teams, brings colleagues in with one-time
 * invite links, and the office workflows find the right person at every
 * stage, exactly as they do in the demo office.
 *
 * Covered: who may invite and to which seat, that a link works once, can be
 * taken back and expires, that the founder steps back to oversight when a
 * team's head joins, and that a stage whose seat nobody holds yet falls to
 * the chief executive (never to the requester themselves).
 */

import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

import type { RepositorySet } from '../src/container.js';
import { MultiIdentityGateway, type FakeWorkspaceInviteRepository } from './fakes.js';
import { buildTestApp, login } from './helpers.js';

interface PeopleView {
  teams: {
    id: string;
    name: string;
    type: string;
    members: { userId: string; name: string; seat: string; roleName: string; you: boolean }[];
    seats: { seat: string; label: string; roleName: string }[];
  }[];
  invites: { id: string; teamName: string; seatLabel: string; label: string; status: string }[];
  can: { invite: boolean; appointHeads: boolean; addTeam: boolean };
}
interface RequestView {
  id: string;
  status: string;
  pending?: { key: string; label: string; vacant?: boolean };
  actions: { canDecide: boolean; decideBlockedReason?: string };
}

const issuer = 'http://keycloak.test/realms/nexora';
const person = (subject: string, displayName: string) => ({
  subject,
  email: `${subject}@acme.test`,
  emailVerified: true,
  displayName,
  issuer,
});

describe('a real organization — teams, invite links and the chains', () => {
  let app: FastifyInstance;
  let repos: RepositorySet;
  // Signed in, in this order: the founder, an HR head, a developer, a stranger.
  let founder: string;
  let hema: string;
  let dev: string;
  let stranger: string;
  let organizationId: string;
  let engineering: string;
  let hr: string;

  const call = (
    method: 'GET' | 'POST',
    cookie: string,
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url,
      headers: { cookie, 'content-type': 'application/json' },
      ...(method === 'POST' ? { payload: payload ?? {} } : {}),
    });
  const people = async (cookie: string, workspaceId?: string) =>
    call(
      'GET',
      cookie,
      `/api/people?organizationId=${organizationId}${workspaceId === undefined ? '' : `&workspaceId=${workspaceId}`}`,
    );
  const invite = async (
    cookie: string,
    teamId: string,
    seat: string,
    label: string,
    workspaceId?: string,
  ) =>
    call('POST', cookie, '/api/invites', {
      organizationId,
      teamId,
      seat,
      label,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });
  const codeOf = (response: { json: () => unknown }) =>
    (response.json() as { invite: { code: string; id: string } }).invite;
  const accept = (cookie: string, code: string) =>
    call('POST', cookie, '/api/invites/accept', { code });
  const raise = (
    cookie: string,
    workspaceId: string,
    type: string,
    values: Record<string, unknown>,
  ) =>
    call('POST', cookie, '/api/requests', {
      organizationId,
      workspaceId,
      type,
      reason: 'Needed for the work.',
      values,
    });
  const decide = (cookie: string, workspaceId: string, id: string) =>
    call('POST', cookie, `/api/requests/${id}/decision`, {
      organizationId,
      workspaceId,
      decision: 'approve',
      comment: 'Fine by me.',
    });
  const seen = async (cookie: string, workspaceId: string, id: string) => {
    const response = await call(
      'GET',
      cookie,
      `/api/requests?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    return (response.json() as { requests: RequestView[] }).requests.find(
      (request) => request.id === id,
    );
  };

  beforeAll(async () => {
    ({ app, repos } = await buildTestApp({
      oidc: new MultiIdentityGateway([
        person('founder', 'Farah Founder'),
        person('hema', 'Hema HR'),
        person('dev', 'Dev Developer'),
        person('stranger', 'Sam Stranger'),
      ]),
    }));
    await app.ready();
    founder = await login(app);
    hema = await login(app);
    dev = await login(app);
    stranger = await login(app);

    const organization = await call('POST', founder, '/api/organizations', {
      name: 'Acme',
      slug: 'acme',
      type: 'startup',
    });
    organizationId = (organization.json() as { organization: { id: string } }).organization.id;
    const team = async (name: string, slug: string, type: string) => {
      const response = await call('POST', founder, '/api/workspaces', {
        organizationId,
        name,
        slug,
        type,
      });
      expect(response.statusCode).toBe(201);
      return (response.json() as { workspace: { id: string } }).workspace.id;
    };
    engineering = await team('Engineering', 'engineering', 'engineering');
    hr = await team('People', 'people', 'hr');
  });

  it('shows the founder running every team they created, and what each seat means', async () => {
    const view = (await people(founder)).json() as PeopleView;
    expect(view.can).toEqual({ invite: true, appointHeads: true, addTeam: true });
    expect(view.teams.map((team) => team.name).sort()).toEqual(['Engineering', 'People']);
    const peopleTeam = view.teams.find((team) => team.id === hr);
    expect(peopleTeam?.members).toEqual([
      expect.objectContaining({ name: 'Farah Founder', seat: 'owner', roleName: 'HR / CHRO' }),
    ]);
    expect(peopleTeam?.seats.map((seat) => seat.label)).toEqual([
      'Team head',
      'Manager',
      'Team member',
    ]);
    expect(view.invites).toEqual([]);
  });

  it('keeps people who are not in the organization out', async () => {
    expect((await people(stranger)).statusCode).toBe(403);
    expect((await invite(stranger, engineering, 'member', 'Me')).statusCode).toBe(403);
    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/people?organizationId=${organizationId}`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('brings a developer in with a link that works exactly once', async () => {
    const created = await invite(founder, engineering, 'member', 'Dev, backend developer');
    expect(created.statusCode).toBe(201);
    const { code } = codeOf(created);
    // Only the hash of the secret is kept.
    const stored = [...(repos.invites as FakeWorkspaceInviteRepository).rows.values()];
    expect(JSON.stringify(stored)).not.toContain(code);

    const preview = await call('GET', dev, `/api/invites/preview?code=${code}`);
    expect(preview.json()).toMatchObject({
      organizationName: 'Acme',
      teamName: 'Engineering',
      seatLabel: 'Team member',
      alreadyInTeam: false,
    });

    const joined = await accept(dev, code);
    expect(joined.statusCode).toBe(200);
    expect(joined.json()).toMatchObject({ organizationId, workspaceId: engineering });

    // The same link again, by anyone: gone.
    expect((await accept(stranger, code)).statusCode).toBe(404);
    expect((await call('GET', stranger, `/api/invites/preview?code=${code}`)).statusCode).toBe(404);

    const view = (await people(dev, engineering)).json() as PeopleView;
    expect(view.can).toEqual({ invite: false, appointHeads: false, addTeam: false });
    expect(view.invites).toEqual([]);
    expect(
      view.teams.find((team) => team.id === engineering)?.members.map((member) => member.name),
    ).toEqual(expect.arrayContaining(['Farah Founder', 'Dev Developer']));
    // A developer cannot bring anyone in.
    expect((await invite(dev, engineering, 'member', 'A friend', engineering)).statusCode).toBe(
      403,
    );
  });

  it('refuses a link that was taken back, expired, or made up', async () => {
    const takenBack = codeOf(await invite(founder, engineering, 'member', 'Changed our mind'));
    const revoke = await call('POST', founder, `/api/invites/${takenBack.id}/revoke`, {
      organizationId,
    });
    expect(revoke.statusCode).toBe(200);
    expect((await accept(stranger, takenBack.code)).statusCode).toBe(404);
    // Taking it back twice is refused.
    expect(
      (await call('POST', founder, `/api/invites/${takenBack.id}/revoke`, { organizationId }))
        .statusCode,
    ).toBe(409);

    const old = codeOf(await invite(founder, engineering, 'member', 'Too late'));
    const rows = (repos.invites as FakeWorkspaceInviteRepository).rows;
    const row = rows.get(old.id);
    if (row !== undefined) rows.set(old.id, { ...row, expiresAt: '2020-01-01T00:00:00.000Z' });
    expect((await accept(stranger, old.code)).statusCode).toBe(404);

    expect((await accept(stranger, 'x'.repeat(32))).statusCode).toBe(404);
    // A stranger who failed three times is still not in the organization.
    expect((await people(stranger)).statusCode).toBe(403);
  });

  it('covers a seat nobody holds yet with the chief executive, but never for their own request', async () => {
    // There is no Finance team: the finance stage of a purchase has no holder.
    const purchase = await raise(dev, engineering, 'purchase', {
      item: 'Test phones',
      amountMinorUnits: 4_500_000,
    });
    expect(purchase.statusCode).toBe(201);
    const id = (purchase.json() as { request: RequestView }).request.id;
    // The founder is the developer's manager (head of Engineering).
    expect((await decide(founder, engineering, id)).statusCode).toBe(200);
    const atFinance = await seen(founder, engineering, id);
    expect(atFinance?.pending).toMatchObject({ key: 'finance', vacant: true });
    expect(atFinance?.actions.canDecide).toBe(true);
    // The requester cannot take it, vacant or not.
    expect((await decide(dev, engineering, id)).statusCode).toBe(403);
    expect((await decide(founder, engineering, id)).statusCode).toBe(200);
    expect((await seen(dev, engineering, id))?.status).toBe('approved');

    // The founder's own purchase waits: nobody decides their own request.
    const own = await raise(founder, engineering, 'purchase', {
      item: 'A desk',
      amountMinorUnits: 900_000,
    });
    const ownId = (own.json() as { request: RequestView }).request.id;
    const waiting = await seen(founder, engineering, ownId);
    expect(waiting?.pending).toMatchObject({ key: 'finance', vacant: true });
    expect(waiting?.actions.canDecide).toBe(false);
    expect((await decide(founder, engineering, ownId)).statusCode).toBe(403);
  });

  it('appoints a team head, and the founder steps back to oversight', async () => {
    const created = await invite(founder, hr, 'owner', 'Hema, head of People');
    expect(created.statusCode).toBe(201);
    expect((await accept(hema, codeOf(created).code)).statusCode).toBe(200);

    const view = (await people(founder)).json() as PeopleView;
    const members = view.teams.find((team) => team.id === hr)?.members ?? [];
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Hema HR', seat: 'owner', roleName: 'HR / CHRO' }),
        expect.objectContaining({ name: 'Farah Founder', seat: 'executive' }),
      ]),
    );
    expect(members.find((member) => member.name === 'Farah Founder')?.roleName).not.toBe(
      'HR / CHRO',
    );
  });

  it('lets HR bring people in, but only the chief executive appoint a head', async () => {
    const view = (await people(hema, hr)).json() as PeopleView;
    expect(view.can).toEqual({ invite: true, appointHeads: false, addTeam: false });
    const member = await invite(hema, engineering, 'member', 'Next developer', hr);
    expect(member.statusCode).toBe(201);
    expect((await people(hema, hr)).json()).toMatchObject({
      invites: [expect.objectContaining({ label: 'Next developer', status: 'open' })],
    });
    const head = await invite(hema, engineering, 'owner', 'A friend of mine', hr);
    expect(head.statusCode).toBe(403);
    expect((head.json() as { error: { message: string } }).error.message).toBe(
      'Only the chief executive can appoint a team head',
    );
    // HR's seat counts only inside its own organization: without it, nothing.
    expect((await invite(hema, engineering, 'member', 'No seat named')).statusCode).toBe(403);
    // An executive's oversight seat is never something a link gives.
    expect((await invite(founder, hr, 'executive', 'Another boss')).statusCode).toBe(400);
  });

  it('runs a leave request through the real seats: the manager, then HR', async () => {
    const leave = await raise(dev, engineering, 'leave', {
      kind: 'vacation',
      startDate: '2026-11-10',
      endDate: '2026-11-14',
    });
    expect(leave.statusCode).toBe(201);
    const id = (leave.json() as { request: RequestView }).request.id;
    expect((await decide(founder, engineering, id)).statusCode).toBe(200);

    // HR has a head now, so the stage is hers: the founder no longer covers it.
    const forFounder = await seen(founder, engineering, id);
    expect(forFounder?.pending).toMatchObject({ key: 'hr' });
    expect(forFounder?.pending?.vacant).toBeUndefined();
    expect(forFounder?.actions.canDecide).toBe(false);
    expect((await decide(founder, hr, id)).statusCode).toBe(403);

    expect((await seen(hema, hr, id))?.actions.canDecide).toBe(true);
    expect((await decide(hema, hr, id)).statusCode).toBe(200);
    expect((await seen(dev, engineering, id))?.status).toBe('approved');
  });
});
