/**
 * Server-render tests for the AI approval card (first AI write UX): the card
 * shows the consequential action, the user-controlled name, the requesting
 * context, and the risk, with Approve/Reject actions — and never exposes
 * internal security identifiers. Follows the existing SSR smoke-test
 * convention (no DOM or network required).
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { ApprovalCard, humanizeAction, type AiPanelProps } from '../src/components/AiPanel.js';
import type { ChatApproval } from '../src/lib/chat.js';

const pendingApproval: ChatApproval = {
  id: 'apr_1',
  stepId: 'step_1',
  capabilityId: 'workspaces.create_workspace',
  toolId: 'workspaces.create_workspace',
  status: 'pending',
  sideEffectClass: 'consequential',
  input: { name: 'Engineering' },
};

describe('humanizeAction', () => {
  it('turns a tool id into a readable action', () => {
    expect(humanizeAction('workspaces.create_workspace')).toBe('Create Workspace');
    expect(humanizeAction('workspaces.list_workspaces')).toBe('List Workspaces');
    expect(humanizeAction('projects.close_sprint')).toBe('Close Sprint');
  });

  it('handles ids without a domain prefix', () => {
    expect(humanizeAction('create_workspace')).toBe('Create Workspace');
  });
});

describe('ApprovalCard', () => {
  it('renders the action, name, context, and risk', () => {
    const html = renderToString(
      <ApprovalCard
        approval={pendingApproval}
        organizationName="Acme Inc."
        userDisplayName="Alex Morgan"
        deciding={false}
        onApprove={() => undefined}
        onReject={() => undefined}
      />,
    );
    expect(html).toContain('Approval required');
    expect(html).toContain('Create Workspace');
    expect(html).toContain('Engineering');
    expect(html).toContain('Acme Inc.');
    expect(html).toContain('Alex Morgan');
    // Consequential class → persistent state change risk.
    expect(html).toContain('Persistent state change');
  });

  it('renders Approve and Reject actions', () => {
    const html = renderToString(
      <ApprovalCard
        approval={pendingApproval}
        deciding={false}
        onApprove={() => undefined}
        onReject={() => undefined}
      />,
    );
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
  });

  it('never exposes internal approval ids in the rendered card', () => {
    const html = renderToString(
      <ApprovalCard
        approval={pendingApproval}
        deciding={false}
        onApprove={() => undefined}
        onReject={() => undefined}
      />,
    );
    expect(html).not.toContain('apr_1');
    expect(html).not.toContain('step_1');
  });

  it('disables the actions while a decision is in flight', () => {
    const html = renderToString(
      <ApprovalCard
        approval={pendingApproval}
        deciding
        onApprove={() => undefined}
        onReject={() => undefined}
      />,
    );
    expect(html).toContain('disabled');
    expect(html).toContain('Submitting…');
  });

  it('shows a generic risk label for state-change class', () => {
    const html = renderToString(
      <ApprovalCard
        approval={{ ...pendingApproval, sideEffectClass: 'state_change' }}
        deciding={false}
        onApprove={() => undefined}
        onReject={() => undefined}
      />,
    );
    expect(html).toContain('State change');
    expect(html).not.toContain('Persistent state change');
  });
});

describe('AiPanel props (approval card context)', () => {
  it('accepts the organization and user display name props', () => {
    const props: AiPanelProps = {
      workspaceId: 'wsp_1',
      organizationName: 'Acme Inc.',
      userDisplayName: 'Alex Morgan',
    };
    expect(props.organizationName).toBe('Acme Inc.');
    expect(props.userDisplayName).toBe('Alex Morgan');
  });
});
