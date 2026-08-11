/**
 * @nexora/app-web — Landing.
 *
 * The public landing page (FRONTEND.md §3 information architecture): brand
 * hero, value proposition, and the login entry point.
 */

import { Link } from 'react-router-dom';
import { Badge, Button, Card, Stack, typography } from '@nexora/design-system';

const FEATURES = [
  {
    icon: '🤖',
    title: 'AI-native',
    description:
      'Every app owns an AI agent. One orchestrator plans, coordinates, and executes your workflows from plain language.',
  },
  {
    icon: '🧩',
    title: 'Modular apps',
    description:
      'Install only what you need — HR, Projects, CRM, Finance and more. New apps drop in without changing the platform.',
  },
  {
    icon: '🛡️',
    title: 'Enterprise grade',
    description:
      'Multi-tenant, auditable, and secure by design. Humans stay in control of every consequential action.',
  },
] as const;

/** The public landing page. */
export function Landing(): JSX.Element {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top navigation */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 32px',
          borderBottom: '1px solid var(--nexora-border)',
          background: 'var(--nexora-surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
            }}
          >
            ✦
          </span>
          <span style={{ fontWeight: typography.weights.bold, fontSize: typography.sizes.md }}>
            Nexora
          </span>
        </div>
        <Link to="/login">
          <Button variant="secondary" size="sm">
            Sign in
          </Button>
        </Link>
      </header>

      {/* Hero */}
      <main style={{ flex: 1, padding: '72px 24px' }}>
        <Stack
          gap={6}
          align="center"
          style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto' }}
        >
          <Badge tone="ai" dot>
            AI-native enterprise operating system
          </Badge>
          <h1
            style={{
              fontSize: typography.sizes['4xl'],
              lineHeight: typography.lineHeights.tight,
              letterSpacing: '-0.02em',
              fontWeight: typography.weights.bold,
            }}
          >
            Work.{' '}
            <span
              style={{
                background: 'linear-gradient(120deg, #6366f1, #7c3aed)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              Orchestrated
            </span>{' '}
            by AI.
          </h1>
          <p
            style={{
              fontSize: typography.sizes.lg,
              color: 'var(--nexora-textSecondary)',
              lineHeight: typography.lineHeights.relaxed,
            }}
          >
            Stop jumping between modules. Tell Nexora what you need — it plans the work, coordinates
            your apps, and reports the result. Humans approve the consequential steps.
          </p>
          <Stack direction="row" gap={3} justify="center">
            <Link to="/login">
              <Button size="lg">Get started</Button>
            </Link>
            <Link to="/login">
              <Button variant="secondary" size="lg">
                Explore the platform
              </Button>
            </Link>
          </Stack>
        </Stack>

        {/* Feature cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
            maxWidth: 960,
            margin: '72px auto 0',
          }}
        >
          {FEATURES.map((feature) => (
            <Card key={feature.title} interactive>
              <Stack gap={3}>
                <span aria-hidden style={{ fontSize: 24 }}>
                  {feature.icon}
                </span>
                <h3
                  style={{ fontSize: typography.sizes.md, fontWeight: typography.weights.semibold }}
                >
                  {feature.title}
                </h3>
                <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
                  {feature.description}
                </p>
              </Stack>
            </Card>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--nexora-border)',
          padding: '20px 32px',
          display: 'flex',
          justifyContent: 'space-between',
          color: 'var(--nexora-textMuted)',
          fontSize: typography.sizes.sm,
        }}
      >
        <span>Nexora — Work. Orchestrated by AI.</span>
        <span>© 2026 Nexora</span>
      </footer>
    </div>
  );
}
