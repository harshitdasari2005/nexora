/**
 * @nexora/app-web — My desk.
 *
 * The first thing a person sees: what is waiting for THEM, and what is moving
 * without them. Every item is something the server said this person may act
 * on right now; the desk only gathers them in one place and points at the
 * page where each is done.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { NavIcon, type IconName } from '../components/NavIcon.js';
import { Page, PageHeader, Section } from '../components/Page.js';
import { ApiError, CHANGE_EVENT } from '../lib/api.js';
import { loadDesk, type Desk, type DeskItem, type DeskScreen } from '../lib/desk.js';
import type { HiringScope } from '../lib/hiring.js';
import { useShellScope } from '../lib/useShellScope.js';

const SCREEN: Record<DeskScreen, { label: string; icon: IconName }> = {
  hiring: { label: 'Hiring', icon: 'hiring' },
  recruiting: { label: 'Recruiting', icon: 'recruiting' },
  onboarding: { label: 'Onboarding', icon: 'onboarding' },
  requests: { label: 'Workflows', icon: 'requests' },
  tasks: { label: 'Tasks', icon: 'tasks' },
};

/** The desk page. */
export function DeskPage(): JSX.Element {
  const { dashboard, loading, error, reload } = useShellScope();
  const organizationId = dashboard?.organization?.id;
  const workspaceId = dashboard?.workspace?.id;
  const [desk, setDesk] = useState<Desk | null>(null);
  const [deskError, setDeskError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (organizationId === undefined || workspaceId === undefined) return;
    loadDesk({ organizationId, workspaceId }).then(
      (loaded) => {
        setDesk(loaded);
        setDeskError(null);
      },
      (caught: unknown) =>
        setDeskError(caught instanceof ApiError ? caught.message : 'Could not load your desk.'),
    );
  }, [organizationId, workspaceId]);

  useEffect(() => {
    load();
    window.addEventListener(CHANGE_EVENT, load);
    return () => window.removeEventListener(CHANGE_EVENT, load);
  }, [load]);

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
      <DeskView
        scope={scope}
        firstName={dashboard.user.displayName.split(' ')[0] ?? dashboard.user.displayName}
        desk={desk}
        error={deskError}
        onRetry={load}
      />
    </AppShell>
  );
}

/** Props of {@link DeskView}. */
export interface DeskViewProps {
  scope: HiringScope;
  firstName: string;
  /** `null` while the desk is being read. */
  desk: Desk | null;
  error?: string | null;
  onRetry?: () => void;
}

/** The pure page content (exported for tests). */
export function DeskView({
  scope,
  firstName,
  desk,
  error = null,
  onRetry,
}: DeskViewProps): JSX.Element {
  const href = (screen: DeskScreen): string =>
    `/app/${screen}?organizationId=${encodeURIComponent(scope.organizationId)}&workspaceId=${encodeURIComponent(scope.workspaceId)}`;

  return (
    <Page>
      <PageHeader
        title={`${firstName}'s desk`}
        lede="What is waiting for you, and what is moving without you."
      />

      {error !== null ? (
        <Card padding={5}>
          <div className="nexora-page-head" style={{ alignItems: 'center' }}>
            <p role="alert" style={{ color: 'var(--nexora-danger)' }}>
              {error}
            </p>
            {onRetry === undefined ? null : (
              <Button variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            )}
          </div>
        </Card>
      ) : desk === null ? (
        <Card padding={5}>
          <p style={{ color: 'var(--nexora-textSecondary)' }}>Reading your desk…</p>
        </Card>
      ) : (
        <>
          <Section title="Waiting for you" count={desk.mine.length}>
            {desk.mine.length === 0 ? (
              <Card padding={6}>
                <EmptyState
                  icon={<NavIcon name="check" size={18} />}
                  title="Nothing is waiting for you"
                  description="When a request needs your decision, a candidate needs your feedback or a new colleague needs your part of their onboarding, it shows up here."
                />
              </Card>
            ) : (
              <Card padding={0} className="nexora-turn" style={{ overflow: 'hidden' }}>
                <div className="nexora-rows">
                  {desk.mine.map((item) => (
                    <DeskRow key={item.id} item={item} href={href(item.screen)} mine />
                  ))}
                </div>
              </Card>
            )}
          </Section>

          {desk.starts.length > 0 ? (
            <Section title="Start something">
              <Card padding={0} style={{ overflow: 'hidden' }}>
                <div className="nexora-rows">
                  {desk.starts.map((item) => (
                    <DeskRow key={item.id} item={item} href={href(item.screen)} />
                  ))}
                </div>
              </Card>
            </Section>
          ) : null}

          {desk.watching.length > 0 ? (
            <Section title="In motion" count={desk.watching.length} hint="with other people">
              <Card padding={0} style={{ overflow: 'hidden' }}>
                <div className="nexora-rows">
                  {desk.watching.map((item) => (
                    <DeskRow key={item.id} item={item} href={href(item.screen)} />
                  ))}
                </div>
              </Card>
            </Section>
          ) : null}
        </>
      )}
    </Page>
  );
}

function DeskRow({
  item,
  href,
  mine = false,
}: {
  item: DeskItem;
  href: string;
  mine?: boolean;
}): JSX.Element {
  const screen = SCREEN[item.screen];
  return (
    <div className="nexora-desk-row">
      <span className="nexora-desk-icon" data-mine={mine} aria-hidden>
        <NavIcon name={screen.icon} size={16} />
      </span>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div
          style={{
            fontSize: typography.sizes.md,
            fontWeight: typography.weights.semibold,
            overflowWrap: 'anywhere',
          }}
        >
          {item.title}
        </div>
        <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
          {item.detail}
        </div>
      </div>
      <Link to={href} style={{ textDecoration: 'none' }}>
        <Button variant={mine ? 'primary' : 'secondary'} size={mine ? 'md' : 'sm'}>
          Open {screen.label}
        </Button>
      </Link>
    </div>
  );
}
