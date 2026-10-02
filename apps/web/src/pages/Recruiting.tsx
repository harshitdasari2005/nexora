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
  typography,
} from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
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
    <div style={{ padding: 32, maxWidth: 980, margin: '0 auto' }}>
      <Stack gap={6} stretch>
        <Stack gap={1}>
          <h1 style={{ fontSize: typography.sizes['3xl'], fontWeight: typography.weights.bold }}>
            Recruiting
          </h1>
          <p style={{ color: 'var(--nexora-textSecondary)' }}>
            {canManage
              ? 'Open a position for an approved hiring request, then take candidates from application to offer.'
              : 'The positions being hired for, their candidates and where each one stands.'}
          </p>
        </Stack>

        {ready.length > 0 ? (
          <Stack gap={3} stretch>
            <SectionTitle>Approved requests waiting for a position ({ready.length})</SectionTitle>
            {ready.map((requisition) => (
              <ReadyCard
                key={requisition.id}
                scope={scope}
                requisition={requisition}
                onChanged={onChanged}
              />
            ))}
          </Stack>
        ) : null}

        {openings.length === 0 && ready.length === 0 ? (
          <Card padding={10}>
            <EmptyState
              icon="🧑‍💼"
              title="Nothing to recruit for yet"
              description="A position appears here once a hiring request has been approved by the CEO and by Finance."
            />
          </Card>
        ) : null}

        {openings.length > 0 ? (
          <Stack gap={3} stretch>
            <SectionTitle>Positions</SectionTitle>
            {openings.map((opening) => (
              <OpeningCard key={opening.id} scope={scope} opening={opening} onChanged={onChanged} />
            ))}
          </Stack>
        ) : null}
      </Stack>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        fontSize: typography.sizes.xs,
        fontWeight: typography.weights.semibold,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--nexora-textMuted)',
      }}
    >
      {children}
    </div>
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
    <Card padding={5} data-testid="ready-requisition">
      <Stack gap={3} stretch>
        <Stack direction="row" justify="space-between" align="flex-start" gap={3}>
          <Stack gap={1}>
            <div style={{ fontWeight: typography.weights.semibold }}>
              {requisition.jobTitle} × {requisition.headcount}
            </div>
            <Muted>
              {requisition.department} · requested by {requisition.requestedByName ?? 'a manager'} ·
              approved range {money(requisition.salaryMinMinorUnits, requisition.currency)} –{' '}
              {money(requisition.salaryMaxMinorUnits, requisition.currency)}
            </Muted>
          </Stack>
          {!opening ? (
            <Button size="sm" onClick={() => setOpening(true)}>
              Open position
            </Button>
          ) : null}
        </Stack>
        {opening ? (
          <form onSubmit={(event) => void submit(event)}>
            <Stack gap={3} stretch>
              <Field label="Job posting" required hint="What candidates will read about the role.">
                <Input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Build and run the mobile banking backend services…"
                  maxLength={4000}
                />
              </Field>
              <ErrorLine message={error} />
              <Stack direction="row" gap={3}>
                <Button type="submit" size="sm" loading={busy} disabled={busy}>
                  Open position
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpening(false)}>
                  Cancel
                </Button>
              </Stack>
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
    <Card padding={5} data-testid="opening-card">
      <Stack gap={4} stretch>
        <Stack direction="row" justify="space-between" align="flex-start" gap={3}>
          <Stack gap={1}>
            <div style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.lg }}>
              {opening.title}
            </div>
            <Muted>
              {opening.department} · hiring manager {opening.hiringManagerName ?? '—'} ·{' '}
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
        </Stack>
        <Stack direction="row" gap={3} style={{ flexWrap: 'wrap' }}>
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
        </Stack>
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
                  + Add candidate
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

  const half = { flex: '1 1 200px' } as const;
  return (
    <Card padding={4} data-testid="add-candidate-form">
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap={3} stretch>
          <div style={{ fontWeight: typography.weights.semibold }}>Add a candidate</div>
          <Stack direction="row" gap={3} stretch style={{ flexWrap: 'wrap' }}>
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
          </Stack>
          <Stack direction="row" gap={3} stretch style={{ flexWrap: 'wrap' }}>
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
          </Stack>
          <Field label="Resume notes" hint="Optional — experience, skills, anything worth knowing.">
            <Input
              value={resumeNotes}
              onChange={(event) => setResumeNotes(event.target.value)}
              maxLength={4000}
            />
          </Field>
          <ErrorLine message={error} />
          <Stack direction="row" gap={3}>
            <Button type="submit" size="sm" loading={busy} disabled={busy}>
              Add candidate
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      </form>
    </Card>
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
    <Card padding={4} data-testid="candidate-card">
      <Stack gap={3} stretch>
        <Stack direction="row" justify="space-between" align="flex-start" gap={3}>
          <Stack gap={1}>
            <div style={{ fontWeight: typography.weights.semibold }}>{candidate.name}</div>
            <Muted>
              {candidate.email}
              {candidate.phone === undefined ? '' : ` · ${candidate.phone}`} ·{' '}
              {SOURCE_LABEL[candidate.source]}
            </Muted>
          </Stack>
          <Badge tone={STAGE_TONE[candidate.stage]}>{STAGE_LABEL[candidate.stage]}</Badge>
        </Stack>
        {candidate.resumeNotes === undefined ? null : <Muted>{candidate.resumeNotes}</Muted>}

        {candidate.feedback.length > 0 ? (
          <Stack gap={1} stretch>
            <SectionTitle>Interview feedback</SectionTitle>
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
          <Badge tone="success">Hired — an employee record was created</Badge>
        ) : null}

        <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
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
        </Stack>

        {panel === 'feedback' ? (
          <Stack gap={3} stretch>
            <Stack direction="row" gap={3} stretch style={{ flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 140px' }}>
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
              <div style={{ flex: '1 1 180px' }}>
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
            </Stack>
            <Field label="Notes" required>
              <Input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={2000}
              />
            </Field>
            <Stack direction="row" gap={3}>
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
            </Stack>
          </Stack>
        ) : null}

        {panel === 'offer' ? (
          <Stack gap={3} stretch>
            <Muted>
              Finance approved {money(opening.salaryMinMinorUnits, opening.currency)} –{' '}
              {money(opening.salaryMaxMinorUnits, opening.currency)} per year. The offer must be
              inside that range.
            </Muted>
            <Stack direction="row" gap={3} stretch style={{ flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px' }}>
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
              <div style={{ flex: '1 1 200px' }}>
                <Field label="Start date" required>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </Field>
              </div>
            </Stack>
            <Stack direction="row" gap={3}>
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
            </Stack>
          </Stack>
        ) : null}

        {panel === 'close' ? (
          <Stack gap={3} stretch>
            <Stack direction="row" gap={3} stretch style={{ flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 180px' }}>
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
              <div style={{ flex: '2 1 260px' }}>
                <Field label="Reason" required>
                  <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={500}
                  />
                </Field>
              </div>
            </Stack>
            <Stack direction="row" gap={3}>
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
            </Stack>
          </Stack>
        ) : null}

        <ErrorLine message={error} />
      </Stack>
    </Card>
  );
}
