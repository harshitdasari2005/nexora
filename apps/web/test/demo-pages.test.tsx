/**
 * Server-render smoke tests for the demo surfaces (same convention as the
 * other `*-page.test.tsx` files): the demo panel and Start Demo page render
 * nothing misleading outside demo mode, the Start page lists the server's
 * personas in demo mode, and the Projects team panel is a real request.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { DemoPanel } from '../src/components/DemoPanel.js';
import { DemoContext, type DemoState } from '../src/demo/demo-state.js';
import { DemoStart } from '../src/pages/DemoStart.js';
import { ProjectRow, ProjectTeam } from '../src/pages/Projects.js';
import { StatusBadge } from '../src/pages/GuidedDemo.js';
import { demoHomePath, type DemoConfig } from '../src/lib/demo.js';
import { isStoryPersona } from '../src/demo/journey.js';

const CONFIG: DemoConfig = {
  enabled: true,
  seeded: true,
  organizationId: 'org_demo',
  personas: [
    {
      key: 'ceo',
      displayName: 'Anika Rao',
      title: 'Chief Executive Officer',
      responsibility: 'Requests the hire.',
      workspaceId: 'wsp_eng',
    },
    {
      key: 'manager',
      displayName: 'Rohan Mehta',
      title: 'Team Manager',
      responsibility: 'Approves the hire.',
      workspaceId: 'wsp_eng',
    },
    {
      key: 'controller',
      displayName: 'Divya Nair',
      title: 'Finance Controller',
      responsibility: 'Submits an expense.',
      workspaceId: 'wsp_fin',
    },
    {
      key: 'cfo',
      displayName: 'Karan Malhotra',
      title: 'Chief Financial Officer',
      responsibility: 'Approves the expense.',
      workspaceId: 'wsp_fin',
    },
  ],
  story: {
    hireRequest: 'Hire Sarah Thomas and assign her to the Mobile Banking Platform project.',
    projectName: 'Mobile Banking Platform',
    budgetName: 'Mobile Banking Delivery Budget',
    expense: {
      description: 'Mobile device test lab licences',
      amountMinorUnits: 4_500_000,
      currency: 'INR',
    },
  },
};

function state(overrides: Partial<DemoState>): DemoState {
  return {
    status: 'enabled',
    config: CONFIG,
    persona: null,
    busy: false,
    error: null,
    switchPersona: async () => undefined,
    reset: async () => undefined,
    ...overrides,
  };
}

function render(node: JSX.Element, demo: DemoState): string {
  return renderToString(
    <MemoryRouter>
      <DemoContext.Provider value={demo}>{node}</DemoContext.Provider>
    </MemoryRouter>,
  ).replace(/<!-- -->/g, '');
}

describe('DemoPanel', () => {
  it('renders nothing when demo mode is disabled', () => {
    expect(render(<DemoPanel />, state({ status: 'disabled', config: null }))).toBe('');
  });

  it('lists the server personas, marks the current one, and never shows emails or user ids', () => {
    const html = render(<DemoPanel />, state({ persona: CONFIG.personas[1] ?? null }));
    expect(html).toContain('Demo personas');
    for (const label of ['CEO', 'Team Manager', 'Controller', 'CFO']) expect(html).toContain(label);
    expect(html).toContain('Signed in as Rohan Mehta');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toMatch(/usr_|@/);
  });

  it('warns when the session is not a demo persona', () => {
    expect(render(<DemoPanel />, state({}))).toContain('Not signed in as a demo persona');
  });
});

describe('DemoStart', () => {
  it('explains how to enable demo mode when it is off, and offers normal sign-in', () => {
    const html = render(<DemoStart />, state({ status: 'disabled', config: null }));
    expect(html).toContain('Demo mode is not enabled');
    expect(html).toContain('NEXORA_DEMO_MODE=true');
    expect(html).toContain('href="/api/auth/login"');
  });

  it('offers every persona and recommends the CEO in demo mode', () => {
    const html = render(<DemoStart />, state({}));
    expect(html).toContain('Start as the CEO');
    expect(html).toContain('Enter as Team Manager');
    expect(html).toContain('Enter as Finance Controller');
    expect(html).toContain('Enter as Chief Financial Officer');
    expect(html).toContain('real seeded account with a real session');
  });

  it('flags an unseeded demo organization instead of pretending', () => {
    const html = render(<DemoStart />, state({ config: { ...CONFIG, seeded: false } }));
    expect(html).toContain('not seeded yet');
  });
});

describe('Guided demo status badge', () => {
  it('names the four honest states', () => {
    const labels = (['pending', 'active', 'done', 'failed'] as const).map((status) =>
      renderToString(<StatusBadge status={status} />),
    );
    expect(labels[0]).toContain('Pending');
    expect(labels[1]).toContain('In progress');
    expect(labels[2]).toContain('Done');
    expect(labels[3]).toContain('Did not complete');
  });
});

describe('Projects team panel', () => {
  const project = {
    id: 'prj_1',
    organizationId: 'org_1',
    name: 'Mobile Banking Platform',
    status: 'active',
    createdAt: '2026-08-08T00:00:00.000Z',
  };

  it('offers a Team toggle only when the row is scoped to an organization', () => {
    const scoped = renderToString(<ProjectRow project={project} organizationId="org_1" />);
    expect(scoped).toContain('>Team<');
    const unscoped = renderToString(<ProjectRow project={project} />);
    expect(unscoped).not.toContain('>Team<');
  });

  it('starts in a loading state (membership is fetched, never assumed)', () => {
    const html = renderToString(<ProjectTeam projectId="prj_1" organizationId="org_1" />);
    expect(html).not.toContain('assigned to this project');
    expect(html).not.toContain('Sarah Thomas');
  });
});

describe('the whole office can sign in', () => {
  const OFFICE: DemoConfig = {
    ...CONFIG,
    personas: [
      ...CONFIG.personas,
      {
        key: 'cto',
        displayName: 'Vikram Shah',
        title: 'Chief Technology Officer',
        responsibility: 'Leads technology.',
        workspaceId: 'wsp_tech',
      },
      {
        key: 'hr',
        displayName: 'Priya Menon',
        title: 'HR Manager',
        responsibility: 'Owns people operations.',
        workspaceId: 'wsp_hr',
      },
      {
        key: 'dev_aarav',
        displayName: 'Aarav Kulkarni',
        title: 'Software Developer',
        responsibility: 'IT team member.',
        workspaceId: 'wsp_eng',
      },
      {
        key: 'dev_meghna',
        displayName: 'Meghna Iyer',
        title: 'Software Developer',
        responsibility: 'IT team member.',
        workspaceId: 'wsp_eng',
      },
    ],
  };

  it('the Start page offers every person, in office order', () => {
    const html = render(<DemoStart />, state({ config: OFFICE }));
    const names = [
      'Anika Rao',
      'Vikram Shah',
      'Rohan Mehta',
      'Aarav Kulkarni',
      'Meghna Iyer',
      'Priya Menon',
      'Karan Malhotra',
      'Divya Nair',
    ];
    const positions = names.map((name) => html.indexOf(name));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain('Enter as Chief Technology Officer');
    expect(html).toContain('Enter as HR Manager');
  });

  it('the sidebar switcher lists every person', () => {
    const html = render(<DemoPanel />, state({ config: OFFICE }));
    for (const label of ['CEO', 'CTO', 'Team Manager', 'Developer · Aarav', 'HR', 'CFO']) {
      expect(html).toContain(label);
    }
  });

  it('story people land in the guided story; everyone else lands in their own workspace', () => {
    const find = (key: string) => OFFICE.personas.find((persona) => persona.key === key)!;
    expect(demoHomePath('org_demo', find('ceo'))).toBe(
      '/app/demo?organizationId=org_demo&workspaceId=wsp_eng',
    );
    expect(demoHomePath('org_demo', find('hr'))).toBe(
      '/app?organizationId=org_demo&workspaceId=wsp_hr',
    );
    expect(demoHomePath('org_demo', find('cto'))).toBe(
      '/app?organizationId=org_demo&workspaceId=wsp_tech',
    );
    expect(isStoryPersona('dev_aarav')).toBe(false);
    expect(isStoryPersona('manager')).toBe(true);
  });
});
