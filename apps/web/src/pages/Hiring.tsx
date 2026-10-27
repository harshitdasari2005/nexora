/**
 * @nexora/app-web — Hiring requests page.
 *
 * The office hiring chain, as people actually run it: a team's manager raises
 * a request, the CEO decides, then Finance decides, then HR hires. A rejection
 * goes back to the requester with the reason, to be revised and resubmitted.
 *
 * The page shows what the backend says and nothing else: each request carries
 * the caller's `actions` (computed on the server from their role and the
 * request's state), so a button only appears for the person whose turn it is —
 * and the server re-checks every click anyway.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
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
import { Fact, Page, PageHeader, Route, Section, SubHeading, TurnTag } from '../components/Page.js';
import { useDemo } from '../demo/demo-state.js';
import { api, ApiError } from '../lib/api.js';
import {
  chainSteps,
  decideRequisition,
  listRequisitions,
  recruitingProgress,
  reviseRequisition,
  statusLabel,
  submitRequisition,
  withdrawRequisition,
  type EmploymentType,
  type HiringScope,
  type Requisition,
  type RequisitionDetails,
  type RequisitionStatus,
  type RequisitionUrgency,
} from '../lib/hiring.js';
import type { DashboardResponse } from '../lib/types.js';
import { useSession } from '../session.js';

const DEFAULT_CURRENCY = 'INR';

const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  intern: 'Intern',
};
const URGENCY_LABEL: Record<RequisitionUrgency, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
};
const STATUS_TONE: Record<RequisitionStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending_executive: 'warning',
  pending_finance: 'warning',
  approved: 'success',
  changes_requested: 'danger',
  withdrawn: 'neutral',
};

function formatMoney(minorUnits: number, currency: string): string {
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

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface ProjectOption {
  id: string;
  name: string;
}

/** The hiring requests page. */
export function Hiring(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    requisitions: Requisition[];
    canCreate: boolean;
    projects: ProjectOption[];
    loading: boolean;
    error: ApiError | null;
  }>({
    dashboard: null,
    requisitions: [],
    canCreate: false,
    projects: [],
    loading: true,
    error: null,
  });

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
      const scope = {
        organizationId: dashboard.organization.id,
        workspaceId: dashboard.workspace.id,
      };
      const listed = await listRequisitions(scope);
      // The project picker is optional: a role that cannot read projects simply gets none.
      const projects = listed.canCreate
        ? await api<{ projects: ProjectOption[] }>(
            `/projects?organizationId=${encodeURIComponent(scope.organizationId)}`,
          ).then(
            (result) => result.projects,
            () => [],
          )
        : [];
      setState({
        dashboard,
        requisitions: listed.requisitions,
        canCreate: listed.canCreate,
        projects,
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
      <HiringView
        scope={scope}
        workspaceName={dashboard.workspace.name}
        requisitions={state.requisitions}
        canCreate={state.canCreate}
        projects={state.projects}
        onChanged={() => void load()}
      />
    </AppShell>
  );
}

/** Props of {@link HiringView}. */
export interface HiringViewProps {
  scope: HiringScope;
  workspaceName: string;
  requisitions: readonly Requisition[];
  canCreate: boolean;
  projects: readonly ProjectOption[];
  /** Called after any change so the list is read back from the server. */
  onChanged: () => void;
}

/** The pure page content (exported for tests). */
export function HiringView({
  scope,
  workspaceName,
  requisitions,
  canCreate,
  projects,
  onChanged,
}: HiringViewProps): JSX.Element {
  const [creating, setCreating] = useState(false);
  const waitingForMe = requisitions.filter((entry) => entry.actions.canDecide);
  const others = requisitions.filter((entry) => !entry.actions.canDecide);

  return (
    <Page>
      <PageHeader
        title="Hiring requests"
        lede="A team asks for a hire, the CEO decides, then Finance, then HR recruits. A rejected request goes back to the person who raised it."
        actions={
          canCreate && !creating ? (
            <Button onClick={() => setCreating(true)}>New hiring request</Button>
          ) : undefined
        }
      />

      {creating ? (
        <RequisitionForm
          title="New hiring request"
          submitLabel="Send for approval"
          defaultDepartment={workspaceName}
          projects={projects}
          onCancel={() => setCreating(false)}
          onSubmit={async (details) => {
            await submitRequisition(scope, details);
            setCreating(false);
            onChanged();
          }}
        />
      ) : null}

      {requisitions.length === 0 && !creating ? (
        <Card padding={10}>
          <EmptyState
            icon={<NavIcon name="hiring" size={18} />}
            title="No hiring requests yet"
            description={
              canCreate
                ? 'When your team needs someone, raise a hiring request. It goes to the CEO, then to Finance.'
                : 'Hiring requests raised by the teams will appear here.'
            }
          />
        </Card>
      ) : null}

      {waitingForMe.length > 0 ? (
        <Section title="Waiting for your decision" count={waitingForMe.length}>
          {waitingForMe.map((requisition) => (
            <RequisitionCard
              key={requisition.id}
              scope={scope}
              requisition={requisition}
              projects={projects}
              onChanged={onChanged}
              initiallyOpen
            />
          ))}
        </Section>
      ) : null}

      {others.length > 0 ? (
        <Section
          title={waitingForMe.length > 0 ? 'Other requests' : 'All requests'}
          count={others.length}
        >
          {others.map((requisition) => (
            <RequisitionCard
              key={requisition.id}
              scope={scope}
              requisition={requisition}
              projects={projects}
              onChanged={onChanged}
              initiallyOpen={requisition.actions.canRevise}
            />
          ))}
        </Section>
      ) : null}
    </Page>
  );
}

/** The Raised → CEO → Finance → HR route. */
export function ChainStrip({
  requisition,
}: {
  requisition: Pick<Requisition, 'status' | 'history' | 'round' | 'recruiting'>;
}): JSX.Element {
  return <Route stops={chainSteps(requisition)} testId="chain-strip" />;
}

/** One request: summary, progress, details, history and the caller's actions. */
export function RequisitionCard({
  scope,
  requisition,
  projects,
  onChanged,
  initiallyOpen = false,
}: {
  scope: HiringScope;
  requisition: Requisition;
  projects: readonly ProjectOption[];
  onChanged: () => void;
  initiallyOpen?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(initiallyOpen);
  const [revising, setRevising] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectName = projects.find((project) => project.id === requisition.projectId)?.name;

  const run = async (label: string, work: () => Promise<unknown>): Promise<void> => {
    setBusy(label);
    setError(null);
    try {
      await work();
      setComment('');
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That did not work — try again.');
    } finally {
      setBusy(null);
    }
  };

  const myTurn = requisition.actions.canDecide || requisition.actions.canRevise;
  return (
    <Card padding={5} className={myTurn ? 'nexora-turn' : undefined}>
      <Stack gap={4} stretch>
        <div className="nexora-page-head" style={{ alignItems: 'flex-start' }}>
          <Stack gap={1}>
            <h3 style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.lg }}>
              {requisition.jobTitle}
              {requisition.headcount > 1 ? (
                <span style={{ color: 'var(--nexora-textMuted)', fontWeight: 400 }}>
                  {' '}
                  × {requisition.headcount}
                </span>
              ) : null}
            </h3>
            <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              For {requisition.department}
              {projectName === undefined ? '' : `, ${projectName}`}. Raised by{' '}
              {requisition.requestedByName ?? 'a team member'}
              {requisition.round > 1 ? `, round ${requisition.round}` : ''}.
            </div>
          </Stack>
          <div className="nexora-actions" style={{ gap: 8 }}>
            {myTurn ? (
              <TurnTag>{requisition.actions.canDecide ? 'Your decision' : 'Back with you'}</TurnTag>
            ) : null}
            {requisition.urgency === 'high' ? <Badge tone="danger">Urgent</Badge> : null}
            <Badge tone={STATUS_TONE[requisition.status]}>{statusLabel(requisition.status)}</Badge>
          </div>
        </div>

        <ChainStrip requisition={requisition} />
        {recruitingProgress(requisition) === undefined ? null : (
          <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {recruitingProgress(requisition)}
          </div>
        )}

        <div>
          <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>
            {open ? 'Hide details' : 'Show details and history'}
          </Button>
        </div>

        {open ? (
          <Stack gap={4} stretch>
            <div className="nexora-facts">
              <Fact label="Employment">{EMPLOYMENT_LABEL[requisition.employmentType]}</Fact>
              <Fact label="Salary range (per person / year)">
                {formatMoney(requisition.salaryMinMinorUnits, requisition.currency)} –{' '}
                {formatMoney(requisition.salaryMaxMinorUnits, requisition.currency)}
              </Fact>
              <Fact label="Urgency">{URGENCY_LABEL[requisition.urgency]}</Fact>
              <Fact label="Desired start">{requisition.targetStartDate ?? 'Not specified'}</Fact>
            </div>
            <Fact label="Why the team needs this hire">{requisition.justification}</Fact>

            <Stack gap={2} stretch>
              <SubHeading>History</SubHeading>
              {requisition.history.map((entry, index) => (
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
                  <span style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <strong>{entry.actorName ?? 'Someone'}</strong> {historyVerb(entry)}
                    {entry.comment === undefined ? '' : ` — “${entry.comment}”`}
                  </span>
                </div>
              ))}
            </Stack>

            {requisition.actions.canDecide ? (
              <Stack gap={3} stretch>
                <Field
                  label="Comment"
                  hint="Optional when approving. Required when rejecting — say what should change."
                >
                  <Textarea
                    rows={2}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="e.g. Approved for the Q4 roadmap"
                    maxLength={1000}
                  />
                </Field>
                <div className="nexora-actions">
                  <Button
                    loading={busy === 'approve'}
                    disabled={busy !== null}
                    onClick={() =>
                      void run('approve', () =>
                        decideRequisition(scope, requisition.id, 'approve', comment),
                      )
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    loading={busy === 'reject'}
                    disabled={busy !== null || comment.trim().length === 0}
                    onClick={() =>
                      void run('reject', () =>
                        decideRequisition(scope, requisition.id, 'reject', comment),
                      )
                    }
                  >
                    Reject and send back
                  </Button>
                </div>
              </Stack>
            ) : requisition.actions.decideBlockedReason !== undefined ? (
              <Badge tone="neutral">{requisition.actions.decideBlockedReason}</Badge>
            ) : null}

            {requisition.actions.canRevise && !revising ? (
              <Stack direction="row" gap={3}>
                <Button size="sm" onClick={() => setRevising(true)}>
                  Revise and resubmit
                </Button>
              </Stack>
            ) : null}
            {revising ? (
              <RequisitionForm
                title="Revise the request"
                submitLabel="Resubmit"
                defaultDepartment={requisition.department}
                initial={requisition}
                projects={projects}
                onCancel={() => setRevising(false)}
                onSubmit={async (details) => {
                  await reviseRequisition(scope, requisition.id, details);
                  setRevising(false);
                  onChanged();
                }}
              />
            ) : null}

            {requisition.actions.canWithdraw && !revising ? (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === 'withdraw'}
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm('Withdraw this hiring request?')) {
                      void run('withdraw', () => withdrawRequisition(scope, requisition.id));
                    }
                  }}
                >
                  Withdraw request
                </Button>
              </div>
            ) : null}

            {error !== null ? (
              <p
                role="alert"
                style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}
              >
                {error}
              </p>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

/** What a history entry says, in plain words. */
export function historyVerb(entry: Requisition['history'][number]): string {
  const stage = entry.stage === 'finance' ? 'Finance' : 'CEO';
  switch (entry.action) {
    case 'submitted':
      return 'raised the request';
    case 'executive_not_required':
      return 'is the CEO — no separate CEO decision needed';
    case 'approved':
      return `approved it (${stage} decision)`;
    case 'rejected':
      return `sent it back (${stage} decision)`;
    case 'resubmitted':
      return 'revised and resubmitted it';
    case 'withdrawn':
      return 'withdrew the request';
  }
}

/** Client-side checks that mirror the server's (the server remains authoritative). */
export function validateRequisition(input: {
  jobTitle: string;
  department: string;
  headcount: string;
  salaryMin: string;
  salaryMax: string;
  justification: string;
}): { field: string; message: string }[] {
  const issues: { field: string; message: string }[] = [];
  if (input.jobTitle.trim().length < 2)
    issues.push({ field: 'jobTitle', message: 'Enter the job title' });
  if (input.department.trim().length < 1) {
    issues.push({ field: 'department', message: 'Enter the team or department' });
  }
  const headcount = Number(input.headcount);
  if (!Number.isInteger(headcount) || headcount < 1 || headcount > 50) {
    issues.push({ field: 'headcount', message: 'Enter a whole number from 1 to 50' });
  }
  const min = Number(input.salaryMin);
  const max = Number(input.salaryMax);
  if (input.salaryMin.trim() === '' || !Number.isFinite(min) || min < 0) {
    issues.push({ field: 'salaryMin', message: 'Enter the minimum salary' });
  }
  if (input.salaryMax.trim() === '' || !Number.isFinite(max) || max < 0) {
    issues.push({ field: 'salaryMax', message: 'Enter the maximum salary' });
  } else if (Number.isFinite(min) && max < min) {
    issues.push({ field: 'salaryMax', message: 'The maximum cannot be below the minimum' });
  }
  if (input.justification.trim().length < 10) {
    issues.push({
      field: 'justification',
      message: 'Explain why the team needs this hire (10+ characters)',
    });
  }
  return issues;
}

/** The raise / revise form. */
function RequisitionForm({
  title,
  submitLabel,
  defaultDepartment,
  initial,
  projects,
  onSubmit,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  defaultDepartment: string;
  initial?: RequisitionDetails;
  projects: readonly ProjectOption[];
  onSubmit: (details: RequisitionDetails) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [jobTitle, setJobTitle] = useState(initial?.jobTitle ?? '');
  const [department, setDepartment] = useState(initial?.department ?? defaultDepartment);
  const [projectId, setProjectId] = useState(initial?.projectId ?? '');
  const [headcount, setHeadcount] = useState(String(initial?.headcount ?? 1));
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    initial?.employmentType ?? 'full_time',
  );
  const [salaryMin, setSalaryMin] = useState(
    initial === undefined ? '' : String(initial.salaryMinMinorUnits / 100),
  );
  const [salaryMax, setSalaryMax] = useState(
    initial === undefined ? '' : String(initial.salaryMaxMinorUnits / 100),
  );
  const [urgency, setUrgency] = useState<RequisitionUrgency>(initial?.urgency ?? 'normal');
  const [targetStartDate, setTargetStartDate] = useState(initial?.targetStartDate ?? '');
  const [justification, setJustification] = useState(initial?.justification ?? '');
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const issueFor = (field: string): string | undefined =>
    issues.find((issue) => issue.field === field)?.message;
  // In the demo office the guide suggests a request; the person still sends it.
  const example = useDemo().config?.story.hiring;
  const fillExample = (): void => {
    if (example === undefined) return;
    setJobTitle(example.jobTitle);
    setDepartment(example.department);
    setProjectId(
      projects.some((project) => project.id === example.projectId) ? example.projectId : '',
    );
    setHeadcount(String(example.headcount));
    setEmploymentType(example.employmentType);
    setSalaryMin(String(example.salaryMinMinorUnits / 100));
    setSalaryMax(String(example.salaryMaxMinorUnits / 100));
    setUrgency(example.urgency);
    setJustification(example.justification);
    setIssues([]);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const found = validateRequisition({
      jobTitle,
      department,
      headcount,
      salaryMin,
      salaryMax,
      justification,
    });
    setIssues(found);
    if (found.length > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        jobTitle: jobTitle.trim(),
        department: department.trim(),
        ...(projectId === '' ? {} : { projectId }),
        headcount: Number(headcount),
        employmentType,
        salaryMinMinorUnits: Math.round(Number(salaryMin) * 100),
        salaryMaxMinorUnits: Math.round(Number(salaryMax) * 100),
        currency: initial?.currency ?? DEFAULT_CURRENCY,
        justification: justification.trim(),
        urgency,
        ...(targetStartDate === '' ? {} : { targetStartDate }),
      });
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Could not send the request.');
    } finally {
      setSubmitting(false);
    }
  };

  const half = { minWidth: 0 } as const;
  return (
    <Card padding={5}>
      <form onSubmit={(event) => void handleSubmit(event)} data-testid="requisition-form">
        <Stack gap={4} stretch>
          <div className="nexora-page-head" style={{ alignItems: 'center' }}>
            <h2 className="nexora-section-title">{title}</h2>
            {example !== undefined && initial === undefined ? (
              <Button type="button" size="sm" variant="secondary" onClick={fillExample}>
                Fill in the demo example
              </Button>
            ) : null}
          </div>
          <div className="nexora-fields">
            <div style={half}>
              <Field label="Job title" required error={issueFor('jobTitle')}>
                <Input
                  value={jobTitle}
                  onChange={(event) => setJobTitle(event.target.value)}
                  placeholder="Senior Backend Developer"
                  maxLength={120}
                  invalid={issueFor('jobTitle') !== undefined}
                />
              </Field>
            </div>
            <div style={half}>
              <Field label="Team / department" required error={issueFor('department')}>
                <Input
                  value={department}
                  onChange={(event) => setDepartment(event.target.value)}
                  maxLength={80}
                  invalid={issueFor('department') !== undefined}
                />
              </Field>
            </div>
          </div>
          <div className="nexora-fields">
            <div style={half}>
              <Field label="How many people" required error={issueFor('headcount')}>
                <Input
                  type="number"
                  min="1"
                  max="50"
                  step="1"
                  value={headcount}
                  onChange={(event) => setHeadcount(event.target.value)}
                  invalid={issueFor('headcount') !== undefined}
                />
              </Field>
            </div>
            <div style={half}>
              <Field label="Employment type" required>
                <Select
                  value={employmentType}
                  onChange={(event) => setEmploymentType(event.target.value as EmploymentType)}
                >
                  {Object.entries(EMPLOYMENT_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div style={half}>
              <Field label="Project" hint="Optional — the project this hire is for.">
                <Select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">No specific project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
          <div className="nexora-fields">
            <div style={half}>
              <Field
                label={`Minimum salary (${DEFAULT_CURRENCY} / year)`}
                required
                error={issueFor('salaryMin')}
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={salaryMin}
                  onChange={(event) => setSalaryMin(event.target.value)}
                  placeholder="1800000"
                  invalid={issueFor('salaryMin') !== undefined}
                />
              </Field>
            </div>
            <div style={half}>
              <Field
                label={`Maximum salary (${DEFAULT_CURRENCY} / year)`}
                required
                error={issueFor('salaryMax')}
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={salaryMax}
                  onChange={(event) => setSalaryMax(event.target.value)}
                  placeholder="2400000"
                  invalid={issueFor('salaryMax') !== undefined}
                />
              </Field>
            </div>
          </div>
          <div className="nexora-fields">
            <div style={half}>
              <Field label="Urgency" required>
                <Select
                  value={urgency}
                  onChange={(event) => setUrgency(event.target.value as RequisitionUrgency)}
                >
                  {Object.entries(URGENCY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div style={half}>
              <Field label="Desired start date" hint="Optional">
                <Input
                  type="date"
                  value={targetStartDate}
                  onChange={(event) => setTargetStartDate(event.target.value)}
                />
              </Field>
            </div>
          </div>
          <Field
            label="Why does the team need this hire?"
            required
            error={issueFor('justification')}
          >
            <Textarea
              rows={3}
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              placeholder="The mobile banking rebuild needs two more backend engineers to hit the Q4 date."
              maxLength={2000}
              invalid={issueFor('justification') !== undefined}
            />
          </Field>
          {submitError !== null ? (
            <p
              role="alert"
              style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}
            >
              {submitError}
            </p>
          ) : null}
          <div className="nexora-actions">
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitLabel}
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
