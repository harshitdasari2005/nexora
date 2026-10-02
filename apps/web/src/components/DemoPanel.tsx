/**
 * @nexora/app-web — Demo Persona Switcher (sidebar panel).
 *
 * Rendered ONLY when the backend reports demo mode. Switching a persona
 * starts another REAL session for a seeded demo user (`POST /api/demo/login`
 * with a persona key from the server's fixed list) and reloads `/api/me`;
 * nothing about the current role is decided here. Reset asks the backend to
 * restore the deterministic demo organization (the browser names no target).
 */

import { useNavigate } from 'react-router-dom';
import { Badge, Button, Spinner, Stack, typography } from '@nexora/design-system';

import { useDemo } from '../demo/demo-state.js';
import { demoHomePath, type DemoPersona } from '../lib/demo.js';

const SHORT: Record<DemoPersona['key'], string> = {
  ceo: 'CEO',
  cto: 'CTO',
  manager: 'Team Manager',
  dev_aarav: 'Developer · Aarav',
  dev_meghna: 'Developer · Meghna',
  hr: 'HR',
  cfo: 'CFO',
  controller: 'Controller',
};

/** The sidebar demo panel (null outside demo mode). */
export function DemoPanel(): JSX.Element | null {
  const demo = useDemo();
  const navigate = useNavigate();
  if (demo.status !== 'enabled' || demo.config === null) return null;
  const { config, persona } = demo;

  const enter = async (key: DemoPersona['key']): Promise<void> => {
    await demo.switchPersona(key);
    const target = config.personas.find((p) => p.key === key);
    if (target !== undefined) {
      navigate(demoHomePath(config.organizationId, target));
    }
  };

  return (
    <Stack gap={2} data-testid="demo-panel">
      <Stack direction="row" gap={2} align="center" justify="space-between">
        <span
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.semibold,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--nexora-textMuted)',
          }}
        >
          Demo personas
        </span>
        {demo.busy ? <Spinner size={14} /> : null}
      </Stack>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {config.personas.map((candidate) => {
          const active = persona?.key === candidate.key;
          return (
            <button
              key={candidate.key}
              type="button"
              disabled={demo.busy || active}
              onClick={() => void enter(candidate.key)}
              title={`${candidate.displayName} — ${candidate.title}`}
              aria-pressed={active}
              style={{
                border: `1px solid ${active ? 'var(--nexora-primary)' : 'var(--nexora-border)'}`,
                background: active ? 'var(--nexora-primarySoft)' : 'transparent',
                color: active ? 'var(--nexora-text)' : 'var(--nexora-textSecondary)',
                borderRadius: 999,
                padding: '3px 10px',
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.medium,
                cursor: active ? 'default' : 'pointer',
              }}
            >
              {SHORT[candidate.key]}
            </button>
          );
        })}
      </div>
      {persona === null ? (
        <Badge tone="warning">Not signed in as a demo persona</Badge>
      ) : (
        <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          Signed in as {persona.displayName}
        </div>
      )}
      <Stack direction="row" gap={2}>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            navigate(
              `/app/demo?organizationId=${encodeURIComponent(config.organizationId)}${
                persona === null ? '' : `&workspaceId=${encodeURIComponent(persona.workspaceId)}`
              }`,
            )
          }
        >
          Guided demo
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={demo.busy || persona === null}
          onClick={() => {
            if (
              window.confirm('Reset the demo organization to its seed? Demo history is cleared.')
            ) {
              void demo.reset().then(() => navigate('/app/demo'));
            }
          }}
        >
          Reset
        </Button>
      </Stack>
      {demo.error !== null ? (
        <div role="alert" style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
          {demo.error}
        </div>
      ) : null}
    </Stack>
  );
}
