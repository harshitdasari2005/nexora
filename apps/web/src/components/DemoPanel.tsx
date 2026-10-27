/**
 * @nexora/app-web — Demo Persona Switcher (top-bar menu).
 *
 * Rendered ONLY when the backend reports demo mode. Switching a persona
 * starts another REAL session for a seeded demo user (`POST /api/demo/login`
 * with a persona key from the server's fixed list) and reloads `/api/me`;
 * nothing about the current role is decided here. Reset asks the backend to
 * restore the deterministic demo organization (the browser names no target).
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, elevation, Spinner, typography } from '@nexora/design-system';

import { useDemo } from '../demo/demo-state.js';
import { demoHomePath, type DemoPersona } from '../lib/demo.js';
import { NavIcon } from './NavIcon.js';

/** Props of {@link DemoPanel}. */
export interface DemoPanelProps {
  /** Renders with the list already open (tests; the user opens it with a click). */
  defaultOpen?: boolean;
}

/** The demo office switcher (null outside demo mode). */
export function DemoPanel({ defaultOpen = false }: DemoPanelProps): JSX.Element | null {
  const demo = useDemo();
  const navigate = useNavigate();
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (demo.status !== 'enabled' || demo.config === null) return null;
  const { config, persona } = demo;

  const enter = async (key: DemoPersona['key']): Promise<void> => {
    setOpen(false);
    await demo.switchPersona(key);
    const target = config.personas.find((p) => p.key === key);
    if (target !== undefined) {
      navigate(demoHomePath(config.organizationId, target));
    }
  };

  const scope = `organizationId=${encodeURIComponent(config.organizationId)}${
    persona === null ? '' : `&workspaceId=${encodeURIComponent(persona.workspaceId)}`
  }`;

  return (
    <div ref={rootRef} data-testid="demo-panel" style={{ position: 'relative' }}>
      <button
        type="button"
        className="nexora-demo-trigger"
        aria-haspopup="menu"
        aria-label={
          persona === null ? 'Demo office' : `Demo office, signed in as ${persona.displayName}`
        }
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          height: 40,
          padding: '0 10px 0 5px',
          borderRadius: 999,
          border: '1px solid var(--nexora-borderStrong)',
          background: 'var(--nexora-surface)',
          color: 'var(--nexora-text)',
          cursor: 'pointer',
          maxWidth: 'min(260px, 46vw)',
        }}
      >
        {demo.busy ? (
          <span style={{ width: 28, display: 'inline-flex', justifyContent: 'center' }}>
            <Spinner size={14} />
          </span>
        ) : (
          <Avatar name={persona?.displayName ?? 'Demo'} size={28} />
        )}
        <span
          className="nexora-demo-trigger-text"
          style={{ minWidth: 0, textAlign: 'left', lineHeight: 1.15 }}
        >
          <span
            style={{
              display: 'block',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.semibold,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {persona === null ? 'Demo office' : persona.title}
          </span>
          <span
            style={{
              display: 'block',
              fontSize: typography.sizes.xs,
              color: 'var(--nexora-textMuted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {persona === null ? 'Pick who to sign in as' : `Signed in as ${persona.displayName}`}
          </span>
        </span>
        <NavIcon name="chevron-down" size={14} style={{ color: 'var(--nexora-textMuted)' }} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Demo office"
          className="nexora-demo-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 50,
            width: 'min(340px, calc(100vw - 24px))',
            maxHeight: 'min(560px, calc(100vh - 88px))',
            overflowY: 'auto',
            background: 'var(--nexora-shellCardElevated, var(--nexora-surface))',
            border: '1px solid var(--nexora-border)',
            borderRadius: 16,
            boxShadow: elevation.lg,
            padding: 8,
          }}
        >
          <div style={{ padding: '8px 10px 10px' }}>
            <div className="nexora-section-title">Demo office</div>
            <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              Sign in as anyone to see the work from their seat.
            </div>
          </div>
          {persona === null ? (
            <div
              role="status"
              style={{
                margin: '0 10px 8px',
                fontSize: typography.sizes.sm,
                color: 'var(--nexora-warning)',
              }}
            >
              Not signed in as a demo persona
            </div>
          ) : null}
          {config.personas.map((candidate) => {
            const active = persona?.key === candidate.key;
            return (
              <button
                key={candidate.key}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                disabled={demo.busy || active}
                className="nexora-demo-person"
                onClick={() => void enter(candidate.key)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  minHeight: 48,
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: 'none',
                  background: active ? 'var(--nexora-primarySoft)' : 'transparent',
                  color: 'var(--nexora-text)',
                  textAlign: 'left',
                  cursor: active ? 'default' : 'pointer',
                }}
              >
                <Avatar name={candidate.displayName} size={30} />
                <span style={{ minWidth: 0, flex: 1, lineHeight: 1.25 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: typography.sizes.base,
                      fontWeight: typography.weights.semibold,
                    }}
                  >
                    {candidate.title}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: typography.sizes.sm,
                      color: 'var(--nexora-textSecondary)',
                    }}
                  >
                    {candidate.displayName}
                  </span>
                </span>
                {active ? (
                  <NavIcon name="check" size={16} style={{ color: 'var(--nexora-primary)' }} />
                ) : null}
              </button>
            );
          })}
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginTop: 8,
              padding: '10px 10px 4px',
              borderTop: '1px solid var(--nexora-border)',
            }}
          >
            <button
              type="button"
              role="menuitem"
              className="nexora-btn nexora-btn-secondary nexora-demo-action"
              onClick={() => {
                setOpen(false);
                navigate(`/app/demo?${scope}`);
              }}
            >
              Guided demo
            </button>
            <button
              type="button"
              role="menuitem"
              className="nexora-btn nexora-btn-ghost nexora-demo-action"
              disabled={demo.busy || persona === null}
              onClick={() => {
                if (
                  window.confirm(
                    'Reset the demo organization to its seed? Demo history is cleared.',
                  )
                ) {
                  setOpen(false);
                  void demo.reset().then(() => navigate('/app/demo'));
                }
              }}
            >
              Reset demo
            </button>
          </div>
          {demo.error !== null ? (
            <div
              role="alert"
              style={{
                padding: '6px 10px',
                fontSize: typography.sizes.sm,
                color: 'var(--nexora-danger)',
              }}
            >
              {demo.error}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
