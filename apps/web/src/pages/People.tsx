/**
 * @nexora/app-web — People & teams page.
 *
 * Who sits where. A seat in a team decides what a person does in every
 * workflow, so this is where an organization is staffed: add a team, make a
 * one-time invite link for a seat, and see which departments have nobody yet
 * (their steps fall to the chief executive until someone joins).
 *
 * The server says what the caller may do (`can`) and re-checks every click.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button, Card, Field, Input, Select, Stack, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { Page, PageHeader, Section } from '../components/Page.js';
import { ApiError } from '../lib/api.js';
import {
  addTeam,
  createInvite,
  fetchPeople,
  inviteLink,
  missingTeamKinds,
  revokeInvite,
  TEAM_KINDS,
  teamKindLabel,
  type OpenInvite,
  type PeopleDirectory,
  type PeopleScope,
  type Team,
  type TeamMember,
} from '../lib/people.js';
import { useShellScope } from '../lib/useShellScope.js';

const errorText = (caught: unknown): string =>
  caught instanceof ApiError ? caught.message : 'That did not work — try again.';

const muted = { fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' } as const;

function day(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const EMPTY: PeopleDirectory = {
  teams: [],
  invites: [],
  can: { invite: false, appointHeads: false, addTeam: false },
};

/** The people and teams page. */
export function PeoplePage(): JSX.Element {
  const { dashboard, loading, error, reload } = useShellScope();
  const organizationId = dashboard?.organization?.id;
  const workspaceId = dashboard?.workspace?.id;
  const [state, setState] = useState<{
    directory: PeopleDirectory;
    loaded: boolean;
    error: string | null;
  }>({ directory: EMPTY, loaded: false, error: null });

  const load = useCallback(() => {
    if (organizationId === undefined) return;
    fetchPeople({ organizationId, ...(workspaceId === undefined ? {} : { workspaceId }) }).then(
      (directory) => setState({ directory, loaded: true, error: null }),
      (caught: unknown) =>
        setState((current) => ({ ...current, loaded: true, error: errorText(caught) })),
    );
  }, [organizationId, workspaceId]);
  useEffect(load, [load]);

  if (loading && dashboard === null) return <LoadingScreen />;
  if (error !== null) return <ErrorState message={error.message} onRetry={reload} />;
  if (dashboard === null) return <LoadingScreen />;
  if (dashboard.organization === null || dashboard.workspace === null) {
    return <ErrorState message="Create an organization and a workspace first." />;
  }
  const scope = { organizationId: dashboard.organization.id, workspaceId: dashboard.workspace.id };

  return (
    <AppShell
      user={dashboard.user}
      organizationName={dashboard.organization.name}
      workspaceName={dashboard.workspace.name}
      organizationId={scope.organizationId}
      workspaceId={scope.workspaceId}
    >
      {state.error !== null ? (
        <ErrorState message={state.error} onRetry={load} />
      ) : !state.loaded ? (
        <Page wide>
          <PageHeader title="People & teams" />
          <Card padding={5}>
            <p style={{ color: 'var(--nexora-textSecondary)' }}>Reading who sits where…</p>
          </Card>
        </Page>
      ) : (
        <PeopleView
          scope={scope}
          directory={state.directory}
          origin={window.location.origin}
          onChanged={() => {
            load();
            // A new team is a new seat for its creator: the shell re-reads it.
            reload();
          }}
        />
      )}
    </AppShell>
  );
}

/** Props of {@link PeopleView}. */
export interface PeopleViewProps {
  scope: PeopleScope;
  directory: PeopleDirectory;
  /** The address of this app, used to build the invite link. */
  origin: string;
  /** Called after any change so the page is read back from the server. */
  onChanged: () => void;
}

/** The pure page content (exported for tests). */
export function PeopleView({ scope, directory, origin, onChanged }: PeopleViewProps): JSX.Element {
  const { invites, can } = directory;
  const teams = inOfficeOrder(directory.teams);
  const [panel, setPanel] = useState<'invite' | 'team' | null>(null);
  const missing = missingTeamKinds(teams);
  const headcount = new Set(teams.flatMap((team) => team.members.map((member) => member.userId)))
    .size;

  return (
    <Page wide>
      <PageHeader
        title="People & teams"
        lede="Who sits where. A seat in a team decides what a person does in every workflow."
        actions={
          panel === null && (can.invite || can.addTeam) ? (
            <div className="nexora-actions">
              {can.addTeam ? (
                <Button variant="secondary" onClick={() => setPanel('team')}>
                  Add a team
                </Button>
              ) : null}
              {can.invite ? (
                <Button onClick={() => setPanel('invite')}>Invite someone</Button>
              ) : null}
            </div>
          ) : undefined
        }
      />

      {panel === 'invite' ? (
        <InviteForm
          scope={scope}
          teams={teams}
          canAppointHeads={can.appointHeads}
          origin={origin}
          onClose={() => setPanel(null)}
          onChanged={onChanged}
        />
      ) : null}
      {panel === 'team' ? (
        <TeamForm
          organizationId={scope.organizationId}
          onClose={() => setPanel(null)}
          onChanged={onChanged}
        />
      ) : null}

      {missing.length > 0 ? (
        <div className="nexora-inset" role="note">
          <span style={{ fontWeight: typography.weights.semibold }}>
            No team yet for {listOf(missing)}.
          </span>{' '}
          <span style={muted}>
            Until someone holds those seats, their steps in a workflow come to the chief executive.
            Nobody approves their own request.
          </span>
        </div>
      ) : null}

      {invites.length > 0 ? (
        <Section title="Invites waiting to be opened" count={invites.length}>
          <Card padding={0}>
            {invites.map((invite, index) => (
              <InviteRow
                key={invite.id}
                scope={scope}
                invite={invite}
                first={index === 0}
                onChanged={onChanged}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      <Section
        title="Teams"
        hint={`${teams.length} ${teams.length === 1 ? 'team' : 'teams'}, ${headcount} ${headcount === 1 ? 'person' : 'people'}`}
      >
        <div className="nexora-people-grid">
          {teams.map((team) => (
            <TeamCard key={team.id} team={team} />
          ))}
        </div>
      </Section>
    </Page>
  );
}

/** Teams in the order an office names its departments, then by name. */
export function inOfficeOrder(teams: readonly Team[]): readonly Team[] {
  const rank = (type: string): number => {
    const index = TEAM_KINDS.findIndex((kind) => kind.type === type);
    return index === -1 ? TEAM_KINDS.length : index;
  };
  return [...teams].sort((a, b) => rank(a.type) - rank(b.type) || a.name.localeCompare(b.name));
}

/** "Finance", "Finance and Legal", "Finance, Sales and Legal". */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/** What a person's seat means, in one line. */
export function seatLine(member: Pick<TeamMember, 'seat' | 'seatLabel' | 'roleName'>): string {
  if (member.seat === 'executive') return 'Chief executive, looking in';
  return member.seatLabel.toLowerCase() === member.roleName.toLowerCase()
    ? member.seatLabel
    : `${member.seatLabel}, works as ${member.roleName}`;
}

/** One team: its kind and the people in it, heads first. */
export function TeamCard({ team }: { team: Team }): JSX.Element {
  const order = ['owner', 'admin', 'member', 'executive'];
  const members = [...team.members].sort(
    (a, b) => order.indexOf(a.seat) - order.indexOf(b.seat) || a.name.localeCompare(b.name),
  );
  // A team is led by its head, or by a manager where there is no head.
  const hasLead = members.some((member) => member.seat === 'owner' || member.seat === 'admin');
  const kind = teamKindLabel(team.type);
  return (
    <Card padding={0}>
      <div style={{ padding: '16px 20px 12px' }}>
        <h3 className="nexora-section-title" style={{ margin: 0 }}>
          {team.name}
        </h3>
        {kind.toLowerCase() === team.name.toLowerCase() ? null : <div style={muted}>{kind}</div>}
      </div>
      <ul className="nexora-people-list">
        {members.map((member) => (
          <li key={member.userId}>
            <span className="nexora-people-initial" aria-hidden="true">
              {member.name.trim().charAt(0).toUpperCase()}
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ fontWeight: typography.weights.semibold }}>{member.name}</span>
              {member.you ? <span style={{ ...muted, marginLeft: 6 }}>(you)</span> : null}
              <span style={{ ...muted, display: 'block' }}>{seatLine(member)}</span>
            </span>
          </li>
        ))}
        {hasLead ? null : (
          <li>
            <span className="nexora-people-initial nexora-people-empty" aria-hidden="true" />
            <span style={muted}>No team head yet</span>
          </li>
        )}
      </ul>
    </Card>
  );
}

/** One unused invite, with the way to take it back. */
function InviteRow({
  scope,
  invite,
  first,
  onChanged,
}: {
  scope: PeopleScope;
  invite: OpenInvite;
  first: boolean;
  onChanged: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const takeBack = (): void => {
    setBusy(true);
    setProblem(null);
    revokeInvite(scope, invite.id)
      .then(onChanged, (caught: unknown) => setProblem(errorText(caught)))
      .finally(() => setBusy(false));
  };
  return (
    <div
      className="nexora-desk-row"
      style={first ? undefined : { borderTop: '1px solid var(--nexora-border)' }}
    >
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ fontWeight: typography.weights.semibold }}>{invite.label}</div>
        <div style={muted}>
          {invite.seatLabel} in {invite.teamName}, as {invite.roleName}. Works until{' '}
          {day(invite.expiresAt)}.
        </div>
        {problem === null ? null : (
          <div role="alert" style={{ ...muted, color: 'var(--nexora-danger)' }}>
            {problem}
          </div>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={takeBack} disabled={busy}>
        {busy ? 'Taking it back…' : 'Take back'}
      </Button>
    </div>
  );
}

/** Make an invite link: which team, which seat, who it is for. */
export function InviteForm({
  scope,
  teams,
  canAppointHeads,
  origin,
  onClose,
  onChanged,
}: {
  scope: PeopleScope;
  teams: readonly Team[];
  canAppointHeads: boolean;
  origin: string;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [seat, setSeat] = useState('member');
  const [label, setLabel] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [made, setMade] = useState<{ link: string; label: string; summary: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const team = teams.find((candidate) => candidate.id === teamId);
  const seats = (team?.seats ?? []).filter((option) => canAppointHeads || option.seat !== 'owner');

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (team === undefined) return setProblem('Choose the team.');
    if (label.trim().length < 2) return setProblem('Say who this invite is for.');
    setProblem(null);
    setSubmitting(true);
    try {
      const invite = await createInvite(scope, { teamId: team.id, seat, label: label.trim() });
      setMade({
        link: inviteLink(origin, invite.code),
        label: invite.label,
        summary: `${invite.seatLabel} in ${invite.teamName}, as ${invite.roleName}`,
      });
      setCopied(false);
      onChanged();
    } catch (caught) {
      setProblem(errorText(caught));
    } finally {
      setSubmitting(false);
    }
  };

  if (made !== null) {
    return (
      <Card padding={5}>
        <Stack gap={3} stretch>
          <h2 className="nexora-section-title">The invite link is ready</h2>
          <p style={{ ...muted, margin: 0 }}>
            For {made.label}: {made.summary}. The link works once, for seven days, and is shown only
            now. Whoever opens it and signs in takes the seat, so send it only to them.
          </p>
          <Input
            readOnly
            value={made.link}
            aria-label="Invite link"
            onFocus={(event) => event.target.select()}
          />
          <div className="nexora-actions">
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(made.link).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setMade(null);
                setLabel('');
              }}
            >
              Invite another person
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
          </div>
        </Stack>
      </Card>
    );
  }

  return (
    <Card padding={5}>
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap={4} stretch>
          <h2 className="nexora-section-title">Invite someone</h2>
          <div className="nexora-fields">
            <Field label="Team" required>
              <Select
                value={teamId}
                onChange={(event) => {
                  setTeamId(event.target.value);
                  setSeat('member');
                }}
              >
                {teams.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Who is it for" required hint="Only you see this note">
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Priya, the new designer"
                maxLength={120}
              />
            </Field>
          </div>
          <Field
            label="Seat"
            required
            hint={canAppointHeads ? undefined : 'Only the chief executive can appoint a team head'}
          >
            <div className="nexora-choice" role="radiogroup" aria-label="Seat">
              {seats.map((option) => (
                <button
                  key={option.seat}
                  type="button"
                  role="radio"
                  aria-checked={seat === option.seat}
                  className="nexora-choice-option"
                  onClick={() => setSeat(option.seat)}
                >
                  <span style={{ fontWeight: typography.weights.semibold }}>{option.label}</span>
                  <span style={muted}>Works as {option.roleName}</span>
                </button>
              ))}
            </div>
          </Field>
          {problem === null ? null : (
            <div
              role="alert"
              style={{ color: 'var(--nexora-danger)', fontSize: typography.sizes.sm }}
            >
              {problem}
            </div>
          )}
          <div className="nexora-actions">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Making the link…' : 'Make invite link'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </Stack>
      </form>
    </Card>
  );
}

/** Add a team: its name and what kind of work it runs. */
export function TeamForm({
  organizationId,
  onClose,
  onChanged,
}: {
  organizationId: string;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const [type, setType] = useState('hr');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const kind = TEAM_KINDS.find((candidate) => candidate.type === type);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const teamName = name.trim() === '' ? (kind?.label ?? '') : name.trim();
    if (teamName.length < 2) return setProblem('Give the team a name.');
    setProblem(null);
    setSubmitting(true);
    try {
      await addTeam(organizationId, { name: teamName, type });
      onChanged();
      onClose();
    } catch (caught) {
      setProblem(errorText(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card padding={5}>
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap={4} stretch>
          <h2 className="nexora-section-title">Add a team</h2>
          <div className="nexora-fields">
            <Field
              label="Kind of team"
              required
              hint={kind === undefined ? undefined : `Runs ${kind.runs}`}
            >
              <Select value={type} onChange={(event) => setType(event.target.value)}>
                {TEAM_KINDS.map((option) => (
                  <option key={option.type} value={option.type}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Name" hint="Leave empty to use the kind as the name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={kind?.label ?? 'Team name'}
                maxLength={80}
              />
            </Field>
          </div>
          <p style={{ ...muted, margin: 0 }}>
            You run a new team yourself until you invite its head. When the head joins, you keep an
            oversight seat there.
          </p>
          {problem === null ? null : (
            <div
              role="alert"
              style={{ color: 'var(--nexora-danger)', fontSize: typography.sizes.sm }}
            >
              {problem}
            </div>
          )}
          <div className="nexora-actions">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding the team…' : 'Add team'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </Stack>
      </form>
    </Card>
  );
}
