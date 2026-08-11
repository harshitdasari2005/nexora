/**
 * @nexora/app-web — OnboardingFrame.
 *
 * The shared two-step onboarding layout (organization → workspace) with the
 * step indicator (FRONTEND.md §5 onboarding).
 */

import type { ReactNode } from 'react';
import { Badge, Stack, typography } from '@nexora/design-system';

/** Props of {@link OnboardingFrame}. */
export interface OnboardingFrameProps {
  /** The active step (1 = organization, 2 = workspace). */
  step: 1 | 2;
  /** The step content. */
  children: ReactNode;
}

/** The shared onboarding frame. */
export function OnboardingFrame({ step, children }: OnboardingFrameProps): JSX.Element {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background:
          'radial-gradient(1000px 500px at 50% -10%, var(--nexora-primarySoft), transparent)',
      }}
    >
      <Stack gap={5} style={{ width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: typography.weights.bold, fontSize: typography.sizes.md }}>
            Nexora
          </span>
          <Stack direction="row" gap={2}>
            <Badge tone={step === 1 ? 'primary' : 'neutral'} dot>
              1 · Organization
            </Badge>
            <Badge tone={step === 2 ? 'primary' : 'neutral'} dot>
              2 · Workspace
            </Badge>
          </Stack>
        </div>
        {children}
      </Stack>
    </div>
  );
}
