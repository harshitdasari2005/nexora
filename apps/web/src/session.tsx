/**
 * @nexora/app-web — session context.
 *
 * Resolves the current session once at the application root
 * ({@link SessionProvider}) and exposes it to pages via {@link useSession}.
 * {@link RequireAuth} gates protected routes: it redirects unauthenticated
 * sessions to the login flow.
 */

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { ErrorState } from './components/ErrorState.js';
import { LoadingScreen } from './components/LoadingScreen.js';
import { useMe } from './hooks/use-me.js';
import type { ApiError } from './lib/api.js';
import type { MeResponse } from './lib/types.js';

/** The session state shared across the app. */
export interface Session {
  /** The resolved session data, or `null` until loaded. */
  data: MeResponse | null;
  /** Whether the session request is in flight. */
  loading: boolean;
  /** The session request error, or `null`. */
  error: ApiError | null;
  /** Re-resolves the session. */
  reload: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

/** Provides the current session to the application tree. */
export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const session = useMe();
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** Consumes the current session. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return session;
}

/** Gates a protected route behind an authenticated session. */
export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { data, loading, error, reload } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && error?.isUnauthorized) {
      navigate('/login', { replace: true });
    }
  }, [loading, error, navigate]);

  if (loading) {
    return <LoadingScreen />;
  }
  if (error !== null && !error.isUnauthorized) {
    // A non-auth failure (e.g. 5xx) must not spin forever: surface it with
    // a retry instead of blocking the user on a loading screen.
    return <ErrorState message={error.message} onRetry={() => void reload()} />;
  }
  if (data === null) {
    return <LoadingScreen />;
  }
  return <>{children}</>;
}
