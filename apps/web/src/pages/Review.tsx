/**
 * @nexora/app-web — Weekly review page.
 *
 * What the person running the office looks at once a week: how much was
 * raised and finished, how long it takes, and above all where work is
 * waiting. Every number is counted by the server from the records; the
 * assistant's paragraph only words those numbers, and says so.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { NavIcon } from '../components/NavIcon.js';
import { Fact, Page, PageHeader, Section } from '../components/Page.js';
import { ApiError } from '../lib/api.js';
import type { HiringScope } from '../lib/hiring.js';
import {
  fetchReview,
  fetchReviewSummary,
  spokenHours,
  type ReviewResponse,
} from '../lib/review.js';
import { useShellScope } from '../lib/useShellScope.js';

const muted = { fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' } as const;

/** The weekly review page. */
export function ReviewPage(): JSX.Element {
  const { dashboard, loading, error, reload } = useShellScope();
  const organizationId = dashboard?.organization?.id;
  const workspaceId = dashboard?.workspace?.id;
  const [state, setState] = useState<{ data: ReviewResponse | null; error: string | null }>({
    data: null,
    error: null,
  });
  const [worded, setWorded] = useState<{ text: string; source: 'ai' | 'rules' } | null>(null);

  const load = useCallback(() => {
    if (organizationId === undefined || workspaceId === undefined) return;
    const scope = { organizationId, workspaceId };
    setWorded(null);
    fetchReview(scope).then(
      (data) => {
        setState({ data, error: null });
        // The counts are on screen already; the assistant's wording follows.
        if (data.assistant.connected) {
          fetchReviewSummary(scope).then(setWorded, () => setWorded(null));
        }
      },
      (caught: unknown) =>
        setState({
          data: null,
          error: caught instanceof ApiError ? caught.message : 'Could not read the review.',
        }),
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
      ) : state.data === null ? (
        <Page>
          <PageHeader title="Weekly review" />
          <Card padding={5}>
            <p style={{ color: 'var(--nexora-textSecondary)' }}>Counting the week…</p>
          </Card>
        </Page>
      ) : (
        <ReviewView scope={scope} data={state.data} worded={worded} />
      )}
    </AppShell>
  );
}

/** Props of {@link ReviewView}. */
export interface ReviewViewProps {
  scope: HiringScope;
  data: ReviewResponse;
  /** The assistant's wording of the counts, once it has arrived. */
  worded: { text: string; source: 'ai' | 'rules' } | null;
}

/** The pure page content (exported for tests). */
export function ReviewView({ scope, data, worded }: ReviewViewProps): JSX.Element {
  const { review, assistant } = data;
  const { requests, tasks } = review;
  const byAssistant = worded !== null && worded.source === 'ai';
  const busiest = Math.max(1, ...review.waitingAt.map((step) => step.count));
  const requestsHref = `/app/requests?organizationId=${encodeURIComponent(scope.organizationId)}&workspaceId=${encodeURIComponent(scope.workspaceId)}`;

  return (
    <Page>
      <PageHeader
        title="Weekly review"
        lede="How the office ran in the last seven days, and where work is waiting."
      />

      <div
        className="nexora-brief"
        data-tone={review.waitingLongest.some((item) => item.stuck) ? 'warn' : 'ok'}
      >
        <p style={{ fontSize: typography.sizes.md, lineHeight: 1.55 }}>
          {byAssistant ? worded.text : data.summary}
        </p>
        <p className="nexora-assistant-note">
          <NavIcon name="sparkles" size={14} />
          <span>
            {byAssistant
              ? `Worded by the assistant${assistant.model === undefined ? '' : ` (${assistant.model})`} from the counts below. Every number is counted from the records.`
              : assistant.connected
                ? 'Counted from the records. The assistant is wording it…'
                : 'Counted from the records and written by plain rules: no AI model is connected.'}
          </span>
        </p>
      </div>

      <Card padding={5}>
        <div className="nexora-facts">
          <Fact label="Raised this week">
            <span className="nexora-figure">{requests.raised}</span>
          </Fact>
          <Fact label="Finished">
            <span className="nexora-figure">{requests.finished}</span>
          </Fact>
          <Fact label="Refused">
            <span className="nexora-figure">{requests.refused}</span>
          </Fact>
          <Fact label="Still in motion">
            <span className="nexora-figure">{requests.inMotion}</span>
          </Fact>
          <Fact label="Typical time to finish">
            {requests.typicalHours === undefined
              ? 'Nothing finished yet'
              : spokenHours(requests.typicalHours)}
          </Fact>
          <Fact label="Written with the assistant">
            {requests.draftedWithAssistant} of {requests.raised}
          </Fact>
        </div>
      </Card>

      <Section
        title="Where work is waiting"
        hint={review.waitingAt.length === 0 ? undefined : 'the steps with the most waiting first'}
      >
        {review.waitingAt.length === 0 ? (
          <Card padding={5}>
            <p style={muted}>Nothing is waiting for anyone right now.</p>
          </Card>
        ) : (
          <Card padding={0}>
            <div className="nexora-rows">
              {review.waitingAt.map((step) => (
                <div key={`${step.department}-${step.step}`} className="nexora-review-row">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: typography.weights.semibold }}>{step.step}</div>
                    <div style={muted}>{step.department}</div>
                  </div>
                  <div
                    className="nexora-review-bar"
                    role="img"
                    aria-label={`${step.count} waiting`}
                  >
                    <span style={{ width: `${Math.round((step.count / busiest) * 100)}%` }} />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: typography.weights.semibold }}>
                      {step.count} waiting
                    </div>
                    <div style={muted}>longest {spokenHours(step.longestHours)}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </Section>

      {review.waitingLongest.length === 0 ? null : (
        <Section title="Waiting longest" count={review.waitingLongest.length}>
          <Card padding={0}>
            <div className="nexora-rows">
              {review.waitingLongest.map((item) => (
                <div key={item.id} className="nexora-desk-row">
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <div style={{ fontWeight: typography.weights.semibold }}>
                      {item.summary === '' ? item.workflow : `${item.workflow}: ${item.summary}`}
                    </div>
                    <div style={muted}>
                      At “{item.step}”
                      {item.requestedByName === undefined
                        ? ''
                        : `. Raised by ${item.requestedByName}`}
                      .
                    </div>
                  </div>
                  <div
                    style={{
                      fontWeight: typography.weights.semibold,
                      color: item.stuck ? 'var(--nexora-warning)' : 'var(--nexora-textSecondary)',
                    }}
                  >
                    {spokenHours(item.waitingHours)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <p style={muted}>
            Anything waiting two days or more at one step is highlighted.{' '}
            <Link to={requestsHref}>Open Office workflows</Link> to see each one.
          </p>
        </Section>
      )}

      {review.departments.length === 0 ? null : (
        <Section title="By department">
          <Card padding={0}>
            <div className="nexora-review-table" role="table" aria-label="By department">
              <div role="row" className="nexora-review-head">
                <span role="columnheader">Department</span>
                <span role="columnheader">Raised</span>
                <span role="columnheader">Finished</span>
                <span role="columnheader">In motion</span>
                <span role="columnheader">Typical time</span>
              </div>
              {review.departments.map((row) => (
                <div role="row" key={row.department}>
                  <span role="cell" style={{ fontWeight: typography.weights.semibold }}>
                    {row.department}
                  </span>
                  <span role="cell">{row.raised}</span>
                  <span role="cell">{row.finished}</span>
                  <span role="cell">{row.inMotion}</span>
                  <span role="cell">
                    {row.typicalHours === undefined ? 'None yet' : spokenHours(row.typicalHours)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      )}

      <Section title="Project tasks">
        <Card padding={5}>
          <div className="nexora-facts">
            <Fact label="Done this week">{tasks.done}</Fact>
            <Fact label="In review">{tasks.inReview}</Fact>
            <Fact label="In progress">{tasks.inProgress}</Fact>
            <Fact label="Not started">{tasks.todo}</Fact>
            <Fact label="Past the due date">{tasks.overdue}</Fact>
          </div>
        </Card>
      </Section>
    </Page>
  );
}
