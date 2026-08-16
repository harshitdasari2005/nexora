/**
 * S26 Phase 8 — Agent page smoke tests (server render, no DOM or network
 * required). ONE generic page renders every role's agent: the server
 * resolves the caller's effective domain/role/agent/capabilities from
 * trusted membership and returns the definition + governed proposals +
 * recent runs; this page only renders and lets the user execute through the
 * existing governed path. Loading, empty, success, proposal, and journal
 * states are covered; the error state renders through the shared ErrorState
 * component (same convention as the other application views).
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { AgentView } from '../src/pages/Agent.js';
import type { BusinessAgentDto } from '../src/lib/types.js';

function agent(overrides: Partial<BusinessAgentDto> = {}): BusinessAgentDto {
  return {
    id: 'executive',
    name: 'Executive Agent',
    domainId: 'executive',
    domainName: 'Executive',
    roleId: 'executive.ceo',
    roleName: 'CEO',
    description: 'Organization-level oversight.',
    autonomyLevel: 'governed_execution',
    goals: [
      {
        id: 'executive.attention',
        name: 'Identify what needs attention',
        description: 'Surfaces the attention items from real persisted signals.',
        capabilityIds: ['notifications.what_needs_attention'],
      },
    ],
    policies: [
      {
        id: 'writes.require_approval',
        statement: 'Every write action executes only through the existing approval engine.',
      },
    ],
    capabilities: [{ id: 'projects.find_project', name: 'projects.find_project' }],
    proposals: [
      {
        id: 'propose_review_attention',
        action: 'Review what needs attention',
        reason: '1 unread notification requires your attention.',
        affectedEntity: { type: 'notification', id: 'inbox', title: 'Notification inbox' },
        targetSystem: 'nexora',
        requiredCapability: 'notifications.what_needs_attention',
        requiresApproval: false,
        expectedResult: 'A prioritized list of the real notifications that need your attention.',
        goalId: 'executive.attention',
      },
    ],
    recentRuns: [
      {
        id: 'agx_1',
        agentId: 'executive',
        roleId: 'executive.ceo',
        domainId: 'executive',
        tenantId: 'org_1',
        userId: 'usr_1',
        proposalId: 'propose_review_attention',
        proposalAction: 'Review what needs attention',
        status: 'completed',
        runId: 'run_1',
        createdAt: '2026-08-15T08:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function renderView(initialAgent: BusinessAgentDto | null | undefined): string {
  return renderToString(
    <MemoryRouter>
      <AgentView
        organizationId="org_1"
        workspaceId="wsp_1"
        organizationName="Acme Inc."
        userDisplayName="Alex Morgan"
        initialAgent={initialAgent}
      />
    </MemoryRouter>,
  );
}

describe('AgentView (S26 Phase 8)', () => {
  it('renders the loading state while resolving the agent', () => {
    // No initialAgent → the view mounts in the loading state (no fetch in
    // server render, matching the other application views).
    const html = renderView(undefined);
    expect(html).toContain('Resolving your agent');
  });

  it('renders the agent identity through the generic page', () => {
    const html = renderView(agent());
    expect(html).toContain('Agent');
    expect(html).toContain('Executive Agent');
    expect(html).toContain('Executive');
    expect(html).toContain('CEO');
    expect(html).toContain('Governed execution');
    // Goals, policies, and capabilities render from the definition.
    expect(html).toContain('Identify what needs attention');
    expect(html).toContain('Operating policies');
    expect(html).toContain(
      'Every write action executes only through the existing approval engine.',
    );
  });

  it('renders governed proposals grounded in real data', () => {
    const html = renderView(agent());
    expect(html).toContain('Suggested actions');
    expect(html).toContain('Review what needs attention');
    expect(html).toContain('1 unread notification requires your attention.');
    expect(html).toContain('Read only');
  });

  it('renders the recent-runs journal (S26 measurements)', () => {
    const html = renderView(agent());
    expect(html).toContain('Recent runs');
    expect(html).toContain('Review what needs attention');
    expect(html).toContain('completed');
  });

  it('renders the free-form ask-your-agent composer', () => {
    const html = renderView(agent());
    expect(html).toContain('Ask your agent');
    expect(html).toContain('What needs my attention?');
  });

  it('renders honest empty states when there is nothing to propose or run', () => {
    const empty = agent({ proposals: [], recentRuns: [] });
    const html = renderView(empty);
    expect(html).toContain('Nothing to propose');
    expect(html).toContain('No runs yet');
  });

  it('renders the empty state when no agent is configured for the role', () => {
    const html = renderView(null);
    expect(html).toContain('No agent for your role');
  });

  it('does not render role-specific page structure (one generic page)', () => {
    const html = renderView(agent());
    expect(html).not.toContain('ExecutivePage');
    expect(html).not.toContain('ManagerPage');
    expect(html).not.toContain('DeveloperPage');
  });
});
