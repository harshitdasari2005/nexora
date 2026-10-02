/**
 * The first screen after signing in without an organization: create your own
 * organization, or go to the demo — the demo is offered only when the backend
 * reports demo mode.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { WelcomeChoice } from '../src/pages/Dashboard.js';

const render = (demoAvailable: boolean): string =>
  renderToString(
    <MemoryRouter>
      <WelcomeChoice demoAvailable={demoAvailable} />
    </MemoryRouter>,
  ).replace(/<!-- -->/g, '');

describe('WelcomeChoice', () => {
  it('offers both paths when demo mode is on', () => {
    const html = render(true);
    expect(html).toContain('How would you like to start?');
    expect(html).toContain('Create your organization');
    expect(html).toContain('href="/onboarding/organization"');
    expect(html).toContain('Go to the demo');
    expect(html).toContain('href="/demo"');
  });

  it('offers only organization creation when demo mode is off — no dead demo link', () => {
    const html = render(false);
    expect(html).toContain('href="/onboarding/organization"');
    expect(html).not.toContain('Go to the demo');
    expect(html).not.toContain('href="/demo"');
  });
});
