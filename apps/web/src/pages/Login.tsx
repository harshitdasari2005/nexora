/**
 * @nexora/app-web — Login.
 *
 * The SSO entry point. Authentication is delegated to the OIDC identity
 * provider (Keycloak): as soon as the page confirms there is no active
 * session it redirects straight to `/api/auth/login` and the browser
 * follows the authorization-code flow (FRONTEND.md §6). There is no
 * intermediate "Continue with SSO" screen — "Get started" / "Sign in" take
 * the user directly to the identity provider. A minimal "redirecting" state
 * (with a manual fallback link) is shown only for the brief moment before
 * the navigation happens, or if the browser blocks the automatic redirect.
 */

import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button, Stack, typography } from '@nexora/design-system';

import { DigitalHeadquarters } from '../components/DigitalHeadquarters.js';
import { IntelligenceNetwork } from '../components/IntelligenceNetwork.js';
import { useSession } from '../session.js';

/** The identity-provider sign-in URL (server-driven OIDC authorization-code flow). */
const SSO_LOGIN_URL = '/api/auth/login';

/** The SSO entry point — redirects straight to the identity provider. */
export function Login(): JSX.Element {
  const { data, loading } = useSession();
  const redirected = useRef(false);
  const [showFallback, setShowFallback] = useState(false);

  // As soon as we know there is no session, go straight to the IdP. No
  // intermediate card, no extra click.
  useEffect(() => {
    if (loading || data !== null || redirected.current) {
      return;
    }
    redirected.current = true;
    window.location.assign(SSO_LOGIN_URL);
    // If the navigation is somehow blocked or slow, surface a manual link.
    const id = window.setTimeout(() => setShowFallback(true), 2500);
    return () => window.clearTimeout(id);
  }, [loading, data]);

  if (!loading && data !== null) {
    return <Navigate to="/app" replace />;
  }

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

      <Stack
        gap={4}
        align="center"
        style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}
      >
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
        <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
          Taking you to your organization&apos;s sign-in…
        </p>
        {showFallback ? (
          <Button size="lg" onClick={() => window.location.assign(SSO_LOGIN_URL)}>
            Continue to sign in
          </Button>
        ) : null}
      </Stack>
    </div>
  );
}
