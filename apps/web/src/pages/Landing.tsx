/**
 * @nexora/app-web — Landing.
 *
 * The public landing page (FRONTEND.md §3 information architecture): brand
 * hero, value proposition, and the login entry point. The hero is staged
 * over the Nexora Intelligence Network (`IntelligenceNetwork`) — a
 * decorative Canvas scene, never the message itself; the copy and CTAs
 * remain the actual content.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Stack, typography } from '@nexora/design-system';

import { IntelligenceNetwork } from '../components/IntelligenceNetwork.js';

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

const TRANSITION_MS = 650;

/** The public landing page. */
export function Landing(): JSX.Element {
  const navigate = useNavigate();
  const [transitioning, setTransitioning] = useState(false);
  const [entered, setEntered] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Triggers the progressive entrance one frame after mount.
    const id = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  const goToLogin = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Preserve modifier-key / middle-click "open in new tab" — only
      // intercept a plain click to play the transition.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        navigate('/login');
        return;
      }
      setTransitioning(true);
      timeoutRef.current = window.setTimeout(() => navigate('/login'), TRANSITION_MS);
    },
    [navigate],
  );

  return (
    <div
      data-theme="dark"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--nexora-bg)',
        color: 'var(--nexora-text)',
        overflowX: 'hidden',
        opacity: transitioning ? 0 : 1,
        transform: transitioning ? 'scale(1.02)' : 'scale(1)',
        filter: transitioning ? 'blur(6px)' : 'blur(0px)',
        transition: `opacity ${TRANSITION_MS}ms cubic-bezier(0.2,0,0,1), transform ${TRANSITION_MS}ms cubic-bezier(0.2,0,0,1), filter ${TRANSITION_MS}ms cubic-bezier(0.2,0,0,1)`,
      }}
    >
      {/* Top navigation */}
      <header
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px 32px',
          borderBottom: '1px solid var(--nexora-border)',
          background: 'rgba(12, 10, 9, 0.55)',
          backdropFilter: 'blur(12px)',
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
              boxShadow: '0 0 24px rgba(124, 58, 237, 0.45)',
            }}
          >
            ✦
          </span>
          <span style={{ fontWeight: typography.weights.bold, fontSize: typography.sizes.md }}>
            Nexora
          </span>
        </div>
        <Link to="/login" onClick={goToLogin}>
          <Button variant="secondary" size="sm">
            Sign in
          </Button>
        </Link>
      </header>

      {/* Hero */}
      <main style={{ flex: 1, position: 'relative' }}>
        <div
          style={{
            position: 'relative',
            minHeight: '72vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '64px 24px',
            overflow: 'hidden',
          }}
        >
          <IntelligenceNetwork converging={transitioning} />

          <Stack
            gap={6}
            align="center"
            style={{
              position: 'relative',
              zIndex: 1,
              textAlign: 'center',
              maxWidth: 720,
              margin: '0 auto',
            }}
          >
            <div
              className={entered ? 'nexora-enter' : ''}
              style={{ animationDelay: '0ms', opacity: entered ? undefined : 0 }}
            >
              <Badge tone="ai" dot>
                AI-native enterprise operating system
              </Badge>
            </div>
            <h1
              className={entered ? 'nexora-enter' : ''}
              style={{
                animationDelay: '90ms',
                opacity: entered ? undefined : 0,
                fontSize: typography.sizes['4xl'],
                lineHeight: typography.lineHeights.tight,
                letterSpacing: '-0.02em',
                fontWeight: typography.weights.bold,
                textShadow: '0 2px 40px rgba(0,0,0,0.5)',
              }}
            >
              Work.{' '}
              <span
                style={{
                  background: 'linear-gradient(120deg, #818cf8, #c4b5fd)',
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
              className={entered ? 'nexora-enter' : ''}
              style={{
                animationDelay: '180ms',
                opacity: entered ? undefined : 0,
                fontSize: typography.sizes.lg,
                color: 'var(--nexora-textSecondary)',
                lineHeight: typography.lineHeights.relaxed,
              }}
            >
              Stop jumping between modules. Tell Nexora what you need — it plans the work,
              coordinates your apps, and reports the result. Humans approve the consequential steps.
            </p>
            <Stack
              direction="row"
              gap={3}
              justify="center"
              className={entered ? 'nexora-enter' : ''}
              style={{ animationDelay: '270ms', opacity: entered ? undefined : 0 }}
            >
              <Link to="/login" onClick={goToLogin}>
                <Button size="lg">Get started</Button>
              </Link>
              <Link to="/login" onClick={goToLogin}>
                <Button variant="secondary" size="lg">
                  Explore the platform
                </Button>
              </Link>
            </Stack>
          </Stack>
        </div>

        {/* Feature cards */}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
            maxWidth: 960,
            margin: '0 auto',
            padding: '0 24px 96px',
          }}
        >
          {FEATURES.map((feature) => (
            <Card
              key={feature.title}
              interactive
              style={{ background: 'var(--nexora-surface)', borderColor: 'var(--nexora-border)' }}
            >
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
          position: 'relative',
          zIndex: 1,
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

      <style>{`
        @keyframes nexora-hero-enter {
          from { opacity: 0; transform: translateY(14px); filter: blur(6px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        .nexora-enter {
          animation: nexora-hero-enter 700ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
      `}</style>
    </div>
  );
}
