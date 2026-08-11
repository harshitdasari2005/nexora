/**
 * @nexora/app-web — Login.
 *
 * The SSO login page. Authentication is delegated to the OIDC identity
 * provider (Keycloak): the SPA redirects to `/api/auth/login` and the
 * browser follows the authorization-code flow (FRONTEND.md §6).
 */

import { Navigate } from 'react-router-dom';
import { Button, Card, Stack, typography } from '@nexora/design-system';

import { useSession } from '../session.js';

/** The SSO login page. */
export function Login(): JSX.Element {
  const { data, loading } = useSession();

  if (!loading && data !== null) {
    return <Navigate to="/app" replace />;
  }

  const startSso = (): void => {
    window.location.assign('/api/auth/login');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background:
          'radial-gradient(1200px 600px at 50% -10%, var(--nexora-primarySoft), transparent)',
      }}
    >
      <Card padding={8} elevationLevel="md" style={{ width: '100%', maxWidth: 400 }}>
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
          <Button size="lg" fullWidth onClick={startSso}>
            Continue with SSO
          </Button>
          <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            You&apos;ll be redirected to your identity provider to authenticate.
          </p>
        </Stack>
      </Card>
    </div>
  );
}
