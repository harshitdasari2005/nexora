/**
 * @nexora/app-web — useMe hook.
 *
 * Resolves the current session via `GET /api/me` (user + organizations).
 * Exposes loading and error states; an {@link ApiError} with status 401
 * means the caller should redirect to the login flow.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../lib/api.js';
import type { MeResponse } from '../lib/types.js';

interface UseMeState {
  /** The resolved session data, or `null` until loaded. */
  data: MeResponse | null;
  /** Whether the request is in flight. */
  loading: boolean;
  /** The request error, or `null`. */
  error: ApiError | null;
}

/** Resolves the current session and exposes reload. */
export function useMe(): UseMeState & { reload: () => Promise<void> } {
  const [state, setState] = useState<UseMeState>({
    data: null,
    loading: true,
    error: null,
  });

  const reload = useCallback(async () => {
    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const data = await api<MeResponse>('/me');
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error:
          error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
