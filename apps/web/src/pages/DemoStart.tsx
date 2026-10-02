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
import { Badge, Button, Card, Stack, typography } from '@nexora/design-system';

import { LoadingScreen } from '../components/LoadingScreen.js';
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
];

/** The Start Demo page. */
export function DemoStart(): JSX.Element {
  const demo = useDemo();
  const navigate = useNavigate();
  const [starting, setStarting] = useState<DemoPersona['key'] | null>(null);

  if (demo.status === 'loading') return <LoadingScreen />;

  const shell = (children: JSX.Element): JSX.Element => (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--nexora-bg)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 920 }}>{children}</div>
    </div>
  );

  if (demo.status === 'disabled' || demo.config === null) {
    return shell(
      <Card padding={10} elevationLevel="md">
        <Stack gap={4}>
          <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
            Demo mode is not enabled
          </h1>
          <p style={{ color: 'var(--nexora-textSecondary)' }}>
            Start the API with <code>NEXORA_DEMO_MODE=true</code> to enable the guided demo. Normal
            sign-in is unaffected.
          </p>
          <Stack direction="row" gap={3}>
            <a href="/api/auth/login" style={{ textDecoration: 'none' }}>
              <Button>Sign in</Button>
            </a>
            <Link to="/" style={{ textDecoration: 'none' }}>
              <Button variant="ghost">Back</Button>
            </Link>
          </Stack>
        </Stack>
      </Card>,
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

  return shell(
    <Stack gap={6}>
      <Stack gap={2}>
        <Badge tone="ai" dot>
          Guided demo
        </Badge>
        <h1 className="nexora-page-title">Governed AI, end to end.</h1>
        <p style={{ color: 'var(--nexora-textSecondary)', maxWidth: 640 }}>
          Sign in as anyone in the office — the CEO, the CTO, the Team Manager, the IT team, HR or
          Finance. Each person sees and can do only what their role allows. The guided story (a
          governed hire and a governed expense) begins with the CEO.
        </p>
        {!config.seeded ? (
          <Badge tone="warning">The demo organization is not seeded yet — restart the API.</Badge>
        ) : null}
      </Stack>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        {ORDER.map((key) => config.personas.find((p) => p.key === key))
          .filter((p): p is DemoPersona => p !== undefined)
          .map((persona) => (
            <Card key={persona.key} interactive padding={5}>
              <Stack gap={3} style={{ height: '100%' }}>
                <Stack gap={1}>
                  <div style={{ fontWeight: typography.weights.semibold }}>
                    {persona.displayName}
                  </div>
                  <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                    {persona.title}
                  </div>
                </Stack>
                <p
                  style={{
                    fontSize: typography.sizes.sm,
                    color: 'var(--nexora-textSecondary)',
                    flex: 1,
                  }}
                >
                  {persona.responsibility}
                </p>
                <Button
                  size="sm"
                  variant={persona.key === 'ceo' ? 'primary' : 'secondary'}
                  disabled={demo.busy || !config.seeded}
                  loading={starting === persona.key}
                  onClick={() => void start(persona.key)}
                >
                  {persona.key === 'ceo' ? 'Start as the CEO' : `Enter as ${persona.title}`}
                </Button>
              </Stack>
            </Card>
          ))}
      </div>
      {demo.error !== null ? (
        <p role="alert" style={{ color: 'var(--nexora-danger)', fontSize: typography.sizes.sm }}>
          {demo.error}
        </p>
      ) : null}
      <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
        Every persona is a real seeded account with a real session. What each one may do is decided
        by Nexora’s authorization pipeline, not by this page.
      </div>
    </Stack>,
  );
}
