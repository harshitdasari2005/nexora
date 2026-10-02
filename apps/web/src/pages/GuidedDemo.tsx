/**
 * @nexora/app-web — the Guided Demo.
 *
 * One hire, the way an office runs it: the team's manager asks, the CEO
 * decides, Finance decides, HR recruits and makes the offer, HR, IT and the
 * manager onboard the new colleague, and the manager puts them on the project.
 *
 * The page performs none of it. Every step is done on the real screens
 * (Hiring, Recruiting, Onboarding) by the person whose job it is; this page
 * only shows where the story stands — derived on the server from the hiring
 * records — and whose turn it is.
 */

import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { NavIcon } from '../components/NavIcon.js';
import { Page, PageHeader, Section } from '../components/Page.js';
import { StoryBarView, useDemoStory } from '../components/StoryBar.js';
import { useDemo } from '../demo/demo-state.js';
import {
  demoScopeQuery,
  type DemoPersona,
  type DemoStory,
  type StoryScreen,
  type StoryStep,
} from '../lib/demo.js';
import { useShellScope } from '../lib/useShellScope.js';

/** Whose job each step is in an office (the titles, not the people). */
const STEP_OWNER: Record<string, string> = {
  raise: 'The team’s manager',
  ceo: 'The CEO',
  finance: 'Finance',
  open: 'HR',
  candidates: 'HR, with the hiring manager interviewing',
  offer: 'HR',
  onboard: 'HR, IT and the hiring manager',
  assign: 'The hiring manager',
};

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
  const navigate = useNavigate();
  const { dashboard, loading, error, reload } = useShellScope();

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
  if (demo.persona === null) {
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
  const { config, persona } = demo;
  const ownScope = `organizationId=${encodeURIComponent(dashboard.organization.id)}&workspaceId=${encodeURIComponent(dashboard.workspace.id)}`;

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
        persona={persona}
        personas={config.personas}
        hrefFor={(screen) => `/app/${screen}?${ownScope}`}
        busy={demo.busy}
        onContinueAs={(target, screen) => {
          void demo
            .switchPersona(target.key)
            .then(() =>
              navigate(`/app/${screen}?${demoScopeQuery(config.organizationId, target)}`),
            );
        }}
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
  /** `null` while the story is being read. */
  story: DemoStory | null;
  persona: DemoPersona;
  personas: readonly DemoPersona[];
  hrefFor: (screen: StoryScreen) => string;
  onContinueAs: (persona: DemoPersona, screen: StoryScreen) => void;
  onReset: () => void;
  busy?: boolean;
}

/** The pure page content (exported for tests). */
export function GuidedDemoView({
  story,
  persona,
  personas,
  hrefFor,
  onContinueAs,
  onReset,
  busy = false,
}: GuidedDemoViewProps): JSX.Element {
  return (
    <Page>
      <PageHeader
        title="The hiring story"
        lede="One hire, the way an office runs it. Each step is done on the real screens by the person whose job it is. This page only shows where the story stands."
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
            title={story.subject === undefined ? 'The eight steps' : `Hiring a ${story.subject}`}
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
                    <div
                      style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}
                    >
                      {STEP_OWNER[step.key] ?? ''}
                    </div>
                    <p className="nexora-step-detail">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}
    </Page>
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
