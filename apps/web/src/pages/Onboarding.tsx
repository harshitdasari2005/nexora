/**
 * @nexora/app-web — Onboarding page.
 *
 * A new hire's checklist, each item owned by the part of the office that does
 * it (HR, IT, the hiring manager). A "Mark done" button appears only on the
 * items the server says the caller may complete; when everything is done the
 * person is active and the hiring manager can assign them to the project.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Input, Stack, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { NavIcon } from '../components/NavIcon.js';
import { Page, PageHeader, Section, TurnTag } from '../components/Page.js';
import { api, ApiError } from '../lib/api.js';
import type { HiringScope } from '../lib/hiring.js';
import {
  assignToProject,
  completeItem,
  listOnboardings,
  OWNER_LABEL,
  progressLabel,
  startOnboarding,
  type OnboardingRecord,
  type ReadyHire,
} from '../lib/onboarding.js';
import type { DashboardResponse } from '../lib/types.js';
import { useSession } from '../session.js';

const errorText = (caught: unknown): string =>
  caught instanceof ApiError ? caught.message : 'That did not work — try again.';

/** The onboarding page. */
export function OnboardingPage(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    onboardings: OnboardingRecord[];
    ready: ReadyHire[];
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, onboardings: [], ready: [], loading: true, error: null });

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
      const listed = await listOnboardings({
        organizationId: dashboard.organization.id,
        workspaceId: dashboard.workspace.id,
      });
      setState({
        dashboard,
        onboardings: listed.onboardings,
        ready: listed.readyToStart,
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
      <OnboardingView
        scope={scope}
        onboardings={state.onboardings}
        ready={state.ready}
        onChanged={() => void load()}
      />
    </AppShell>
  );
}

/** Props of {@link OnboardingView}. */
export interface OnboardingViewProps {
  scope: HiringScope;
  onboardings: readonly OnboardingRecord[];
  ready: readonly ReadyHire[];
  onChanged: () => void;
}

/** The pure page content (exported for tests). */
export function OnboardingView({
  scope,
  onboardings,
  ready,
  onChanged,
}: OnboardingViewProps): JSX.Element {
  const inProgress = onboardings.filter((record) => record.status === 'in_progress');
  const finished = onboardings.filter((record) => record.status === 'completed');
  return (
    <Page>
      <PageHeader
        title="Onboarding"
        lede="HR, IT and the hiring manager each complete their part. When everything is done the new colleague is active and can be put on a project."
      />

      {ready.length > 0 ? (
        <Section title="Hired, onboarding not started" count={ready.length}>
          {ready.map((hire) => (
            <ReadyCard key={hire.employeeId} scope={scope} hire={hire} onChanged={onChanged} />
          ))}
        </Section>
      ) : null}

      {onboardings.length === 0 && ready.length === 0 ? (
        <Card padding={10}>
          <EmptyState
            icon={<NavIcon name="onboarding" size={18} />}
            title="Nobody is being onboarded"
            description="A new hire appears here once a candidate accepts an offer."
          />
        </Card>
      ) : null}

      {inProgress.length > 0 ? (
        <Section title="In progress" count={inProgress.length}>
          {inProgress.map((record) => (
            <OnboardingCard key={record.id} scope={scope} record={record} onChanged={onChanged} />
          ))}
        </Section>
      ) : null}

      {finished.length > 0 ? (
        <Section title="Completed" count={finished.length}>
          {finished.map((record) => (
            <OnboardingCard key={record.id} scope={scope} record={record} onChanged={onChanged} />
          ))}
        </Section>
      ) : null}
    </Page>
  );
}

function ReadyCard({
  scope,
  hire,
  onChanged,
}: {
  scope: HiringScope;
  hire: ReadyHire;
  onChanged: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card padding={5} className="nexora-turn">
      <div className="nexora-page-head" style={{ alignItems: 'center' }}>
        <Stack gap={1}>
          <h3 style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.lg }}>
            {hire.name}
          </h3>
          <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {[
              hire.jobTitle,
              hire.department,
              hire.startDate === undefined ? undefined : `starts ${hire.startDate}`,
            ]
              .filter(Boolean)
              .join(', ')}
          </div>
          {error === null ? null : (
            <p
              role="alert"
              style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}
            >
              {error}
            </p>
          )}
        </Stack>
        <div className="nexora-actions">
          <TurnTag>Ready for you</TurnTag>
          <Button
            loading={busy}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              startOnboarding(scope, hire.employeeId)
                .then(onChanged)
                .catch((caught: unknown) => setError(errorText(caught)))
                .finally(() => setBusy(false));
            }}
          >
            Start onboarding
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** One new hire's checklist. */
export function OnboardingCard({
  scope,
  record,
  onChanged,
}: {
  scope: HiringScope;
  record: OnboardingRecord;
  onChanged: () => void;
}): JSX.Element {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (label: string, work: () => Promise<unknown>): void => {
    setBusy(label);
    setError(null);
    work()
      .then(onChanged)
      .catch((caught: unknown) => setError(errorText(caught)))
      .finally(() => setBusy(null));
  };

  const canAssignNow =
    record.status === 'completed' &&
    record.projectName !== undefined &&
    !record.assignedToProject &&
    record.canAssign &&
    record.projectId !== undefined;
  const myTurn = canAssignNow || record.items.some((item) => item.canComplete);
  return (
    <Card padding={5} className={myTurn ? 'nexora-turn' : undefined}>
      <Stack gap={4} stretch>
        <div className="nexora-page-head" style={{ alignItems: 'flex-start' }}>
          <Stack gap={1}>
            <h3 style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.lg }}>
              {record.employeeName}
            </h3>
            <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              {[
                record.jobTitle,
                record.startDate === undefined ? undefined : `starts ${record.startDate}`,
                record.hiringManagerName === undefined
                  ? undefined
                  : `hiring manager ${record.hiringManagerName}`,
              ]
                .filter(Boolean)
                .join(', ')}
            </div>
          </Stack>
          <div className="nexora-actions" style={{ gap: 8 }}>
            {myTurn ? <TurnTag>Your part</TurnTag> : null}
            <Badge tone={record.status === 'completed' ? 'success' : 'warning'}>
              {record.status === 'completed' ? 'Active' : progressLabel(record)}
            </Badge>
          </div>
        </div>

        <div className="nexora-rows" style={{ borderTop: '1px solid var(--nexora-border)' }}>
          {record.items.map((item) => (
            <div
              key={item.key}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: '12px 0',
              }}
            >
              <span
                aria-hidden
                className="nexora-check"
                data-done={item.done}
                data-mine={item.canComplete}
              >
                {item.done ? <NavIcon name="check" size={12} /> : null}
              </span>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div
                  style={{
                    fontSize: typography.sizes.base,
                    fontWeight: typography.weights.medium,
                    color: item.done ? 'var(--nexora-textSecondary)' : 'var(--nexora-text)',
                  }}
                >
                  {item.title}
                </div>
                <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                  {OWNER_LABEL[item.owner]}
                  {item.done
                    ? `, done${item.doneByName === undefined ? '' : ` by ${item.doneByName}`}${
                        item.note === undefined ? '' : ` (${item.note})`
                      }`
                    : ', waiting'}
                </div>
              </div>
              {item.canComplete ? (
                <div
                  className="nexora-actions"
                  style={{ flex: '1 1 260px', justifyContent: 'flex-end' }}
                >
                  <Input
                    value={notes[item.key] ?? ''}
                    onChange={(event) =>
                      setNotes((current) => ({ ...current, [item.key]: event.target.value }))
                    }
                    placeholder={item.key === 'buddy' ? 'Who is the buddy?' : 'Note (optional)'}
                    maxLength={300}
                    aria-label={item.key === 'buddy' ? 'Buddy name' : 'Note'}
                    style={{ flex: '1 1 160px', width: 'auto', minWidth: 0 }}
                  />
                  <Button
                    size="sm"
                    loading={busy === item.key}
                    disabled={
                      busy !== null ||
                      (item.key === 'buddy' && (notes[item.key] ?? '').trim().length < 2)
                    }
                    onClick={() =>
                      run(item.key, () => completeItem(scope, record.id, item.key, notes[item.key]))
                    }
                  >
                    Mark done
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {record.status === 'completed' && record.projectName !== undefined ? (
          record.assignedToProject ? (
            <Badge tone="success" style={{ alignSelf: 'flex-start' }}>
              Assigned to {record.projectName}
            </Badge>
          ) : record.canAssign && record.projectId !== undefined ? (
            <div>
              <Button
                loading={busy === 'assign'}
                disabled={busy !== null}
                onClick={() =>
                  run('assign', () =>
                    assignToProject(scope, record.projectId as string, record.employeeId),
                  )
                }
              >
                Assign to {record.projectName}
              </Button>
            </div>
          ) : (
            <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              Ready to be assigned to {record.projectName} by the hiring manager.
            </div>
          )
        ) : null}

        {error === null ? null : (
          <p role="alert" style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
            {error}
          </p>
        )}
      </Stack>
    </Card>
  );
}
