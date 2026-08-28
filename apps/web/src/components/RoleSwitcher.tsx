/**
 * @nexora/app-web — RoleSwitcher (S27 Phase 6; S33 domain-grouped premium
 * pass; S35 curated to six business personas).
 *
 * The role/context switcher: lets the user change their business lens
 * (organization + workspace, which resolves to a business role) WITHOUT
 * logging out. Reads `/api/role-context` — the current resolved role plus
 * every OTHER (organization, workspace) the caller is a genuine member of,
 * each already resolved through the SAME trusted membership seam the
 * Command Center and AI Runtime use. This component never invents a role
 * and never sends one: selecting an option only updates the trusted scope
 * query params (`organizationId` / `workspaceId`), which every page already
 * re-validates against the caller's real membership server-side.
 *
 * S35: the backend catalog has 20 granular roles across 11 domains — right
 * for RBAC, overwhelming as a first-time switcher. This component now shows
 * only the caller's real memberships that map to one of the six curated
 * user-facing personas (`../lib/rolePersonas.js`) — CEO, CFO, Operations
 * Manager, CTO / Developer, HR, Legal — never more than six rows, never a
 * persona the caller has no genuine membership for. A caller whose ONLY
 * memberships fall outside the six (e.g. only a Sales or Product workspace)
 * still sees those real options, grouped by domain exactly as before, so no
 * access is ever hidden — only the common case is simplified.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, elevation, Spinner, Stack, typography } from '@nexora/design-system';

import { api } from '../lib/api.js';
import {
  buildPersonaOptions,
  resolvePersonaForRole,
  type PersonaOption,
} from '../lib/rolePersonas.js';
import { themeForRole } from '../lib/roleThemes.js';
import type { RoleContextOption, RoleContextResponse } from '../lib/types.js';

/** Props of {@link RoleSwitcher}. */
export interface RoleSwitcherProps {
  /** The current organization id (trusted scope). */
  organizationId?: string;
  /** The current workspace id (trusted scope). */
  workspaceId?: string;
  /** Fallback organization name while the role context is loading. */
  organizationName: string;
  /** Fallback workspace name while the role context is loading. */
  workspaceName: string;
}

/** Groups options by business DOMAIN, preserving first-seen order. */
function groupByDomain(
  options: readonly RoleContextOption[],
): readonly { domainId: string; domainName: string; options: RoleContextOption[] }[] {
  const groups: { domainId: string; domainName: string; options: RoleContextOption[] }[] = [];
  for (const option of options) {
    let group = groups.find((g) => g.domainId === option.domainId);
    if (group === undefined) {
      group = { domainId: option.domainId, domainName: option.domainName, options: [] };
      groups.push(group);
    }
    group.options.push(option);
  }
  return groups;
}

/** The sidebar workspace-context card, now a domain-grouped role/context switcher. */
export function RoleSwitcher({
  organizationId,
  workspaceId,
  organizationName,
  workspaceName,
}: RoleSwitcherProps): JSX.Element {
  const [, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<RoleContextResponse | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (organizationId !== undefined) params.set('organizationId', organizationId);
      if (workspaceId !== undefined) params.set('workspaceId', workspaceId);
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      const result = await api<RoleContextResponse>(`/role-context${suffix}`);
      setContext(result);
    } catch {
      // The switcher degrades to a static label — every other surface still
      // resolves the role server-side; this is presentation only.
      setContext(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (panelRef.current !== null && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const current = context?.current ?? null;
  const currentTheme = themeForRole(current?.roleId);
  const currentPersona = resolvePersonaForRole(current?.roleId);
  const canSwitch = (context?.options.length ?? 0) > 1;

  function selectOption(option: RoleContextOption): void {
    setOpen(false);
    setSearchParams(
      { organizationId: option.organizationId, workspaceId: option.workspaceId },
      { replace: false },
    );
  }

  const personaOptions = context === null ? [] : buildPersonaOptions(context.options);
  // Falls back to the full domain-grouped list only when NONE of the
  // caller's real memberships map to one of the six curated personas —
  // never hides genuine access, only simplifies the common case.
  const groups =
    personaOptions.length > 0 || context === null ? [] : groupByDomain(context.options);

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => canSwitch && setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          border: 'none',
          cursor: canSwitch ? 'pointer' : 'default',
          background: 'transparent',
          padding: 0,
        }}
      >
        <Stack direction="row" gap={2} align="center" justify="space-between">
          <Stack direction="row" gap={2} align="center" style={{ minWidth: 0, flex: 1 }}>
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: currentTheme.accent,
                flexShrink: 0,
              }}
            />
            <Stack gap={0.5} style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: typography.sizes.xs,
                  color: 'var(--nexora-textMuted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {current?.organizationName ?? organizationName}
              </div>
              <div
                style={{
                  fontWeight: typography.weights.semibold,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {current?.workspaceName ?? workspaceName}
              </div>
              {loading ? (
                <Spinner size={12} />
              ) : current !== undefined && current !== null ? (
                <Badge dotColor={currentTheme.accent} dot style={{ color: currentTheme.accent }}>
                  {currentPersona !== undefined
                    ? `${currentPersona.displayRole} · ${currentPersona.focusLabel}`
                    : `${current.domainName} · ${current.roleName}`}
                </Badge>
              ) : null}
            </Stack>
          </Stack>
          {canSwitch ? (
            <span aria-hidden style={{ color: 'var(--nexora-textMuted)', fontSize: 11 }}>
              ⇅
            </span>
          ) : null}
        </Stack>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Switch business role"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 8,
            width: 300,
            maxHeight: '60vh',
            overflowY: 'auto',
            background: 'var(--nexora-shellCardElevated, var(--nexora-surface))',
            border: '1px solid var(--nexora-border)',
            borderRadius: 14,
            boxShadow: elevation.lg,
            zIndex: 50,
          }}
        >
          <div
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--nexora-border)',
              fontSize: typography.sizes.xs,
              color: 'var(--nexora-textMuted)',
              fontWeight: typography.weights.medium,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Switch business lens
          </div>
          {personaOptions.length > 0
            ? personaOptions.map(({ persona, option }) => (
                <PersonaOptionRow
                  key={persona.id}
                  persona={persona}
                  option={option}
                  isCurrent={option.workspaceId === current?.workspaceId}
                  onSelect={() => selectOption(option)}
                />
              ))
            : groups.map((group) => (
                <div key={group.domainId}>
                  <div
                    style={{
                      padding: '10px 14px 4px',
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.semibold,
                      color: 'var(--nexora-textMuted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {group.domainName}
                  </div>
                  {group.options.map((option) => {
                    const isCurrent = option.workspaceId === current?.workspaceId;
                    const optionTheme = themeForRole(option.roleId);
                    return (
                      <button
                        key={option.workspaceId}
                        type="button"
                        role="option"
                        aria-selected={isCurrent}
                        onClick={() => selectOption(option)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 14px',
                          border: 'none',
                          background: isCurrent ? optionTheme.accentSoft : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <Stack direction="row" gap={2} align="center">
                          <span
                            aria-hidden
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              background: optionTheme.accent,
                              flexShrink: 0,
                            }}
                          />
                          <Stack gap={0.5} style={{ minWidth: 0, flex: 1 }}>
                            <Stack direction="row" gap={2} align="center">
                              <span
                                style={{
                                  fontSize: typography.sizes.sm,
                                  fontWeight: isCurrent
                                    ? typography.weights.semibold
                                    : typography.weights.medium,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {option.workspaceName}
                              </span>
                              {isCurrent ? (
                                <span
                                  aria-hidden
                                  style={{ marginLeft: 'auto', color: optionTheme.accent }}
                                >
                                  ✓
                                </span>
                              ) : null}
                            </Stack>
                            <span
                              style={{
                                fontSize: typography.sizes.xs,
                                color: 'var(--nexora-textSecondary)',
                              }}
                            >
                              {option.roleName} · {optionTheme.identity}
                            </span>
                          </Stack>
                        </Stack>
                      </button>
                    );
                  })}
                </div>
              ))}
        </div>
      ) : null}
    </div>
  );
}

/** One curated persona row in the switcher dropdown (S35). */
function PersonaOptionRow({
  persona,
  option,
  isCurrent,
  onSelect,
}: {
  persona: PersonaOption['persona'];
  option: RoleContextOption;
  isCurrent: boolean;
  onSelect: () => void;
}): JSX.Element {
  const optionTheme = themeForRole(option.roleId);
  return (
    <button
      type="button"
      role="option"
      aria-selected={isCurrent}
      onClick={onSelect}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '10px 14px',
        border: 'none',
        background: isCurrent ? optionTheme.accentSoft : 'transparent',
        cursor: 'pointer',
      }}
    >
      <Stack direction="row" gap={2} align="center">
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: optionTheme.accent,
            flexShrink: 0,
          }}
        />
        <Stack gap={0.5} style={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" gap={2} align="center">
            <span
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: isCurrent ? typography.weights.semibold : typography.weights.medium,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {persona.displayRole}
            </span>
            {isCurrent ? (
              <span aria-hidden style={{ marginLeft: 'auto', color: optionTheme.accent }}>
                ✓
              </span>
            ) : null}
          </Stack>
          <span
            style={{
              fontSize: typography.sizes.xs,
              color: 'var(--nexora-textSecondary)',
            }}
          >
            {persona.focusLabel}
          </span>
        </Stack>
      </Stack>
    </button>
  );
}
