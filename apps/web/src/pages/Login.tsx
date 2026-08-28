/**
 * @nexora/app-web — Login.
 *
 * The SSO login page. Authentication is delegated to the OIDC identity
 * provider (Keycloak): the SPA redirects to `/api/auth/login` and the
 * browser follows the authorization-code flow (FRONTEND.md §6). The visual
 * language reuses the Landing page's Intelligence Network, quieter and
 * sparser — authentication semantics are untouched.
 */

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button, Card, Stack, typography } from '@nexora/design-system';

import { DigitalHeadquarters } from '../components/DigitalHeadquarters.js';
import { IntelligenceNetwork } from '../components/IntelligenceNetwork.js';
import { useSession } from '../session.js';

/** The SSO login page. */
export function Login(): JSX.Element {
  const { data, loading } = useSession();
  const [entered, setEntered] = useState(false);
  const [ssoPending, setSsoPending] = useState(false);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  if (!loading && data !== null) {
    return <Navigate to="/app" replace />;
  }

  const startSso = (): void => {
    setSsoPending(true);
    window.location.assign('/api/auth/login');
  };

  return (
    <div
      data-theme="dark"
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--nexora-bg)',
        color: 'var(--nexora-text)',
        overflow: 'hidden',
      }}
    >
      <DigitalHeadquarters quiet />
      <IntelligenceNetwork quiet />

      <Card
        padding={8}
        elevationLevel="lg"
        className={entered ? 'nexora-login-enter' : ''}
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 400,
          background: 'rgba(28, 25, 23, 0.62)',
          backdropFilter: 'blur(20px) saturate(140%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
          opacity: entered ? undefined : 0,
        }}
      >
        <Stack gap={5} align="center" style={{ textAlign: 'center' }}>
          <span
            aria-hidden
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              boxShadow: '0 0 36px rgba(124, 58, 237, 0.5)',
            }}
          >
            ✦
          </span>
          <Stack gap={1}>
            <h1 style={{ fontSize: typography.sizes.xl, fontWeight: typography.weights.bold }}>
              Welcome to Nexora
            </h1>
            <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              Sign in with your organization&apos;s single sign-on to continue.
            </p>
          </Stack>
          <Button size="lg" fullWidth onClick={startSso} loading={ssoPending}>
            Continue with SSO
          </Button>
          <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            You&apos;ll be redirected to your identity provider to authenticate.
          </p>
        </Stack>
      </Card>

      <style>{`
        @keyframes nexora-login-enter {
          from { opacity: 0; transform: translateY(18px) scale(0.98); filter: blur(8px); }
          to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        .nexora-login-enter {
          animation: nexora-login-enter 750ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
      `}</style>
    </div>
  );
}
