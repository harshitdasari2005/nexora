/**
 * @nexora/app-web — Demo entry ("Start Demo").
 *
 * The public doorway into the gated demo: when the backend reports demo mode,
 * it offers every story line (hiring, a project, each department's workflows)
 * and the seeded personas, and starts a REAL session for whoever acts next;
 * when demo mode is off, it says so and offers normal sign-in. It never
 * pretends to be signed in — the session that follows comes from the server.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, Badge, Button, Card, Stack, typography } from '@nexora/design-system';

import { LoadingScreen } from '../components/LoadingScreen.js';
import { Page, Route, Section } from '../components/Page.js';
import { useDemo } from '../demo/demo-state.js';
import {
  demoHomePath,
  demoScopeQuery,
  fetchDemoStorylines,
  selectStory,
  type DemoPersona,
  type StorySummary,
} from '../lib/demo.js';

const ORDER: DemoPersona['key'][] = [
  'ceo',
  'cto',
  'manager',
  'dev_aarav',
  'dev_meghna',
  'hr',
  'cfo',
  'controller',
  'marketing',
  'sales',
  'support',
  'legal',
];

/** The stations of the hiring story, shown while the list of stories is being read. */
const STORY_ROUTE = [
  'Manager asks',
  'CEO decides',
  'Finance decides',
  'HR recruits',
  'Onboarding',
  'On the project',
].map((label) => ({ label, state: 'waiting' as const, note: '' }));

/** "Start as Rohan, Team Manager" / "Continue as Priya, HR Manager". */
export function storyStartLabel(
  story: Pick<StorySummary, 'status' | 'waitingFor'>,
  personas: readonly DemoPersona[],
): string {
  if (story.status === 'finished') return 'See how it went';
  const person = personas.find((candidate) => candidate.key === story.waitingFor[0]);
  const verb = story.status === 'not_started' ? 'Start' : 'Continue';
  return person === undefined
    ? `${verb} the story`
    : `${verb} as ${person.displayName.split(' ')[0] ?? person.displayName}, ${person.title}`;
}

/** The Start Demo page. */
export function DemoStart({
  initialStories = null,
}: {
  /** The story lines, when already known (tests); otherwise they are read. */
  initialStories?: readonly StorySummary[] | null;
}): JSX.Element {
  const demo = useDemo();
  const navigate = useNavigate();
  const [starting, setStarting] = useState<string | null>(null);
  const [stories, setStories] = useState<readonly StorySummary[] | null>(initialStories);
  const enabled = demo.status === 'enabled';
  useEffect(() => {
    if (!enabled || initialStories !== null) return;
    let cancelled = false;
    fetchDemoStorylines().then(
      (list) => {
        if (!cancelled) setStories(list);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, initialStories]);

  if (demo.status === 'loading') return <LoadingScreen />;

  if (demo.status === 'disabled' || demo.config === null) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center' }}>
        <Page standalone>
          <Card padding={8}>
            <Stack gap={4} style={{ maxWidth: 560 }}>
              <h1 className="nexora-page-title">Demo mode is not enabled</h1>
              <p className="nexora-page-lede">
                Start the API with <code>NEXORA_DEMO_MODE=true</code> to open the demo office.
                Normal sign-in is unaffected.
              </p>
              <div className="nexora-actions">
                <a href="/api/auth/login" style={{ textDecoration: 'none' }}>
                  <Button>Sign in</Button>
                </a>
                <Link to="/" style={{ textDecoration: 'none' }}>
                  <Button variant="ghost">Back</Button>
                </Link>
              </div>
            </Stack>
          </Card>
        </Page>
      </div>
    );
  }

  const { config } = demo;
  const start = async (key: DemoPersona['key']): Promise<void> => {
    setStarting(key);
    await demo.switchPersona(key);
    setStarting(null);
    const persona = config.personas.find((p) => p.key === key);
    if (persona !== undefined) {
      navigate(demoHomePath(config.organizationId, persona));
    }
  };
  const people = ORDER.map((key) => config.personas.find((p) => p.key === key)).filter(
    (p): p is DemoPersona => p !== undefined,
  );
  const manager = people.find((person) => person.key === 'manager');
  /** Follows a story from the seat of whoever acts next in it. */
  const startStory = async (story: StorySummary): Promise<void> => {
    const persona =
      config.personas.find((p) => p.key === story.waitingFor[0]) ??
      config.personas.find((p) => p.key === 'ceo');
    if (persona === undefined) return;
    setStarting(story.key);
    selectStory(story.key);
    await demo.switchPersona(persona.key);
    setStarting(null);
    navigate(`/app/demo?${demoScopeQuery(config.organizationId, persona)}`);
  };
  const featured = (stories ?? []).filter((story) => !story.key.startsWith('flow.'));
  const workflows = (stories ?? []).filter((story) => story.key.startsWith('flow.'));
  const departments = [...new Set(workflows.map((story) => story.department))];
  const teams = new Set(config.personas.map((persona) => persona.workspaceId)).size;
  const unavailable = demo.busy || !config.seeded;

  return (
    <Page standalone>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1
          className="nexora-page-title"
          style={{ fontSize: 'clamp(2rem, 1.2rem + 3.4vw, 3.4rem)', maxWidth: '20ch' }}
        >
          Watch an office work, one story at a time.
        </h1>
        <p className="nexora-page-lede" style={{ fontSize: typography.sizes.md }}>
          Lumen Capital is a demo office with {people.length} people in {teams} teams. Pick a story
          and follow it from seat to seat: each person sees and can do only what their job allows,
          and an assistant helps at every step without ever deciding for anyone.
        </p>
        {!config.seeded ? (
          <Badge tone="warning" style={{ alignSelf: 'flex-start' }}>
            The demo organization is not seeded yet. Restart the API.
          </Badge>
        ) : null}
      </header>

      {stories === null ? (
        <Card padding={6}>
          <Stack gap={5} stretch>
            <Route stops={STORY_ROUTE} />
            {manager === undefined ? null : (
              <div className="nexora-actions">
                <Button
                  size="lg"
                  disabled={unavailable}
                  loading={starting === manager.key}
                  onClick={() => void start(manager.key)}
                >
                  Start the story as the {manager.title}
                </Button>
                <span
                  style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}
                >
                  You can change seats at any time from the top bar.
                </span>
              </div>
            )}
          </Stack>
        </Card>
      ) : (
        <>
          <Section title="Two stories that cross the whole office">
            <div className="nexora-story-cards">
              {featured.map((story) => (
                <Card key={story.key} padding={6}>
                  <Stack gap={4} stretch>
                    <div>
                      <h3 className="nexora-section-title" style={{ margin: 0 }}>
                        {story.title}
                      </h3>
                      <p
                        style={{
                          margin: '6px 0 0',
                          fontSize: typography.sizes.sm,
                          color: 'var(--nexora-textSecondary)',
                        }}
                      >
                        {story.about}
                      </p>
                    </div>
                    <ol className="nexora-story-outline">
                      {(story.steps ?? []).map((step, index) => (
                        <li key={step} data-done={index < story.stepsDone}>
                          {step}
                        </li>
                      ))}
                    </ol>
                    <div className="nexora-actions">
                      <Button
                        disabled={unavailable}
                        loading={starting === story.key}
                        onClick={() => void startStory(story)}
                      >
                        {storyStartLabel(story, config.personas)}
                      </Button>
                      {story.status === 'in_progress' ? (
                        <span
                          style={{
                            fontSize: typography.sizes.sm,
                            color: 'var(--nexora-textSecondary)',
                          }}
                        >
                          {story.stepsDone} of {story.stepCount} steps done
                        </span>
                      ) : null}
                    </div>
                  </Stack>
                </Card>
              ))}
            </div>
          </Section>

          <Section
            title="Every department's everyday work"
            count={workflows.length}
            hint="Each one runs its own chain of people"
          >
            {departments.map((department) => (
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
                <div className="nexora-choice">
                  {workflows
                    .filter((story) => story.department === department)
                    .map((story) => (
                      <button
                        key={story.key}
                        type="button"
                        className="nexora-choice-option"
                        disabled={unavailable || starting !== null}
                        onClick={() => void startStory(story)}
                      >
                        <span style={{ fontWeight: typography.weights.semibold }}>
                          {story.title}
                        </span>
                        <span
                          style={{
                            fontSize: typography.sizes.sm,
                            color: 'var(--nexora-textSecondary)',
                          }}
                        >
                          {story.about}
                        </span>
                        <span
                          style={{
                            fontSize: typography.sizes.xs,
                            color: 'var(--nexora-textMuted)',
                          }}
                        >
                          {story.stepCount} {story.stepCount === 1 ? 'step' : 'steps'}.{' '}
                          {starting === story.key
                            ? 'Opening…'
                            : storyStartLabel(story, config.personas)}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </Section>
        </>
      )}

      <Section title="Or take any seat and look around" count={people.length}>
        <Card padding={0} style={{ overflow: 'hidden' }}>
          <div className="nexora-rows">
            {people.map((persona) => (
              <div key={persona.key} className="nexora-desk-row">
                <Avatar name={persona.displayName} size={40} />
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: typography.sizes.md,
                      fontWeight: typography.weights.semibold,
                    }}
                  >
                    {persona.displayName}
                    <span
                      style={{
                        fontWeight: typography.weights.regular,
                        color: 'var(--nexora-textSecondary)',
                      }}
                    >
                      , {persona.title}
                    </span>
                  </div>
                  <div
                    style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}
                  >
                    {persona.responsibility}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  disabled={demo.busy || !config.seeded}
                  loading={starting === persona.key}
                  onClick={() => void start(persona.key)}
                  aria-label={`Enter as ${persona.title}, ${persona.displayName}`}
                >
                  Enter as {persona.title}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {demo.error !== null ? (
        <p role="alert" style={{ color: 'var(--nexora-danger)', fontSize: typography.sizes.sm }}>
          {demo.error}
        </p>
      ) : null}
      <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}>
        Every person is a real seeded account with a real session. What each one may do is decided
        by Nexora’s authorization pipeline, not by this page.
      </p>
    </Page>
  );
}
