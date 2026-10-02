/**
 * @nexora/app-web — Demo entry ("Start Demo").
 *
 * The public doorway into the gated demo: when the backend reports demo mode,
 * it lists the seeded personas and starts a REAL session for the chosen one;
 * when demo mode is off, it says so and offers normal sign-in. It never
 * pretends to be signed in — the session that follows comes from the server.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, Badge, Button, Card, Stack, typography } from '@nexora/design-system';

import { LoadingScreen } from '../components/LoadingScreen.js';
import { Page, Route, Section } from '../components/Page.js';
import { useDemo } from '../demo/demo-state.js';
import { demoHomePath, type DemoPersona } from '../lib/demo.js';

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

/** The stations of the story, shown before anyone has started it. */
const STORY_ROUTE = [
  'Manager asks',
  'CEO decides',
  'Finance decides',
  'HR recruits',
  'Onboarding',
  'On the project',
].map((label) => ({ label, state: 'waiting' as const, note: '' }));

/** The Start Demo page. */
export function DemoStart(): JSX.Element {
  const demo = useDemo();
  const navigate = useNavigate();
  const [starting, setStarting] = useState<DemoPersona['key'] | null>(null);

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

  return (
    <Page standalone>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1
          className="nexora-page-title"
          style={{ fontSize: 'clamp(2rem, 1.2rem + 3.4vw, 3.4rem)', maxWidth: '18ch' }}
        >
          See one hire through, the way an office does it.
        </h1>
        <p className="nexora-page-lede" style={{ fontSize: typography.sizes.md }}>
          Lumen Capital is a demo office with eight people in it. Take any seat: each person sees
          and can do only what their job allows. The story starts when the Team Manager asks for a
          new developer.
        </p>
        {!config.seeded ? (
          <Badge tone="warning" style={{ alignSelf: 'flex-start' }}>
            The demo organization is not seeded yet. Restart the API.
          </Badge>
        ) : null}
      </header>

      <Card padding={6}>
        <Stack gap={5} stretch>
          <Route stops={STORY_ROUTE} />
          {manager === undefined ? null : (
            <div className="nexora-actions">
              <Button
                size="lg"
                disabled={demo.busy || !config.seeded}
                loading={starting === manager.key}
                onClick={() => void start(manager.key)}
              >
                Start the story as the {manager.title}
              </Button>
              <span style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
                You can change seats at any time from the top bar.
              </span>
            </div>
          )}
        </Stack>
      </Card>

      <Section title="Or take any seat" count={people.length}>
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
