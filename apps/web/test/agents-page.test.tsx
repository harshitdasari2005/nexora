/**
 * Agents page smoke tests (server render, no DOM or network): list with
 * status badges, delegation table incl. the derived `expired` status, the
 * approvals notice, and state-dependent disabled actions.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { AgentsView } from '../src/pages/Agents.js';
import { AgentView } from '../src/pages/Agent.js';
import type { AgentAuthorityDto, AgentDelegationDto, AgentIdentityDto } from '../src/lib/agents.js';

function identity(overrides: Partial<AgentIdentityDto> = {}): AgentIdentityDto {
  return {
    id: 'agt_1',
    organizationId: 'org_1',
    workspaceId: 'wsp_1',
    definitionId: 'finance',
    name: 'Finance Helper',
    description: '',
    status: 'active',
    ownerUserId: 'usr_1',
    createdBy: 'usr_1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function delegation(overrides: Partial<AgentDelegationDto> = {}): AgentDelegationDto {
  return {
    id: 'dlg_1',
    agentId: 'agt_1',
    grantedByUserId: 'usr_1',
    capabilityId: 'projects.assign_employee',
    status: 'active',
    effectiveStatus: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function authority(agent: AgentIdentityDto, delegations: AgentDelegationDto[]): AgentAuthorityDto {
  return {
    agent,
    delegations,
    effectiveCapabilityIds: ['projects.assign_employee'],
    definitionCapabilityIds: ['projects.assign_employee', 'finance.read_budget'],
  };
}

function render(agents: AgentIdentityDto[], selected?: AgentAuthorityDto): string {
  return renderToString(
    <MemoryRouter>
      <AgentsView
        organizationId="org_1"
        workspaceId="wsp_1"
        workspaceName="Ops"
        initialAgents={agents}
        {...(selected === undefined
          ? {}
          : { initialSelectedId: selected.agent.id, initialAuthority: selected })}
      />
    </MemoryRouter>,
  );
}

/** Whether the FIRST button whose text is exactly `label` is rendered disabled. */
function disabled(html: string, label: string): boolean {
  for (const match of html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)) {
    if (match[2] === label) return /\sdisabled=""/.test(match[1] ?? '');
  }
  throw new Error(`button "${label}" not found`);
}

describe('AgentsView', () => {
  it('lists agents with status badges and the approvals notice', () => {
    const html = render([
      identity(),
      identity({ id: 'agt_2', name: 'Paused', status: 'suspended' }),
      identity({ id: 'agt_3', name: 'Gone', status: 'revoked' }),
    ]);
    expect(html).toContain('Finance Helper');
    expect(html).toContain('ACTIVE');
    expect(html).toContain('SUSPENDED');
    expect(html).toContain('REVOKED');
    expect(html).toContain('never bypasses approvals');
  });

  it('shows an empty state without agents', () => {
    expect(render([])).toContain('No agents yet');
  });

  it('renders delegations with the derived expired status and revoke info', () => {
    const agent = identity();
    const html = render(
      [agent],
      authority(agent, [
        delegation({
          id: 'dlg_e',
          effectiveStatus: 'expired',
          expiresAt: '2026-01-01T00:00:00.000Z',
          resourceScope: { kind: 'project', id: 'prj_9' },
        }),
        delegation({
          id: 'dlg_r',
          status: 'revoked',
          effectiveStatus: 'revoked',
          revokedAt: '2026-08-02T00:00:00.000Z',
          revokedBy: 'usr_2',
          revokeReason: 'no longer needed',
        }),
      ]),
    );
    expect(html).toContain('expired');
    expect(html).toContain('project: prj_9');
    expect(html).toContain('by usr_2');
    expect(html).toContain('no longer needed');
    expect(html).toContain('Effective capabilities');
    expect(html).toContain('finance.read_budget'); // capability picker from definition ceiling
    // expired / revoked delegations cannot be revoked again
    expect(
      html.match(
        /aria-label="Revoke delegation [^"]*"[^>]*disabled|disabled=""[^>]*aria-label="Revoke delegation/g,
      ),
    ).toHaveLength(2);
  });

  it('enables actions for an active agent and requires confirm to revoke', () => {
    const agent = identity();
    const html = render([agent], authority(agent, [delegation()]));
    expect(disabled(html, 'Suspend')).toBe(false);
    expect(disabled(html, 'Reactivate')).toBe(true);
    expect(disabled(html, 'Revoke')).toBe(false);
    expect(disabled(html, 'Grant delegation')).toBe(false);
    expect(html).not.toContain('Confirm revoke');
  });

  it('disables reactivate/grant appropriately for suspended and everything for revoked', () => {
    const suspended = identity({ status: 'suspended' });
    let html = render([suspended], authority(suspended, []));
    expect(disabled(html, 'Suspend')).toBe(true);
    expect(disabled(html, 'Reactivate')).toBe(false);
    expect(disabled(html, 'Grant delegation')).toBe(true);

    const revoked = identity({ status: 'revoked' });
    html = render([revoked], authority(revoked, [delegation()]));
    expect(disabled(html, 'Suspend')).toBe(true);
    expect(disabled(html, 'Reactivate')).toBe(true);
    expect(disabled(html, 'Revoke')).toBe(true);
    expect(disabled(html, 'Grant delegation')).toBe(true);
    expect(html).toContain('only be granted to an active agent');
  });
});

describe('AgentView run-as (agentId)', () => {
  const props = {
    organizationId: 'org_1',
    workspaceId: 'wsp_1',
    organizationName: 'Acme',
    userDisplayName: 'Alex',
  };
  const businessAgent = {
    id: 'finance',
    name: 'Finance Agent',
    domainId: 'finance',
    domainName: 'Finance',
    roleId: 'r',
    roleName: 'R',
    description: 'd',
    autonomyLevel: 'governed_execution',
    goals: [],
    policies: [],
    capabilities: [],
    proposals: [],
    recentRuns: [],
    problems: [],
  } as never;

  it('shows an empty state linking to the Agents page when no agent is active', () => {
    const html = renderToString(
      <MemoryRouter>
        <AgentView
          {...props}
          initialAgent={businessAgent}
          initialAgents={[identity({ status: 'suspended' })]}
        />
      </MemoryRouter>,
    );
    expect(html).toContain('No active agent to run as');
    expect(html).toContain('/app/agents?');
    expect(html).not.toContain('Run as agent');
  });

  it('offers the active agents to run as', () => {
    const html = renderToString(
      <MemoryRouter>
        <AgentView {...props} initialAgent={businessAgent} initialAgents={[identity()]} />
      </MemoryRouter>,
    );
    expect(html).toContain('Run as agent');
    expect(html).toContain('Finance Helper');
  });
});
