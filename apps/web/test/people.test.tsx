/**
 * People & teams, and the page an invite link opens: the buttons that bring
 * people in appear only where the server said the caller may, a seat is shown
 * as what the person will work as, and nothing is joined before the person
 * says so.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  inviteLink,
  missingTeamKinds,
  teamSlug,
  type PeopleDirectory,
  type Team,
} from '../src/lib/people.js';
import { JoinView, type JoinState } from '../src/pages/Join.js';
import { InviteForm, listOf, PeopleView } from '../src/pages/People.js';
import { vacancyNote } from '../src/pages/Requests.js';

const scope = { organizationId: 'org_1', workspaceId: 'wsp_eng' };
const render = (node: JSX.Element): string =>
  renderToString(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, '');

const seats = (head: string, manager: string, member: string) => [
  { seat: 'owner', label: 'Team head', roleName: head },
  { seat: 'admin', label: 'Manager', roleName: manager },
  { seat: 'member', label: 'Team member', roleName: member },
];
const engineering: Team = {
  id: 'wsp_eng',
  name: 'Engineering',
  type: 'engineering',
  members: [
    {
      userId: 'u_dev',
      name: 'Dev Developer',
      seat: 'member',
      seatLabel: 'Team member',
      roleName: 'Developer',
      you: false,
    },
    {
      userId: 'u_founder',
      name: 'Farah Founder',
      seat: 'owner',
      seatLabel: 'Team head',
      roleName: 'CEO',
      you: true,
    },
  ],
  seats: seats('CEO', 'Delivery Manager', 'Developer'),
};
const people: Team = {
  id: 'wsp_hr',
  name: 'People',
  type: 'hr',
  members: [
    {
      userId: 'u_founder',
      name: 'Farah Founder',
      seat: 'executive',
      seatLabel: 'Chief executive (oversight)',
      roleName: 'CEO',
      you: true,
    },
  ],
  seats: seats('HR / CHRO', 'HR / CHRO', 'HR / CHRO'),
};
const directory = (overrides: Partial<PeopleDirectory> = {}): PeopleDirectory => ({
  teams: [engineering, people],
  invites: [],
  can: { invite: false, appointHeads: false, addTeam: false },
  ...overrides,
});
const view = (value: PeopleDirectory): string =>
  render(
    <PeopleView
      scope={scope}
      directory={value}
      origin="http://localhost:5174"
      onChanged={() => undefined}
    />,
  );

describe('PeopleView', () => {
  it('shows every team with its people, heads first, and what each seat means', () => {
    const html = view(directory());
    expect(html).toContain('Engineering');
    expect(html.indexOf('Farah Founder')).toBeLessThan(html.indexOf('Dev Developer'));
    expect(html).toContain('Team member, works as Developer');
    expect(html).toContain('(you)');
    // The founder only looks into People, which has no head of its own yet.
    expect(html).toContain('Chief executive, looking in');
    expect(html).toContain('No team head yet');
    expect(html).toContain('2 teams, 2 people');
    // A team named after its kind does not say it twice.
    expect(html.match(/>Engineering</g)?.length).toBe(1);
  });

  it('says which departments nobody holds yet, and where their steps go', () => {
    const html = view(directory());
    expect(html).toContain('No team yet for Technology and IT, Finance, Marketing, Sales,');
    expect(html).toContain('come to the chief executive');
    expect(html).toContain('Nobody approves their own request');
    expect(missingTeamKinds([{ type: 'engineering' }, { type: 'hr' }])).not.toContain(
      'People (HR)',
    );
  });

  it('offers inviting and adding a team only to those the server allows', () => {
    const member = view(directory());
    expect(member).not.toContain('Invite someone');
    expect(member).not.toContain('Add a team');
    const hr = view(directory({ can: { invite: true, appointHeads: false, addTeam: false } }));
    expect(hr).toContain('Invite someone');
    expect(hr).not.toContain('Add a team');
    const founder = view(directory({ can: { invite: true, appointHeads: true, addTeam: true } }));
    expect(founder).toContain('Invite someone');
    expect(founder).toContain('Add a team');
  });

  it('lists the invites still waiting, with the way to take one back', () => {
    const html = view(
      directory({
        can: { invite: true, appointHeads: true, addTeam: true },
        invites: [
          {
            id: 'inv_1',
            teamId: 'wsp_hr',
            teamName: 'People',
            seat: 'owner',
            seatLabel: 'Team head',
            roleName: 'HR / CHRO',
            label: 'Hema, head of People',
            status: 'open',
            createdAt: '2026-10-02T09:00:00.000Z',
            expiresAt: '2026-10-09T09:00:00.000Z',
          },
        ],
      }),
    );
    expect(html).toContain('Invites waiting to be opened');
    expect(html).toContain('Hema, head of People');
    expect(html).toContain('Team head in People, as HR / CHRO');
    expect(html).toContain('Take back');
  });
});

describe('InviteForm', () => {
  const form = (canAppointHeads: boolean): string =>
    render(
      <InviteForm
        scope={scope}
        teams={[engineering, people]}
        canAppointHeads={canAppointHeads}
        origin="http://localhost:5174"
        onClose={() => undefined}
        onChanged={() => undefined}
      />,
    );

  it('lets the chief executive appoint a head, and shows what each seat works as', () => {
    const html = form(true);
    expect(html).toContain('Team head');
    expect(html).toContain('Works as Delivery Manager');
    expect(html).toContain('Works as Developer');
    expect(html).toContain('Make invite link');
  });

  it('does not offer the head seat to anyone else, and says why', () => {
    const html = form(false);
    expect(html).not.toContain('>Team head<');
    expect(html).toContain('Only the chief executive can appoint a team head');
  });
});

describe('invite helpers', () => {
  it('builds the link a person opens and a slug the server accepts', () => {
    expect(inviteLink('http://localhost:5174', 'a_b-c')).toBe(
      'http://localhost:5174/join?code=a_b-c',
    );
    expect(teamSlug('People (HR)')).toBe('people-hr');
    expect(teamSlug('IT')).toBe('team-it');
    expect(teamSlug('  ')).toBe('team-new');
    expect(teamSlug('Customer   Support!!')).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('reads a list of departments the way a person would say it', () => {
    expect(listOf(['Finance'])).toBe('Finance');
    expect(listOf(['Finance', 'Legal'])).toBe('Finance and Legal');
    expect(listOf(['Finance', 'Sales', 'Legal'])).toBe('Finance, Sales and Legal');
  });

  it('explains a step whose seat nobody holds, to the executive and to everyone else', () => {
    expect(vacancyNote(true)).toContain('comes to you as chief executive');
    expect(vacancyNote(false)).toContain('cannot approve their own request');
  });
});

describe('JoinView', () => {
  const join = (state: JoinState, problem: string | null = null): string =>
    render(
      <JoinView
        state={state}
        joining={false}
        problem={problem}
        onSignIn={() => undefined}
        onJoin={() => undefined}
        onDecline={() => undefined}
      />,
    );
  const preview = {
    organizationId: 'org_1',
    organizationName: 'Acme',
    teamId: 'wsp_eng',
    teamName: 'Engineering',
    seatLabel: 'Team member',
    roleName: 'Developer',
    alreadyInTeam: false,
  };

  it('asks a signed-out person to sign in first, and joins nothing', () => {
    const html = join({ kind: 'signed_out' });
    expect(html).toContain('Sign in to continue');
    expect(html).not.toContain('Join the team');
  });

  it('shows the seat and what it works as before the person joins', () => {
    const html = join({ kind: 'ready', preview });
    expect(html).toContain('Join Engineering at Acme');
    expect(html).toContain('Team member');
    expect(html).toContain('Developer');
    expect(html).toContain('Join the team');
    expect(html).toContain('Not now');
  });

  it('says so when the link is used up, incomplete, or the person is already in', () => {
    expect(join({ kind: 'invalid', message: 'This invite link is not valid any more.' })).toContain(
      'This invite link is not valid any more.',
    );
    expect(join({ kind: 'missing' })).toContain('This invite link is incomplete');
    const already = join({ kind: 'ready', preview: { ...preview, alreadyInTeam: true } });
    expect(already).toContain('You are already in this team');
    expect(already).not.toContain('Join the team');
  });

  it('shows why joining failed without losing the invitation', () => {
    const html = join({ kind: 'ready', preview }, 'You are already in this team');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Join the team');
  });
});
