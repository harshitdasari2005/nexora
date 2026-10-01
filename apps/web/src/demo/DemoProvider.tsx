/**
 * @nexora/app-web — demo mode provider.
 *
 * Resolves `/api/demo/config` once (a 404 means demo mode is off) and exposes
 * persona switching and reset. The CURRENT persona is derived from the real
 * session (`/api/me`), so switching is "start another real session, then
 * re-read who I am" — never "change currentUser.role".
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  demoLogin,
  demoReset,
  fetchDemoConfig,
  type DemoConfig,
  type DemoPersona,
} from '../lib/demo.js';
import { ApiError } from '../lib/api.js';
import { useSession } from '../session.js';
import { clearGuidedRun } from './guided-store.js';
import { DemoContext, type DemoState } from './demo-state.js';

/** Provides demo mode to the application tree (inside the SessionProvider). */
export function DemoProvider({ children }: { children: ReactNode }): JSX.Element {
  const session = useSession();
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [status, setStatus] = useState<DemoState['status']>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchDemoConfig()
      .then((loaded) => {
        if (cancelled) return;
        setConfig(loaded);
        setStatus(loaded === null ? 'disabled' : 'enabled');
      })
      .catch(() => {
        // A config failure must not lock a normal (non-demo) deployment out.
        if (!cancelled) setStatus('disabled');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const displayName = session.data?.user.displayName;
  const persona: DemoPersona | null = useMemo(
    () => config?.personas.find((candidate) => candidate.displayName === displayName) ?? null,
    [config, displayName],
  );

  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await work();
        await session.reload();
      } catch (failure) {
        setError(failure instanceof ApiError ? failure.message : 'The demo request failed.');
      } finally {
        setBusy(false);
      }
    },
    [session],
  );

  const switchPersona = useCallback((key: DemoPersona['key']) => run(() => demoLogin(key)), [run]);
  const reset = useCallback(
    () =>
      run(async () => {
        await demoReset();
        // The browser's pointers to the old run are meaningless after a reset.
        clearGuidedRun();
      }),
    [run],
  );

  const value = useMemo<DemoState>(
    () => ({ status, config, persona, busy, error, switchPersona, reset }),
    [status, config, persona, busy, error, switchPersona, reset],
  );
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}
