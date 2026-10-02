/**
 * @nexora/app-web — Requests page.
 *
 * The everyday requests of an office: leave, purchases, IT access. Each one
 * goes to the requester's manager first, then to the team that handles it
 * (HR, Finance or IT).
 *
 * The page shows what the backend says and nothing else: each request carries
 * the caller's `actions` (computed on the server from their role and the
 * request's state), so a button only appears for the person whose turn it is —
 * and the server re-checks every click anyway.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
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
import { ApiError } from '../lib/api.js';
import type { HiringScope } from '../lib/hiring.js';
import {
  decideRequest,
  listRequests,
  raiseRequest,
  requestRoute,
  requestStatusLabel,
  requestSummary,
  STAGE_LABEL,
  TYPE_CHAIN,
  TYPE_LABEL,
  withdrawRequest,
  type LeaveKind,
  type OfficeRequest,
  type RequestDetails,
  type RequestStatus,
  type RequestType,
} from '../lib/requests.js';
import { useShellScope } from '../lib/useShellScope.js';

const STATUS_TONE: Record<RequestStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
};
const DEFAULT_CURRENCY = 'INR';
const errorText = (caught: unknown): string =>
  caught instanceof ApiError ? caught.message : 'That did not work — try again.';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The requests page. */
export function RequestsPage(): JSX.Element {
  const { dashboard, loading, error, reload } = useShellScope();
  const organizationId = dashboard?.organization?.id;
  const workspaceId = dashboard?.workspace?.id;
  const [state, setState] = useState<{
    requests: OfficeRequest[];
    canCreate: boolean;
    loaded: boolean;
    error: string | null;
  }>({ requests: [], canCreate: false, loaded: false, error: null });

  const load = useCallback(() => {
    if (organizationId === undefined || workspaceId === undefined) return;
    listRequests({ organizationId, workspaceId }).then(
      (listed) => setState({ ...listed, loaded: true, error: null }),
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
        <Page>
          <PageHeader title="Requests" />
          <Card padding={5}>
            <p style={{ color: 'var(--nexora-textSecondary)' }}>Reading the requests…</p>
          </Card>
        </Page>
      ) : (
        <RequestsView
          scope={scope}
          requests={state.requests}
          canCreate={state.canCreate}
          onChanged={load}
        />
      )}
    </AppShell>
  );
}

/** Props of {@link RequestsView}. */
export interface RequestsViewProps {
  scope: HiringScope;
  requests: readonly OfficeRequest[];
  canCreate: boolean;
  /** Called after any change so the list is read back from the server. */
  onChanged: () => void;
}

/** The pure page content (exported for tests). */
export function RequestsView({
  scope,
  requests,
  canCreate,
  onChanged,
}: RequestsViewProps): JSX.Element {
  const [creating, setCreating] = useState(false);
  const toDecide = requests.filter((request) => request.actions.canDecide);
  const mine = requests.filter((request) => request.mine && !request.actions.canDecide);
  const others = requests.filter((request) => !request.mine && !request.actions.canDecide);

  return (
    <Page>
      <PageHeader
        title="Requests"
        lede="Leave, purchases and IT access. Every request goes to your manager first, then to the team that handles it."
        actions={
          canCreate && !creating ? (
            <Button onClick={() => setCreating(true)}>New request</Button>
          ) : undefined
        }
      />

      {creating ? (
        <RequestForm
          onCancel={() => setCreating(false)}
          onSubmit={async (details) => {
            await raiseRequest(scope, details);
            setCreating(false);
            onChanged();
          }}
        />
      ) : null}

      {requests.length === 0 && !creating ? (
        <Card padding={10}>
          <EmptyState
            icon={<NavIcon name="requests" size={18} />}
            title="No requests yet"
            description={
              canCreate
                ? 'Need time off, something bought, or access to a system? Raise a request and it goes to the right people.'
                : 'Requests you take part in will appear here.'
            }
          />
        </Card>
      ) : null}

      {toDecide.length > 0 ? (
        <Section title="Waiting for your decision" count={toDecide.length}>
          {toDecide.map((request) => (
            <RequestCard key={request.id} scope={scope} request={request} onChanged={onChanged} />
          ))}
        </Section>
      ) : null}

      {mine.length > 0 ? (
        <Section title="Your requests" count={mine.length}>
          {mine.map((request) => (
            <RequestCard key={request.id} scope={scope} request={request} onChanged={onChanged} />
          ))}
        </Section>
      ) : null}

      {others.length > 0 ? (
        <Section title="Other requests" count={others.length}>
          {others.map((request) => (
            <RequestCard key={request.id} scope={scope} request={request} onChanged={onChanged} />
          ))}
        </Section>
      ) : null}
    </Page>
  );
}

/** One request: what is asked, where it stands, and what the caller may do. */
export function RequestCard({
  scope,
  request,
  onChanged,
}: {
  scope: HiringScope;
  request: OfficeRequest;
  onChanged: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(request.actions.canDecide);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (label: string, work: () => Promise<unknown>): void => {
    setBusy(label);
    setError(null);
    work()
      .then(() => {
        setComment('');
        onChanged();
      })
      .catch((caught: unknown) => setError(errorText(caught)))
      .finally(() => setBusy(null));
  };

  const rejection = request.history.find((entry) => entry.action === 'rejected');
  return (
    <Card padding={5} className={request.actions.canDecide ? 'nexora-turn' : undefined}>
      <Stack gap={4} stretch>
        <div className="nexora-page-head" style={{ alignItems: 'flex-start' }}>
          <Stack gap={1}>
            <h3 style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.lg }}>
              {TYPE_LABEL[request.type]}: {requestSummary(request.details)}
            </h3>
            <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              {request.mine
                ? 'Raised by you.'
                : `Raised by ${request.requestedByName ?? 'a colleague'}.`}
            </div>
          </Stack>
          <div className="nexora-actions" style={{ gap: 8 }}>
            {request.actions.canDecide ? <TurnTag>Your decision</TurnTag> : null}
            <Badge tone={STATUS_TONE[request.status]}>{requestStatusLabel(request)}</Badge>
          </div>
        </div>

        <Route stops={requestRoute(request)} />

        <p style={{ color: 'var(--nexora-text)', overflowWrap: 'anywhere' }}>
          {request.details.reason}
        </p>
        {rejection?.comment === undefined ? null : (
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
            Rejected by {rejection.actorName ?? 'the approver'}: “{rejection.comment}”
          </p>
        )}

        {request.actions.canDecide ? (
          <Stack gap={3} stretch>
            <Field
              label="Comment"
              hint="Optional when approving. Required when rejecting — say why."
            >
              <Textarea
                rows={2}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={1000}
              />
            </Field>
            <div className="nexora-actions">
              <Button
                loading={busy === 'approve'}
                disabled={busy !== null}
                onClick={() =>
                  run('approve', () => decideRequest(scope, request.id, 'approve', comment))
                }
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                loading={busy === 'reject'}
                disabled={busy !== null || comment.trim().length < 3}
                onClick={() =>
                  run('reject', () => decideRequest(scope, request.id, 'reject', comment))
                }
              >
                Reject
              </Button>
            </div>
          </Stack>
        ) : null}

        <div className="nexora-actions">
          <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>
            {open ? 'Hide history' : 'Show history'}
          </Button>
          {request.actions.canWithdraw ? (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'withdraw'}
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm('Withdraw this request?')) {
                  run('withdraw', () => withdrawRequest(scope, request.id));
                }
              }}
            >
              Withdraw
            </Button>
          ) : null}
        </div>

        {open ? (
          <Stack gap={2} stretch>
            <SubHeading>History</SubHeading>
            {request.history.map((entry, index) => (
              <div
                key={`${entry.at}-${index}`}
                style={{
                  fontSize: typography.sizes.sm,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0 12px',
                }}
              >
                <span style={{ color: 'var(--nexora-textMuted)', flex: '0 0 130px' }}>
                  {formatWhen(entry.at)}
                </span>
                <span style={{ flex: '1 1 220px', minWidth: 0 }}>{historyLine(entry)}</span>
              </div>
            ))}
          </Stack>
        ) : null}

        {error !== null ? (
          <p role="alert" style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
            {error}
          </p>
        ) : null}
      </Stack>
    </Card>
  );
}

/** What a history entry says, in plain words. */
export function historyLine(entry: OfficeRequest['history'][number]): string {
  const who = entry.actorName ?? 'Someone';
  const stage = entry.stage === undefined ? '' : STAGE_LABEL[entry.stage];
  const note = entry.comment === undefined ? '' : ` — “${entry.comment}”`;
  switch (entry.action) {
    case 'submitted':
      return `${who} raised the request`;
    case 'not_required':
      return `${stage} decision not needed: ${who} holds that role`;
    case 'approved':
      return `${who} approved it (${stage})${note}`;
    case 'rejected':
      return `${who} rejected it (${stage})${note}`;
    case 'withdrawn':
      return `${who} withdrew the request`;
  }
}

/** Client-side checks that mirror the server's (the server remains authoritative). */
export function validateRequest(input: {
  type: RequestType;
  startDate: string;
  endDate: string;
  item: string;
  amount: string;
  what: string;
  reason: string;
}): string | null {
  if (input.type === 'leave') {
    if (input.startDate === '' || input.endDate === '') return 'Choose the first and last day.';
    if (input.endDate < input.startDate) return 'The last day cannot be before the first day.';
  }
  if (input.type === 'purchase') {
    if (input.item.trim().length < 2) return 'Say what should be bought.';
    const amount = Number(input.amount);
    if (input.amount.trim() === '' || !Number.isFinite(amount) || amount <= 0) {
      return 'Enter what it costs.';
    }
  }
  if (input.type === 'access' && input.what.trim().length < 2) {
    return 'Say what you need access to.';
  }
  if (input.reason.trim().length < 5) return 'Say why you are asking (a few words).';
  return null;
}

function RequestForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (details: RequestDetails) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [type, setType] = useState<RequestType>('leave');
  const [kind, setKind] = useState<LeaveKind>('vacation');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [item, setItem] = useState('');
  const [amount, setAmount] = useState('');
  const [what, setWhat] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const found = validateRequest({ type, startDate, endDate, item, amount, what, reason });
    setProblem(found);
    if (found !== null) return;
    const details: RequestDetails =
      type === 'leave'
        ? { type, kind, startDate, endDate, reason: reason.trim() }
        : type === 'purchase'
          ? {
              type,
              item: item.trim(),
              amountMinorUnits: Math.round(Number(amount) * 100),
              currency: DEFAULT_CURRENCY,
              reason: reason.trim(),
            }
          : { type, what: what.trim(), reason: reason.trim() };
    setSubmitting(true);
    try {
      await onSubmit(details);
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
          <h2 className="nexora-section-title">New request</h2>
          <div className="nexora-choice" role="radiogroup" aria-label="Kind of request">
            {(Object.keys(TYPE_LABEL) as RequestType[]).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={type === option}
                className="nexora-choice-option"
                onClick={() => setType(option)}
              >
                <span style={{ fontWeight: typography.weights.semibold }}>
                  {TYPE_LABEL[option]}
                </span>
                <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                  Your manager, then {STAGE_LABEL[TYPE_CHAIN[option][1] ?? 'manager']}
                </span>
              </button>
            ))}
          </div>

          {type === 'leave' ? (
            <div className="nexora-fields">
              <Field label="Kind of leave" required>
                <Select value={kind} onChange={(event) => setKind(event.target.value as LeaveKind)}>
                  <option value="vacation">Vacation</option>
                  <option value="sick">Sick leave</option>
                  <option value="personal">Personal leave</option>
                </Select>
              </Field>
              <Field label="First day" required>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </Field>
              <Field label="Last day" required>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </Field>
            </div>
          ) : null}

          {type === 'purchase' ? (
            <div className="nexora-fields">
              <Field label="What should be bought" required>
                <Input
                  value={item}
                  onChange={(event) => setItem(event.target.value)}
                  placeholder="Two Android test phones"
                  maxLength={160}
                />
              </Field>
              <Field label={`Cost (${DEFAULT_CURRENCY})`} required>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="45000"
                />
              </Field>
            </div>
          ) : null}

          {type === 'access' ? (
            <Field label="What do you need" required>
              <Input
                value={what}
                onChange={(event) => setWhat(event.target.value)}
                placeholder="Read access to the production logs"
                maxLength={160}
              />
            </Field>
          ) : null}

          <Field label="Why" required>
            <Textarea
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
            />
          </Field>

          {problem !== null ? (
            <p
              role="alert"
              style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}
            >
              {problem}
            </p>
          ) : null}
          <div className="nexora-actions">
            <Button type="submit" loading={submitting} disabled={submitting}>
              Send request
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </Stack>
      </form>
    </Card>
  );
}
