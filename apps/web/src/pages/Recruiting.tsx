/**
 * @nexora/app-web — Recruiting page (HR's side of hiring).
 *
 * After the CEO and Finance approve a hiring request, HR opens the position
 * here, adds candidates, moves them through screening and interview, makes an
 * offer inside the approved terms and records the answer. The hiring manager
 * sees their own openings and gives interview feedback.
 *
 * Every button is driven by what the server says the caller may do
 * (`canManage`, each candidate's `actions`); offer amounts are simply absent
 * for callers who may not see pay. The server re-checks every click.
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Stack,
  Textarea,
  typography,
} from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { NavIcon } from '../components/NavIcon.js';
import { Page, PageHeader, Route, Section, SubHeading, TurnTag } from '../components/Page.js';
import { useDemo } from '../demo/demo-state.js';
import { api, ApiError } from '../lib/api.js';
import type { HiringScope } from '../lib/hiring.js';
import {
  addCandidate,
  advanceCandidate,
  changeOpening,
  closeCandidate,
  getOpening,
  giveFeedback,
  listOpenings,
  makeOffer,
  openPosition,
  OPENING_STATUS_LABEL,
  RECOMMENDATION_LABEL,
  recordOfferResponse,
  candidateRoute,
  seatSummary,
  STAGE_LABEL,
  type Candidate,
  type CandidateSource,
  type CandidateStage,
  type Opening,
  type ReadyRequisition,
  type Recommendation,
} from '../lib/recruiting.js';
import type { DashboardResponse } from '../lib/types.js';
import { useSession } from '../session.js';

const SOURCE_LABEL: Record<CandidateSource, string> = {
  referral: 'Referral',
  job_board: 'Job board',
  agency: 'Agency',
  internal: 'Internal',
  other: 'Other',
};
const STAGE_TONE: Record<CandidateStage, 'neutral' | 'warning' | 'success' | 'danger'> = {
  applied: 'neutral',
  screening: 'neutral',
  interview: 'warning',
  offer: 'warning',
  hired: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
};

function money(minorUnits: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(minorUnits / 100);
  } catch {
    return `${currency} ${(minorUnits / 100).toLocaleString('en-IN')}`;
  }
}

const errorText = (caught: unknown): string =>
  caught instanceof ApiError ? caught.message : 'That did not work — try again.';

/** The recruiting page. */
export function Recruiting(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    openings: Opening[];
    ready: ReadyRequisition[];
    canManage: boolean;
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, openings: [], ready: [], canManage: false, loading: true, error: null });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const params = new URLSearchParams();
      const organizationId = searchParams.get('organizationId');
      const workspaceId = searchParams.get('workspaceId');
      if (organizationId !== null) params.set('organizationId', organizationId);
      if (workspaceId !== null) params.set('workspaceId', workspaceId);
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      const dashboard = await api<DashboardResponse>(`/dashboard${suffix}`);
      if (dashboard.organization === null || dashboard.workspace === null) {
        setState((current) => ({ ...current, dashboard, loading: false }));
        return;
      }
      const listed = await listOpenings({
        organizationId: dashboard.organization.id,
        workspaceId: dashboard.workspace.id,
      });
      setState({
        dashboard,
        openings: listed.openings,
        ready: listed.readyRequisitions,
        canManage: listed.canManage,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error:
          error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
      }));
    }
  }, [searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.loading && state.dashboard === null) return <LoadingScreen />;
  if (state.error !== null) {
    return <ErrorState message={state.error.message} onRetry={() => void load()} />;
  }
  const { dashboard } = state;
  if (dashboard === null || session === null) return <LoadingScreen />;
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
      <RecruitingView
        scope={scope}
        openings={state.openings}
        ready={state.ready}
        canManage={state.canManage}
        onChanged={() => void load()}
      />
    </AppShell>
  );
}

/** Props of {@link RecruitingView}. */
export interface RecruitingViewProps {
  scope: HiringScope;
  openings: readonly Opening[];
  ready: readonly ReadyRequisition[];
  canManage: boolean;
  onChanged: () => void;
}

/** The pure page content (exported for tests). */
export function RecruitingView({
  scope,
  openings,
  ready,
  canManage,
  onChanged,
}: RecruitingViewProps): JSX.Element {
  return (
    <Page>
      <PageHeader
        title="Recruiting"
        lede={
          canManage
            ? 'Open a position for an approved hiring request, then take candidates from application to offer.'
            : 'The positions being hired for, their candidates and where each one stands.'
        }
      />

      {ready.length > 0 ? (
        <Section title="Approved and waiting for a position" count={ready.length}>
          {ready.map((requisition) => (
            <ReadyCard
              key={requisition.id}
              scope={scope}
              requisition={requisition}
              onChanged={onChanged}
            />
          ))}
        </Section>
      ) : null}

      {openings.length === 0 && ready.length === 0 ? (
        <Card padding={10}>
          <EmptyState
            icon={<NavIcon name="recruiting" size={18} />}
            title="Nothing to recruit for yet"
            description="A position appears here once a hiring request has been approved by the CEO and by Finance."
          />
        </Card>
      ) : null}

      {openings.length > 0 ? (
        <Section title="Positions" count={openings.length}>
          {openings.map((opening) => (
            <OpeningCard key={opening.id} scope={scope} opening={opening} onChanged={onChanged} />
          ))}
        </Section>
      ) : null}
    </Page>
  );
}

function Muted({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
      {children}
    </div>
  );
}

function ErrorLine({ message }: { message: string | null }): JSX.Element | null {
  return message === null ? null : (
    <p role="alert" style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
      {message}
    </p>
  );
}

/** An approved hiring request HR can open a position for. */
function ReadyCard({
  scope,
  requisition,
  onChanged,
}: {
  scope: HiringScope;
  requisition: ReadyRequisition;
  onChanged: () => void;
}): JSX.Element {
  const [opening, setOpening] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const example = useDemo().config?.story.hiring;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (description.trim().length < 10) {
      setError('Describe the role in at least 10 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await openPosition(scope, requisition.id, description.trim());
      onChanged();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding={5} className="nexora-turn">
      <Stack gap={3} stretch>
        <div className="nexora-page-head" style={{ alignItems: 'flex-start' }}>
          <Stack gap={1}>
            <h3 style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.lg }}>
              {requisition.jobTitle}
              {requisition.headcount > 1 ? ` × ${requisition.headcount}` : ''}
            </h3>
            <Muted>
              For {requisition.department}, raised by {requisition.requestedByName ?? 'a manager'}.
              Approved range {money(requisition.salaryMinMinorUnits, requisition.currency)} –{' '}
              {money(requisition.salaryMaxMinorUnits, requisition.currency)}.
            </Muted>
          </Stack>
          <div className="nexora-actions">
            <TurnTag>Ready for you</TurnTag>
            {!opening ? <Button onClick={() => setOpening(true)}>Open position</Button> : null}
          </div>
        </div>
        {opening ? (
          <form onSubmit={(event) => void submit(event)}>
            <Stack gap={3} stretch>
              <Field label="Job posting" required hint="What candidates will read about the role.">
                <Textarea
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Build and run the mobile banking backend services…"
                  maxLength={4000}
                />
              </Field>
              <ErrorLine message={error} />
              <div className="nexora-actions">
                <Button type="submit" size="sm" loading={busy} disabled={busy}>
                  Open position
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpening(false)}>
                  Cancel
                </Button>
                {example === undefined ? null : (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setDescription(example.jobPosting)}
                  >
                    Fill in the demo example
                  </Button>
                )}
              </div>
            </Stack>
          </form>
        ) : null}
      </Stack>
    </Card>
  );
}

/** One position: its seats, its candidates and (for HR) its controls. */
function OpeningCard({
  scope,
  opening,
  onChanged,
}: {
  scope: HiringScope;
  opening: Opening;
  onChanged: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCandidates = useCallback(async () => {
    try {
      const detail = await getOpening(scope, opening.id);
      setCandidates(detail.candidates);
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [scope, opening.id]);

  const refresh = async (): Promise<void> => {
    await loadCandidates();
    onChanged();
  };

  const status = async (action: 'hold' | 'resume' | 'close'): Promise<void> => {
    const reason =
      action === 'close' ? (window.prompt('Why is this position being closed?') ?? '') : undefined;
    if (action === 'close' && (reason ?? '').trim().length < 3) return;
    try {
      await changeOpening(scope, opening.id, action, reason);
      onChanged();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <Card padding={5}>
      <Stack gap={4} stretch>
        <div className="nexora-page-head" style={{ alignItems: 'flex-start' }}>
          <Stack gap={1}>
            <h3 style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.lg }}>
              {opening.title}
            </h3>
            <Muted>
              For {opening.department}. Hiring manager: {opening.hiringManagerName ?? 'not set'}.{' '}
              {seatSummary(opening)}
            </Muted>
          </Stack>
          <Badge
            tone={
              opening.status === 'open'
                ? 'warning'
                : opening.status === 'filled'
                  ? 'success'
                  : 'neutral'
            }
          >
            {OPENING_STATUS_LABEL[opening.status]}
          </Badge>
        </div>
        <div className="nexora-actions">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setOpen((value) => !value);
              if (!open && candidates === null) void loadCandidates();
            }}
          >
            {open ? 'Hide candidates' : 'View candidates'}
          </Button>
          {opening.canManage && opening.status === 'open' ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => void status('hold')}>
                Put on hold
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void status('close')}>
                Close position
              </Button>
            </>
          ) : null}
          {opening.canManage && opening.status === 'on_hold' ? (
            <Button size="sm" variant="ghost" onClick={() => void status('resume')}>
              Resume recruiting
            </Button>
          ) : null}
        </div>
        <ErrorLine message={error} />

        {open ? (
          <Stack gap={3} stretch>
            <Muted>{opening.description}</Muted>
            <Muted>
              Approved salary range: {money(opening.salaryMinMinorUnits, opening.currency)} –{' '}
              {money(opening.salaryMaxMinorUnits, opening.currency)}
            </Muted>
            {opening.canManage && opening.status === 'open' && !adding ? (
              <div>
                <Button size="sm" onClick={() => setAdding(true)}>
                  Add candidate
                </Button>
              </div>
            ) : null}
            {adding ? (
              <AddCandidateForm
                onCancel={() => setAdding(false)}
                onSubmit={async (input) => {
                  await addCandidate(scope, opening.id, input);
                  setAdding(false);
                  await refresh();
                }}
              />
            ) : null}
            {candidates === null ? (
              <Muted>Loading candidates…</Muted>
            ) : candidates.length === 0 ? (
              <Muted>No candidates yet.</Muted>
            ) : (
              candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  scope={scope}
                  candidate={candidate}
                  opening={opening}
                  onChanged={() => void refresh()}
                />
              ))
            )}
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

function AddCandidateForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: {
    name: string;
    email: string;
    phone?: string;
    source: CandidateSource;
    resumeNotes?: string;
  }) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState<CandidateSource>('referral');
  const [resumeNotes, setResumeNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const example = useDemo().config?.story.hiring;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter the candidate’s name and a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        email: email.trim(),
        ...(phone.trim() === '' ? {} : { phone: phone.trim() }),
        source,
        ...(resumeNotes.trim() === '' ? {} : { resumeNotes: resumeNotes.trim() }),
      });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const half = { minWidth: 0 } as const;
  return (
    <div className="nexora-inset">
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap={3} stretch>
          <SubHeading>Add a candidate</SubHeading>
          <div className="nexora-fields">
            <div style={half}>
              <Field label="Name" required>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={160}
                />
              </Field>
            </div>
            <div style={half}>
              <Field label="Email" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength={254}
                />
              </Field>
            </div>
          </div>
          <div className="nexora-fields">
            <div style={half}>
              <Field label="Phone" hint="Optional">
                <Input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  maxLength={40}
                />
              </Field>
            </div>
            <div style={half}>
              <Field label="Where they came from" required>
                <Select
                  value={source}
                  onChange={(event) => setSource(event.target.value as CandidateSource)}
                >
                  {Object.entries(SOURCE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
          <Field label="Resume notes" hint="Optional — experience, skills, anything worth knowing.">
            <Textarea
              rows={2}
              value={resumeNotes}
              onChange={(event) => setResumeNotes(event.target.value)}
              maxLength={4000}
            />
          </Field>
          <ErrorLine message={error} />
          <div className="nexora-actions">
            <Button type="submit" size="sm" loading={busy} disabled={busy}>
              Add candidate
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            {example === undefined ? null : (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  setName(example.candidateName);
                  setEmail(example.candidateEmail);
                }}
              >
                Fill in the demo example
              </Button>
            )}
          </div>
        </Stack>
      </form>
    </div>
  );
}

type Panel = 'feedback' | 'offer' | 'close' | null;

/** One candidate: where they stand, what was said, and what the caller may do next. */
export function CandidateCard({
  scope,
  candidate,
  opening,
  onChanged,
}: {
  scope: HiringScope;
  candidate: Candidate;
  opening: Pick<Opening, 'salaryMinMinorUnits' | 'salaryMaxMinorUnits' | 'currency'>;
  onChanged: () => void;
}): JSX.Element {
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Feedback form
  const [rating, setRating] = useState('4');
  const [recommendation, setRecommendation] = useState<Recommendation>('yes');
  const [notes, setNotes] = useState('');
  // Offer form
  const [salary, setSalary] = useState('');
  const [startDate, setStartDate] = useState('');
  // Close form
  const [outcome, setOutcome] = useState<'reject' | 'withdraw'>('reject');
  const [reason, setReason] = useState('');

  const run = async (label: string, work: () => Promise<unknown>): Promise<void> => {
    setBusy(label);
    setError(null);
    try {
      await work();
      setPanel(null);
      onChanged();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  const { actions } = candidate;
  return (
    <div className="nexora-inset">
      <Stack gap={3} stretch>
        <div className="nexora-page-head" style={{ alignItems: 'flex-start' }}>
          <Stack gap={1}>
            <h4 style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.md }}>
              {candidate.name}
            </h4>
            <Muted>
              {candidate.email}
              {candidate.phone === undefined ? '' : `, ${candidate.phone}`}. Came through:{' '}
              {SOURCE_LABEL[candidate.source].toLowerCase()}.
            </Muted>
          </Stack>
          <Badge tone={STAGE_TONE[candidate.stage]}>{STAGE_LABEL[candidate.stage]}</Badge>
        </div>
        {candidateRoute(candidate.stage) === undefined ? null : (
          <Route stops={candidateRoute(candidate.stage) ?? []} />
        )}
        {candidate.resumeNotes === undefined ? null : <Muted>{candidate.resumeNotes}</Muted>}

        {candidate.feedback.length > 0 ? (
          <Stack gap={1} stretch>
            <SubHeading>Interview feedback</SubHeading>
            {candidate.feedback.map((entry, index) => (
              <div key={`${entry.by}-${index}`} style={{ fontSize: typography.sizes.sm }}>
                <strong>{entry.byName ?? 'An interviewer'}</strong> ({entry.stage}) — {entry.rating}
                /5, {RECOMMENDATION_LABEL[entry.recommendation]}: {entry.notes}
              </div>
            ))}
          </Stack>
        ) : null}

        {candidate.offer !== undefined ? (
          <Muted>
            Offer: {money(candidate.offer.salaryMinorUnits, candidate.offer.currency)} per year,
            starting {candidate.offer.startDate} — {candidate.offer.status}
            {candidate.offer.responseNote === undefined ? '' : ` (${candidate.offer.responseNote})`}
          </Muted>
        ) : candidate.offerStatus !== undefined ? (
          <Muted>Offer: {candidate.offerStatus}</Muted>
        ) : null}
        {candidate.closedReason !== undefined && candidate.stage !== 'hired' ? (
          <Muted>Reason: {candidate.closedReason}</Muted>
        ) : null}
        {candidate.stage === 'hired' ? (
          <Badge tone="success" style={{ alignSelf: 'flex-start' }}>
            Hired, employee record created
          </Badge>
        ) : null}

        <div className="nexora-actions">
          {actions.canAdvance && candidate.nextStage !== undefined ? (
            <Button
              size="sm"
              loading={busy === 'advance'}
              disabled={busy !== null}
              onClick={() => void run('advance', () => advanceCandidate(scope, candidate.id))}
            >
              Move to {STAGE_LABEL[candidate.nextStage].toLowerCase()}
            </Button>
          ) : null}
          {actions.canGiveFeedback ? (
            <Button size="sm" variant="secondary" onClick={() => setPanel('feedback')}>
              Give feedback
            </Button>
          ) : null}
          {actions.canOffer ? (
            <Button size="sm" onClick={() => setPanel('offer')}>
              Make offer
            </Button>
          ) : null}
          {actions.canRecordResponse ? (
            <>
              <Button
                size="sm"
                loading={busy === 'accept'}
                disabled={busy !== null}
                onClick={() =>
                  void run('accept', () => recordOfferResponse(scope, candidate.id, 'accept'))
                }
              >
                Candidate accepted
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={busy === 'decline'}
                disabled={busy !== null}
                onClick={() =>
                  void run('decline', () => recordOfferResponse(scope, candidate.id, 'decline'))
                }
              >
                Candidate declined
              </Button>
            </>
          ) : null}
          {actions.canClose ? (
            <Button size="sm" variant="ghost" onClick={() => setPanel('close')}>
              Reject / withdrew
            </Button>
          ) : null}
        </div>

        {panel === 'feedback' ? (
          <Stack gap={3} stretch>
            <div className="nexora-fields">
              <div style={{ minWidth: 0 }}>
                <Field label="Rating (1–5)" required>
                  <Select value={rating} onChange={(event) => setRating(event.target.value)}>
                    {['1', '2', '3', '4', '5'].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div style={{ minWidth: 0 }}>
                <Field label="Would you hire them?" required>
                  <Select
                    value={recommendation}
                    onChange={(event) => setRecommendation(event.target.value as Recommendation)}
                  >
                    {Object.entries(RECOMMENDATION_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>
            <Field label="Notes" required>
              <Textarea
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={2000}
              />
            </Field>
            <div className="nexora-actions">
              <Button
                size="sm"
                loading={busy === 'feedback'}
                disabled={busy !== null || notes.trim().length < 5}
                onClick={() =>
                  void run('feedback', () =>
                    giveFeedback(scope, candidate.id, {
                      rating: Number(rating),
                      recommendation,
                      notes: notes.trim(),
                    }),
                  )
                }
              >
                Save feedback
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </Stack>
        ) : null}

        {panel === 'offer' ? (
          <Stack gap={3} stretch>
            <Muted>
              Finance approved {money(opening.salaryMinMinorUnits, opening.currency)} –{' '}
              {money(opening.salaryMaxMinorUnits, opening.currency)} per year. The offer must be
              inside that range.
            </Muted>
            <div className="nexora-fields">
              <div style={{ minWidth: 0 }}>
                <Field label={`Salary (${opening.currency} / year)`} required>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={salary}
                    onChange={(event) => setSalary(event.target.value)}
                  />
                </Field>
              </div>
              <div style={{ minWidth: 0 }}>
                <Field label="Start date" required>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </Field>
              </div>
            </div>
            <div className="nexora-actions">
              <Button
                size="sm"
                loading={busy === 'offer'}
                disabled={busy !== null || salary.trim() === '' || startDate === ''}
                onClick={() =>
                  void run('offer', () =>
                    makeOffer(scope, candidate.id, {
                      salaryMinorUnits: Math.round(Number(salary) * 100),
                      startDate,
                    }),
                  )
                }
              >
                Send offer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </Stack>
        ) : null}

        {panel === 'close' ? (
          <Stack gap={3} stretch>
            <div className="nexora-fields">
              <div style={{ minWidth: 0 }}>
                <Field label="What happened?" required>
                  <Select
                    value={outcome}
                    onChange={(event) => setOutcome(event.target.value as 'reject' | 'withdraw')}
                  >
                    <option value="reject">We are rejecting the candidate</option>
                    <option value="withdraw">The candidate withdrew</option>
                  </Select>
                </Field>
              </div>
              <div style={{ minWidth: 0 }}>
                <Field label="Reason" required>
                  <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={500}
                  />
                </Field>
              </div>
            </div>
            <div className="nexora-actions">
              <Button
                size="sm"
                variant="secondary"
                loading={busy === 'close'}
                disabled={busy !== null || reason.trim().length < 3}
                onClick={() =>
                  void run('close', () =>
                    closeCandidate(scope, candidate.id, outcome, reason.trim()),
                  )
                }
              >
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </Stack>
        ) : null}

        <ErrorLine message={error} />
      </Stack>
    </div>
  );
}
