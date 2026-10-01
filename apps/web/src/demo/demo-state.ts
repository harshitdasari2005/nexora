/**
 * @nexora/app-web — demo mode state shape (context only).
 *
 * Kept free of imports from `session.tsx` so the session gate can read it
 * without a cycle. The provider lives in `DemoProvider.tsx`.
 */

import { createContext, useContext } from 'react';

import type { DemoConfig, DemoPersona } from '../lib/demo.js';

/** Demo mode as seen by the UI. */
export interface DemoState {
  /** `loading` until `/api/demo/config` answers; `disabled` on a 404 (demo mode off). */
  status: 'loading' | 'disabled' | 'enabled';
  config: DemoConfig | null;
  /** The persona of the CURRENT backend session (derived from `/api/me`, never chosen client-side). */
  persona: DemoPersona | null;
  /** True while a persona switch or a reset is in flight. */
  busy: boolean;
  /** The last switch/reset failure, if any. */
  error: string | null;
  /** Starts a real session as `key` (POST /api/demo/login) and reloads the session. */
  switchPersona: (key: DemoPersona['key']) => Promise<void>;
  /** Resets the demo world (POST /api/demo/reset) and reloads the session. */
  reset: () => Promise<void>;
}

const DISABLED: DemoState = {
  status: 'disabled',
  config: null,
  persona: null,
  busy: false,
  error: null,
  switchPersona: async () => undefined,
  reset: async () => undefined,
};

export const DemoContext = createContext<DemoState>(DISABLED);

/** Consumes demo mode (a disabled state outside the provider). */
export function useDemo(): DemoState {
  return useContext(DemoContext);
}
