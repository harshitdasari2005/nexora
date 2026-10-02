/**
 * @nexora/app-web — Office workflows page.
 *
 * Every department's everyday work in one place: pick a workflow, fill it in
 * (or describe it in a sentence and let the assistant fill it in), and it
 * travels its chain — each stage to the person who holds that seat.
 *
 * The page shows what the backend says and nothing else: the catalog of
 * workflows comes from the server, and each request carries the caller's
 * `actions`, so a button only appears for the person whose turn it is — and
 * the server re-checks every click anyway. The assistant only suggests: what
 * it writes lands in a form the person reads, edits and sends themselves.
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
import { Fact, Page, PageHeader, Route, Section, SubHeading, TurnTag } from '../components/Page.js';
import { ApiError } from '../lib/api.js';
import type { HiringScope } from '../lib/hiring.js';
import {
  assistantSourceLabel,
  briefRequest,
  decideRequest,
  draftRequest,
  fetchCatalog,
  formFromValues,
  listRequests,
  raiseRequest,
  requestRoute,
  requestStatusLabel,
  requestTitle,
  valuesFromForm,
  withdrawRequest,
  writeForRequest,
  type OfficeRequest,
  type RequestBrief,
  type RequestStatus,
  type Workflow,
  type WorkflowCatalog,
} from '../lib/requests.js';
import { useShellScope } from '../lib/useShellScope.js';

const STATUS_TONE: Record<RequestStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
};
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

/** The office workflows page. */
export function RequestsPage(): JSX.Element {
  const { dashboard, loading, error, reload } = useShellScope();
  const organizationId = dashboard?.organization?.id;
  const workspaceId = dashboard?.workspace?.id;
  const [state, setState] = useState<{
    requests: OfficeRequest[];
    canCreate: boolean;
    catalog: WorkflowCatalog | null;
    loaded: boolean;
    error: string | null;
  }>({ requests: [], canCreate: false, catalog: null, loaded: false, error: null });

  const load = useCallback(() => {
    if (organizationId === undefined || workspaceId === undefined) return;
    const scope = { organizationId, workspaceId };
    Promise.all([listRequests(scope), fetchCatalog(scope)]).then(
      ([listed, catalog]) => setState({ ...listed, catalog, loaded: true, error: null }),
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
      ) : !state.loaded || state.catalog === null ? (
        <Page>
          <PageHeader title="Office workflows" />
          <Card padding={5}>
            <p style={{ color: 'var(--nexora-textSecondary)' }}>Reading the workflows…</p>
          </Card>
        </Page>
      ) : (
        <RequestsView
          scope={scope}
          requests={state.requests}
          canCreate={state.canCreate}
          catalog={state.catalog}
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
  catalog: WorkflowCatalog;
  /** Called after any change so the list is read back from the server. */
  onChanged: () => void;
}

/** The pure page content (exported for tests). */
export function RequestsView({
  scope,
  requests,
  canCreate,
  catalog,
  onChanged,
}: RequestsViewProps): JSX.Element {
  const [picking, setPicking] = useState(false);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const toDecide = requests.filter((request) => request.actions.canDecide);
  const mine = requests.filter((request) => request.mine && !request.actions.canDecide);
  const others = requests.filter((request) => !request.mine && !request.actions.canDecide);
  const { assistant } = catalog;

  return (
    <Page>
      <PageHeader
        title="Office workflows"
        lede="Every department’s everyday work. Start a workflow and it goes to the right people, one step at a time."
        actions={
          canCreate && !picking && workflow === null ? (
            <Button onClick={() => setPicking(true)}>Start a workflow</Button>
          ) : undefined
        }
      />

      <p className="nexora-assistant-note" data-connected={assistant.connected}>
        <NavIcon name="sparkles" size={14} />
        {assistant.connected
          ? `The assistant is connected${assistant.model === undefined ? '' : ` (${assistant.model})`}. It drafts and prepares; people decide.`
          : 'No AI model is connected, so the assistant works by plain rules. It drafts and prepares; people decide.'}
      </p>

      {picking && workflow === null ? (
        <WorkflowPicker
          catalog={catalog}
          onCancel={() => setPicking(false)}
          onPick={(picked) => setWorkflow(picked)}
        />
      ) : null}

      {workflow !== null ? (
        <RequestForm
          scope={scope}
          workflow={workflow}
          assistant={assistant}
          onCancel={() => {
            setWorkflow(null);
            setPicking(false);
          }}
          onSent={() => {
            setWorkflow(null);
            setPicking(false);
            onChanged();
          }}
        />
      ) : null}

      {requests.length === 0 && !picking && workflow === null ? (
        <Card padding={10}>
          <EmptyState
            icon={<NavIcon name="requests" size={18} />}
            title="Nothing in motion yet"
            description={
              canCreate
                ? 'Need time off, a purchase, a campaign approved, a bug fixed? Start a workflow and it goes to the right people.'
                : 'Work you take part in will appear here.'
            }
          />
        </Card>
      ) : null}

      {toDecide.length > 0 ? (
        <Section title="Waiting for you" count={toDecide.length}>
          {toDecide.map((request) => (
            <RequestCard
              key={request.id}
              scope={scope}
              request={request}
              assistant={assistant}
              onChanged={onChanged}
            />
          ))}
        </Section>
      ) : null}

      {mine.length > 0 ? (
        <Section title="Started by you" count={mine.length}>
          {mine.map((request) => (
            <RequestCard
              key={request.id}
              scope={scope}
              request={request}
              assistant={assistant}
              onChanged={onChanged}
            />
          ))}
        </Section>
      ) : null}

      {others.length > 0 ? (
        <Section title="Others you take part in" count={others.length}>
          {others.map((request) => (
            <RequestCard
              key={request.id}
              scope={scope}
              request={request}
              assistant={assistant}
              onChanged={onChanged}
            />
          ))}
        </Section>
      ) : null}
    </Page>
  );
}

/** Choose a department, then one of its workflows. */
export function WorkflowPicker({
  catalog,
  onPick,
  onCancel,
}: {
  catalog: WorkflowCatalog;
  onPick: (workflow: Workflow) => void;
  onCancel: () => void;
}): JSX.Element {
  const [department, setDepartment] = useState(catalog.departments[0]?.name ?? '');
  const current = catalog.departments.find((entry) => entry.name === department);
  return (
    <Card padding={5}>
      <Stack gap={4} stretch>
        <div className="nexora-page-head" style={{ alignItems: 'center' }}>
          <h2 className="nexora-section-title">Which kind of work is it?</h2>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <div className="nexora-tabs" role="tablist" aria-label="Department">
          {catalog.departments.map((entry) => (
            <button
              key={entry.name}
              type="button"
              role="tab"
              aria-selected={entry.name === department}
              className="nexora-tab"
              onClick={() => setDepartment(entry.name)}
            >
              {entry.name}
            </button>
          ))}
        </div>
        <div className="nexora-choice">
          {(current?.workflows ?? []).map((workflow) => (
            <button
              key={workflow.key}
              type="button"
              className="nexora-choice-option"
              onClick={() => onPick(workflow)}
            >
              <span style={{ fontWeight: typography.weights.semibold }}>{workflow.name}</span>
              <span style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
                {workflow.description}
              </span>
              <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                {workflow.stages.length} {workflow.stages.length === 1 ? 'step' : 'steps'}:{' '}
                {workflow.stages.map((stage) => stage.label).join(', then ')}
              </span>
            </button>
          ))}
        </div>
      </Stack>
    </Card>
  );
}

/** What to say about a step whose seat nobody in the organization holds yet. */
export function vacancyNote(canDecide: boolean): string {
  return canDecide
    ? 'Nobody holds this seat yet, so this step comes to you as chief executive.'
    : 'Nobody holds this seat yet. Until someone joins that team, the step waits for the chief executive (who cannot approve their own request).';
}

/** The form of one workflow, with the assistant's "fill it in from a sentence". */
export function RequestForm({
  scope,
  workflow,
  assistant,
  onSent,
  onCancel,
}: {
  scope: HiringScope;
  workflow: Workflow;
  assistant: WorkflowCatalog['assistant'];
  onSent: () => void;
  onCancel: () => void;
}): JSX.Element {
  const [sentence, setSentence] = useState('');
  const [form, setForm] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [drafted, setDrafted] = useState<'ai' | 'rules' | null>(null);
  const [busy, setBusy] = useState<'draft' | 'send' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const fill = (): void => {
    setBusy('draft');
    setProblem(null);
    draftRequest(scope, workflow.key, sentence.trim())
      .then((draft) => {
        setForm((current) => ({ ...current, ...formFromValues(workflow, draft.values) }));
        setReason(draft.reason);
        setDrafted(draft.source);
      })
      .catch((caught: unknown) => setProblem(errorText(caught)))
      .finally(() => setBusy(null));
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const { values, problem: found } = valuesFromForm(workflow, form);
    if (found !== null) return setProblem(found);
    if (reason.trim().length < 5) return setProblem(`${workflow.reasonLabel}: write a few words.`);
    setProblem(null);
    setBusy('send');
    raiseRequest(scope, {
      type: workflow.key,
      reason: reason.trim(),
      values,
      draftedWithAssistant: drafted !== null,
    })
      .then(onSent)
      .catch((caught: unknown) => setProblem(errorText(caught)))
      .finally(() => setBusy(null));
  };

  const set = (key: string, value: string): void =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <Card padding={5}>
      <form onSubmit={submit}>
        <Stack gap={4} stretch>
          <Stack gap={1}>
            <h2 className="nexora-section-title">{workflow.name}</h2>
            <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              {workflow.description}
            </p>
          </Stack>

          <Route
            stops={[
              { label: 'You raise it', state: 'current' },
              ...workflow.stages.map((stage) => ({
                label: stage.label,
                state: 'waiting' as const,
                note: '',
              })),
            ]}
          />

          <div className="nexora-inset">
            <Stack gap={2} stretch>
              <Field
                label="Describe it in a sentence"
                hint="Optional. The assistant fills in the form below for you to check."
              >
                <Textarea
                  rows={2}
                  value={sentence}
                  onChange={(event) => setSentence(event.target.value)}
                  maxLength={1000}
                />
              </Field>
              <div className="nexora-actions">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  loading={busy === 'draft'}
                  disabled={busy !== null || sentence.trim().length < 5}
                  onClick={fill}
                >
                  Fill in with the assistant
                </Button>
                {drafted === null ? null : (
                  <span style={{ fontSize: typography.sizes.sm }}>
                    {assistantSourceLabel(drafted, assistant)}
                  </span>
                )}
              </div>
            </Stack>
          </div>

          <div className="nexora-fields">
            {workflow.fields
              .filter((field) => field.type !== 'longtext')
              .map((field) => (
                <Field key={field.key} label={field.label} required={field.required}>
                  {field.type === 'choice' ? (
                    <Select
                      value={form[field.key] ?? ''}
                      onChange={(event) => set(field.key, event.target.value)}
                    >
                      <option value="">Choose</option>
                      {(field.options ?? []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      type={
                        field.type === 'date'
                          ? 'date'
                          : field.type === 'money' || field.type === 'number'
                            ? 'number'
                            : 'text'
                      }
                      min={field.type === 'money' || field.type === 'number' ? '0' : undefined}
                      value={form[field.key] ?? ''}
                      onChange={(event) => set(field.key, event.target.value)}
                      placeholder={field.type === 'money' ? 'Amount in rupees' : field.placeholder}
                      maxLength={160}
                    />
                  )}
                </Field>
              ))}
          </div>
          {workflow.fields
            .filter((field) => field.type === 'longtext')
            .map((field) => (
              <Field key={field.key} label={field.label} required={field.required}>
                <Textarea
                  rows={3}
                  value={form[field.key] ?? ''}
                  onChange={(event) => set(field.key, event.target.value)}
                  maxLength={4000}
                />
              </Field>
            ))}
          <Field label={workflow.reasonLabel} required>
            <Textarea
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={2000}
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
            <Button type="submit" loading={busy === 'send'} disabled={busy !== null}>
              Send
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy !== null}>
              Cancel
            </Button>
          </div>
        </Stack>
      </form>
    </Card>
  );
}

const RECOMMENDATION: Record<RequestBrief['recommendation'], { label: string; tone: string }> = {
  approve: { label: 'Nothing stands in the way', tone: 'ok' },
  look_closer: { label: 'Look closer before deciding', tone: 'warn' },
  reject: { label: 'The assistant would say no', tone: 'warn' },
};

/** One request: what is asked, where it stands, and what the caller may do. */
export function RequestCard({
  scope,
  request,
  assistant,
  onChanged,
}: {
  scope: HiringScope;
  request: OfficeRequest;
  assistant: WorkflowCatalog['assistant'];
  onChanged: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [brief, setBrief] = useState<RequestBrief | null>(null);
  const [written, setWritten] = useState<'ai' | 'rules' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (label: string, work: () => Promise<unknown>, after?: () => void): void => {
    setBusy(label);
    setError(null);
    work()
      .then(() => after?.())
      .catch((caught: unknown) => setError(errorText(caught)))
      .finally(() => setBusy(null));
  };
  const finish = (label: string, decision: 'approve' | 'reject'): void =>
    run(
      label,
      () => decideRequest(scope, request.id, decision, comment),
      () => {
        setComment('');
        onChanged();
      },
    );

  const { pending, actions } = request;
  const isWork = pending?.kind === 'do';
  const refusal = request.history.find((entry) => entry.action === 'rejected');
  const noteMissing = pending?.noteRequired === true && comment.trim().length < 3;
  return (
    <Card padding={5} className={actions.canDecide ? 'nexora-turn' : undefined}>
      <Stack gap={4} stretch>
        <div className="nexora-page-head" style={{ alignItems: 'flex-start' }}>
          <Stack gap={1}>
            <h3 style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.lg }}>
              {requestTitle(request)}
            </h3>
            <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              {request.department}.{' '}
              {request.mine
                ? 'Started by you.'
                : `Started by ${request.requestedByName ?? 'a colleague'}.`}
            </div>
          </Stack>
          <div className="nexora-actions" style={{ gap: 8 }}>
            {actions.canDecide ? <TurnTag>Your turn</TurnTag> : null}
            <Badge tone={STATUS_TONE[request.status]}>{requestStatusLabel(request)}</Badge>
          </div>
        </div>

        <Route stops={requestRoute(request)} />

        {request.fields.length > 0 ? (
          <div className="nexora-facts">
            {request.fields
              .filter((field) => !field.long)
              .map((field) => (
                <Fact key={field.label} label={field.label}>
                  {field.value}
                </Fact>
              ))}
          </div>
        ) : null}
        {request.fields
          .filter((field) => field.long)
          .map((field) => (
            <Fact key={field.label} label={field.label}>
              {field.value}
            </Fact>
          ))}
        <Fact label={request.reasonLabel}>{request.reason}</Fact>

        {refusal?.comment === undefined ? null : (
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
            Refused by {refusal.actorName ?? 'the approver'}: “{refusal.comment}”
          </p>
        )}

        {pending?.vacant === true ? (
          <p
            role="note"
            style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}
          >
            {vacancyNote(actions.canDecide)}
          </p>
        ) : null}

        {actions.canDecide && pending !== undefined ? (
          <Stack gap={3} stretch>
            {isWork ? null : (
              <div className="nexora-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === 'brief'}
                  disabled={busy !== null}
                  onClick={() =>
                    run('brief', async () => setBrief(await briefRequest(scope, request.id)))
                  }
                >
                  Prepare me with the assistant
                </Button>
              </div>
            )}
            {brief === null ? null : (
              <div className="nexora-brief" data-tone={RECOMMENDATION[brief.recommendation].tone}>
                <SubHeading>{RECOMMENDATION[brief.recommendation].label}</SubHeading>
                <p>{brief.summary}</p>
                <ul>
                  {brief.facts.map((fact) => (
                    <li key={fact.label} data-tone={fact.tone}>
                      <span>{fact.label}</span>
                      <strong>{fact.value}</strong>
                    </li>
                  ))}
                </ul>
                <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                  {brief.source === 'ai'
                    ? `Written by the assistant${assistant.model === undefined ? '' : ` (${assistant.model})`} from the checked facts above. The decision is yours.`
                    : 'Built from the checked facts by plain rules: no AI model is connected. The decision is yours.'}
                </p>
              </div>
            )}

            <Field
              label={isWork ? (pending.noteLabel ?? 'Note') : 'Comment'}
              required={pending.noteRequired}
              hint={
                isWork
                  ? pending.noteRequired
                    ? 'This is kept on the record.'
                    : 'Optional.'
                  : 'Optional when you say yes. Needed when you say no — say why.'
              }
            >
              <Textarea
                rows={isWork ? 4 : 2}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={4000}
              />
            </Field>
            {isWork && pending.noteRequired ? (
              <div className="nexora-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === 'write'}
                  disabled={busy !== null}
                  onClick={() =>
                    run('write', async () => {
                      const draft = await writeForRequest(scope, request.id);
                      setComment(draft.text);
                      setWritten(draft.source);
                    })
                  }
                >
                  Draft it with the assistant
                </Button>
                {written === null ? null : (
                  <span style={{ fontSize: typography.sizes.sm }}>
                    {written === 'ai'
                      ? 'A draft from the assistant. Edit it before you finish.'
                      : 'A skeleton by plain rules: no AI model is connected. Fill it in.'}
                  </span>
                )}
              </div>
            ) : null}
            <div className="nexora-actions">
              <Button
                loading={busy === 'yes'}
                disabled={busy !== null || noteMissing}
                onClick={() => finish('yes', 'approve')}
              >
                {isWork ? 'Mark as done' : 'Approve'}
              </Button>
              <Button
                variant="secondary"
                loading={busy === 'no'}
                disabled={busy !== null || comment.trim().length < 3}
                onClick={() => finish('no', 'reject')}
              >
                {isWork ? 'Cannot be done' : 'Refuse'}
              </Button>
            </div>
          </Stack>
        ) : actions.decideBlockedReason !== undefined ? (
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {actions.decideBlockedReason}
          </p>
        ) : null}

        <div className="nexora-actions">
          <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>
            {open ? 'Hide history' : 'Show history'}
          </Button>
          {actions.canWithdraw ? (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'withdraw'}
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm('Withdraw this request?')) {
                  run('withdraw', () => withdrawRequest(scope, request.id), onChanged);
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
                <span style={{ flex: '1 1 220px', minWidth: 0, overflowWrap: 'anywhere' }}>
                  {historyLine(entry)}
                </span>
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
  const stage = entry.stageLabel ?? entry.stage ?? '';
  const note = entry.comment === undefined ? '' : ` — “${entry.comment}”`;
  switch (entry.action) {
    case 'submitted':
      return `${who} started it`;
    case 'not_required':
      return `“${stage}” not needed: ${who} holds that seat`;
    case 'approved':
      return `${stage}: done by ${who}${note}`;
    case 'rejected':
      return `${stage}: refused by ${who}${note}`;
    case 'withdrawn':
      return `${who} withdrew it`;
    case 'assisted':
      return `The assistant helped ${who}: ${entry.comment ?? 'drafted text'}`;
  }
}
