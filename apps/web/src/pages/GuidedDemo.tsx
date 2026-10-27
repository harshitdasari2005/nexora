/**
 * @nexora/app-web — the Guided Demo.
 *
 * The demo office can be walked through along several story lines: hiring a
 * colleague, a project from its proposal to its release, and one story per
 * office workflow of every department.
 *
 * The page performs none of it. Every step is done on the real screens by the
 * person whose job it is; this page lets the viewer pick a story, and shows
 * where it stands — derived on the server from the real records — and whose
 * turn it is.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { NavIcon } from '../components/NavIcon.js';
import { Page, PageHeader, Section } from '../components/Page.js';
import { StoryBarView, useDemoStory, useStoryNavigation } from '../components/StoryBar.js';
import { useDemo } from '../demo/demo-state.js';
import { CHANGE_EVENT } from '../lib/api.js';
import {
  fetchDemoStories,
  selectStory,
  type DemoPersona,
  type DemoStory,
  type StoryScreen,
  type StoryStep,
  type StorySummary,
} from '../lib/demo.js';
import { useShellScope } from '../lib/useShellScope.js';

const STATE_LABEL: Record<StoryStep['state'], string> = {
  done: 'Done',
  current: 'Now',
  waiting: 'Not yet',
  skipped: 'Not needed',
  returned: 'Sent back',
};

/** The guided demo page. */
export function GuidedDemo(): JSX.Element {
  const demo = useDemo();
  const story = useDemoStory();
  const { dashboard, loading, error, reload } = useShellScope();
  const [stories, setStories] = useState<StorySummary[] | null>(null);
  const personaKey = demo.persona?.key;
  const navigation = useStoryNavigation(story, {
    ...(dashboard?.organization?.id === undefined
      ? {}
      : { organizationId: dashboard.organization.id }),
    ...(dashboard?.workspace?.id === undefined ? {} : { workspaceId: dashboard.workspace.id }),
  });

  const loadStories = useCallback(() => {
    if (personaKey === undefined) return;
    fetchDemoStories().then(setStories, () => setStories([]));
  }, [personaKey]);
  useEffect(() => {
    loadStories();
    window.addEventListener(CHANGE_EVENT, loadStories);
    return () => window.removeEventListener(CHANGE_EVENT, loadStories);
  }, [loadStories]);

  if (demo.status === 'loading' || (loading && dashboard === null)) return <LoadingScreen />;
  if (demo.status === 'disabled' || demo.config === null) {
    return (
      <Standalone
        title="Demo mode is not enabled"
        text="The guided demo runs in the demo office only."
        action={{ to: '/', label: 'Back to Nexora' }}
      />
    );
  }
  if (error !== null) return <ErrorState message={error.message} onRetry={reload} />;
  if (demo.persona === null || navigation === null) {
    return (
      <Standalone
        title="Pick someone from the demo office"
        text="The guided demo is told from the seats of the people in the demo office. Sign in as one of them to follow it."
        action={{ to: '/demo', label: 'Choose a person' }}
      />
    );
  }
  if (dashboard === null) return <LoadingScreen />;
  if (dashboard.organization === null || dashboard.workspace === null) {
    return <ErrorState message="The demo organization is not ready yet." onRetry={reload} />;
  }

  return (
    <AppShell
      user={dashboard.user}
      organizationName={dashboard.organization.name}
      workspaceName={dashboard.workspace.name}
      organizationId={dashboard.organization.id}
      workspaceId={dashboard.workspace.id}
    >
      <GuidedDemoView
        story={story}
        stories={stories}
        persona={demo.persona}
        personas={demo.config.personas}
        hrefFor={navigation.hrefFor}
        busy={demo.busy}
        onContinueAs={navigation.onContinueAs}
        onPick={selectStory}
        onReset={() => {
          if (window.confirm('Reset the demo organization to its seed? Demo history is cleared.')) {
            void demo.reset();
          }
        }}
      />
    </AppShell>
  );
}

/** Props of {@link GuidedDemoView}. */
export interface GuidedDemoViewProps {
  /** The story being followed; `null` while it is being read. */
  story: DemoStory | null;
  /** Every story line; `null` while they are being read. */
  stories: readonly StorySummary[] | null;
  persona: DemoPersona;
  personas: readonly DemoPersona[];
  hrefFor: (screen: StoryScreen) => string;
  onContinueAs: (persona: DemoPersona, screen: StoryScreen) => void;
  onPick: (key: string) => void;
  onReset: () => void;
  busy?: boolean;
}

/** Where a story stands, in a few words. */
export function storyStatusLabel(summary: StorySummary, personas: readonly DemoPersona[]): string {
  if (summary.status === 'finished') return 'Complete';
  const first = personas.find((person) => person.key === summary.waitingFor[0]);
  const who = first === undefined ? '' : `, ${first.displayName.split(' ')[0]}’s turn`;
  return summary.status === 'not_started'
    ? `Not started${who}`
    : `${summary.stepsDone} of ${summary.stepCount} steps done${who}`;
}

/** The pure page content (exported for tests). */
export function GuidedDemoView({
  story,
  stories,
  persona,
  personas,
  hrefFor,
  onContinueAs,
  onPick,
  onReset,
  busy = false,
}: GuidedDemoViewProps): JSX.Element {
  const departments = [...new Set((stories ?? []).map((entry) => entry.department))];
  // The two stories that span several screens come first, on their own.
  const featured = (stories ?? []).filter((entry) => !entry.key.startsWith('flow.'));
  return (
    <Page>
      <PageHeader
        title="Guided demo"
        lede="Follow a piece of work through the office. Each step is done on the real screens by the person whose job it is; this page shows where the story stands."
        actions={
          <Button variant="ghost" disabled={busy} onClick={onReset}>
            Reset demo
          </Button>
        }
      />

      {story === null ? (
        <Card padding={5}>
          <p style={{ color: 'var(--nexora-textSecondary)' }}>Reading the story…</p>
        </Card>
      ) : (
        <>
          <StoryBarView
            story={story}
            persona={persona}
            personas={personas}
            hrefFor={hrefFor}
            onContinueAs={onContinueAs}
            busy={busy}
          />
          <Section
            title={story.subject === undefined ? story.title : `${story.title}: ${story.subject}`}
          >
            <ol className="nexora-steps">
              {story.steps.map((step, index) => (
                <li key={step.key} className="nexora-step" data-state={step.state}>
                  <span className="nexora-step-mark" aria-hidden>
                    {step.state === 'done' ? <NavIcon name="check" size={16} /> : index + 1}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'baseline',
                        gap: '2px 10px',
                      }}
                    >
                      <h3 className="nexora-step-title">{step.title}</h3>
                      <span className="nexora-step-state">{STATE_LABEL[step.state]}</span>
                    </div>
                    {step.owner === undefined ? null : (
                      <div
                        style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}
                      >
                        {step.owner}
                      </div>
                    )}
                    <p className="nexora-step-detail">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}

      {stories === null ? null : (
        <Section title="Choose a story to follow" count={stories.length}>
          <StoryChoices
            stories={featured}
            selected={story?.key}
            personas={personas}
            onPick={onPick}
          />
          {departments.map((department) => {
            const inDepartment = stories.filter(
              (entry) => entry.department === department && entry.key.startsWith('flow.'),
            );
            return inDepartment.length === 0 ? null : (
              <div key={department} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.semibold,
                    color: 'var(--nexora-textSecondary)',
                    marginTop: 8,
                  }}
                >
                  {department}
                </div>
                <StoryChoices
                  stories={inDepartment}
                  selected={story?.key}
                  personas={personas}
                  onPick={onPick}
                />
              </div>
            );
          })}
        </Section>
      )}
    </Page>
  );
}

function StoryChoices({
  stories,
  selected,
  personas,
  onPick,
}: {
  stories: readonly StorySummary[];
  selected: string | undefined;
  personas: readonly DemoPersona[];
  onPick: (key: string) => void;
}): JSX.Element {
  return (
    <div className="nexora-choice" role="radiogroup" aria-label="Story">
      {stories.map((entry) => (
        <button
          key={entry.key}
          type="button"
          role="radio"
          aria-checked={entry.key === selected}
          className="nexora-choice-option"
          onClick={() => onPick(entry.key)}
        >
          <span style={{ fontWeight: typography.weights.semibold }}>{entry.title}</span>
          <span style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {entry.about}
          </span>
          <span
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.semibold,
              color:
                entry.status === 'finished'
                  ? 'var(--nexora-success)'
                  : entry.status === 'in_progress'
                    ? 'var(--nexora-warning)'
                    : 'var(--nexora-textMuted)',
            }}
          >
            {storyStatusLabel(entry, personas)}
          </span>
        </button>
      ))}
    </div>
  );
}

function Standalone({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action: { to: string; label: string };
}): JSX.Element {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center' }}>
      <Page standalone>
        <Card padding={8}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520 }}>
            <h1 className="nexora-page-title">{title}</h1>
            <p className="nexora-page-lede">{text}</p>
            <div className="nexora-actions">
              <Link to={action.to} style={{ textDecoration: 'none' }}>
                <Button>{action.label}</Button>
              </Link>
            </div>
          </div>
        </Card>
      </Page>
    </div>
  );
}
