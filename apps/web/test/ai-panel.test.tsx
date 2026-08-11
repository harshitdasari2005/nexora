/**
 * Server-render smoke tests for the AI panel (matches the existing SSR
 * smoke-test convention — no DOM or network required).
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { AiPanel } from '../src/components/AiPanel.js';

describe('AiPanel', () => {
  it('renders the empty conversation state', () => {
    const html = renderToString(<AiPanel workspaceId="wsp_1" />);
    expect(html).toContain('Nexora AI');
    expect(html).toContain('Ask Nexora anything');
    expect(html).toContain('What workspaces do I have?');
    expect(html).toContain('Message the AI');
  });

  it('renders seeded conversation messages', () => {
    const html = renderToString(
      <AiPanel
        workspaceId="wsp_1"
        initialMessages={[
          { id: 'm1', role: 'user', content: 'What workspaces do I have?' },
          { id: 'm2', role: 'assistant', content: 'You have 1 workspace: Engineering.' },
        ]}
      />,
    );
    expect(html).toContain('What workspaces do I have?');
    expect(html).toContain('You have 1 workspace: Engineering.');
  });

  it('does not show the empty state when messages exist', () => {
    const html = renderToString(
      <AiPanel initialMessages={[{ id: 'm1', role: 'user', content: 'Hi' }]} />,
    );
    // The empty state copy is unique to the empty conversation view.
    expect(html).not.toContain('plans, discovers your tools');
    expect(html).toContain('Hi');
  });
});
