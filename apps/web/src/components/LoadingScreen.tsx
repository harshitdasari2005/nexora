/**
 * @nexora/app-web — LoadingScreen.
 *
 * The full-viewport loading state (FRONTEND.md §13 loading): centered
 * spinner with the wordmark.
 */

import { Spinner, typography } from '@nexora/design-system';

/** Renders the app loading state. */
export function LoadingScreen(): JSX.Element {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <span style={{ fontSize: typography.sizes.xl, fontWeight: typography.weights.bold }}>
        Nexora
      </span>
      <Spinner size={20} />
    </div>
  );
}
