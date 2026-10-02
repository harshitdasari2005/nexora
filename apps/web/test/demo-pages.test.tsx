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
import { GuidedDemoView, storyStatusLabel } from '../src/pages/GuidedDemo.js';
import { StoryBarView } from '../src/components/StoryBar.js';
import {
  demoHomePath,
  type DemoConfig,
  type DemoStory,
  type StorySummary,
} from '../src/lib/demo.js';

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
    const html = render(<DemoPanel defaultOpen />, state({ persona: CONFIG.personas[1] ?? null }));
    expect(html).toContain('Demo office');
    for (const candidate of CONFIG.personas) {
      expect(html).toContain(candidate.title);
      expect(html).toContain(candidate.displayName);
    }
    expect(html).toContain('Signed in as Rohan Mehta');
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toMatch(/usr_|@/);
  });

  it('warns when the session is not a demo persona', () => {
    expect(render(<DemoPanel defaultOpen />, state({}))).toContain(
      'Not signed in as a demo persona',
    );
  });
});

describe('DemoStart', () => {
  it('explains how to enable demo mode when it is off, and offers normal sign-in', () => {
    const html = render(<DemoStart />, state({ status: 'disabled', config: null }));
    expect(html).toContain('Demo mode is not enabled');
    expect(html).toContain('NEXORA_DEMO_MODE=true');
    expect(html).toContain('href="/api/auth/login"');
  });

  it('offers every persona and starts the story with the Team Manager', () => {
    const html = render(<DemoStart />, state({}));
    expect(html).toContain('Start the story as the Team Manager');
    expect(html).toContain('Manager asks');
    expect(html).toContain('CEO decides');
    expect(html).toContain('Finance decides');
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

const STEP_TITLES = [
  ['raise', 'The team asks for a hire', 'hiring'],
  ['ceo', 'The CEO decides', 'hiring'],
  ['finance', 'Finance decides', 'hiring'],
  ['open', 'HR opens the position', 'recruiting'],
  ['candidates', 'Candidates and interviews', 'recruiting'],
  ['offer', 'Offer and answer', 'recruiting'],
  ['onboard', 'Onboarding', 'onboarding'],
  ['assign', 'On to the project', 'onboarding'],
] as const;

/** A story as the backend would derive it, with the first `done` steps finished. */
function storyAt(done: number, who: DemoStory['steps'][number]['who'], action: string): DemoStory {
  const steps = STEP_TITLES.map(([key, title, screen], index) => ({
    key,
    title,
    screen,
    state:
      index < done
        ? ('done' as const)
        : index === done
          ? ('current' as const)
          : ('waiting' as const),
    detail: index === done ? 'The request is waiting for Finance.' : `Detail of ${key}.`,
    who: index === done ? who : [],
    ...(key === 'onboard' ? { owner: 'HR, IT and the hiring manager' } : {}),
  }));
  const current = steps[done];
  return {
    key: 'hiring',
    title: 'Hiring a new colleague',
    department: 'People',
    about: 'The team asks, the CEO and Finance decide, HR recruits.',
    subject: 'Senior Backend Developer',
    steps,
    ...(current === undefined
      ? {}
      : { next: { step: current.key, who, action, screen: current.screen } }),
    finished: current === undefined,
  };
}

describe('the guided story', () => {
  const personas = CONFIG.personas;
  const cfo = personas.find((persona) => persona.key === 'cfo')!;
  const manager = personas.find((persona) => persona.key === 'manager')!;
  const bar = (story: DemoStory, persona = manager, onStepPage = false) =>
    render(
      <StoryBarView
        story={story}
        persona={persona}
        personas={personas}
        onStepPage={onStepPage}
        hrefFor={(screen) => `/app/${screen}?scope`}
        storyHref="/app/demo?scope"
        onContinueAs={() => undefined}
      />,
      state({}),
    );

  it('names who the story is waiting for and offers to continue as them', () => {
    const html = bar(storyAt(2, ['cfo'], 'Approve the cost'));
    expect(html).toContain('data-tone="waiting"');
    expect(html).toContain('Story: Hiring a new colleague');
    expect(html).toContain('Step 3 of 8: Finance decides');
    expect(html).toContain('Waiting for Karan Malhotra, Chief Financial Officer.');
    expect(html).toContain('Continue as Karan');
    expect(html).not.toContain('Your turn');
    expect(html).not.toContain('Open Hiring');
  });

  it('marks the turn of the person signed in and points at the page', () => {
    const html = bar(storyAt(2, ['cfo'], 'Approve the cost'), cfo);
    expect(html).toContain('data-tone="turn"');
    expect(html).toContain('Your turn');
    expect(html).toContain('Approve the cost.');
    expect(html).toContain('href="/app/hiring?scope"');
    expect(html).not.toContain('Continue as');
  });

  it('does not send someone to the page they are already on', () => {
    const html = bar(storyAt(2, ['cfo'], 'Approve the cost'), cfo, true);
    expect(html).toContain('It is on this page.');
    expect(html).not.toContain('Open Hiring');
  });

  it('says so when the story is complete', () => {
    const html = bar(storyAt(8, [], ''));
    expect(html).toContain('data-tone="done"');
    expect(html).toContain('This story is complete');
    expect(html).not.toContain('Continue as');
  });

  const SUMMARIES: StorySummary[] = [
    {
      key: 'hiring',
      title: 'Hiring a new colleague',
      department: 'People',
      about: 'The team asks, the CEO and Finance decide, HR recruits.',
      status: 'in_progress',
      stepCount: 8,
      stepsDone: 2,
      waitingFor: ['cfo'],
    },
    {
      key: 'project',
      title: 'A project, from proposal to release',
      department: 'Engineering',
      about: 'Proposed, approved, assigned, tracked, released.',
      status: 'not_started',
      stepCount: 7,
      stepsDone: 0,
      waitingFor: ['cto'],
    },
    {
      key: 'flow.campaign',
      title: 'Marketing campaign',
      department: 'Marketing',
      about: 'Plan a campaign, get sign-off, launch it.',
      status: 'finished',
      stepCount: 6,
      stepsDone: 6,
      waitingFor: [],
    },
  ];
  const page = (story: DemoStory | null, stories: StorySummary[] | null) =>
    render(
      <GuidedDemoView
        story={story}
        stories={stories}
        persona={manager}
        personas={personas}
        hrefFor={(screen) => `/app/${screen}`}
        onContinueAs={() => undefined}
        onPick={() => undefined}
        onReset={() => undefined}
      />,
      state({}),
    );

  it('the guided demo page lists the steps of the story being followed, with state and owner', () => {
    const html = page(storyAt(2, ['cfo'], 'Approve the cost'), SUMMARIES);
    expect(html).toContain('Hiring a new colleague: Senior Backend Developer');
    for (const [, title] of STEP_TITLES) expect(html).toContain(title);
    expect(html.match(/class="nexora-step" data-state="done"/g)).toHaveLength(2);
    expect(html.match(/class="nexora-step" data-state="current"/g)).toHaveLength(1);
    expect(html.match(/class="nexora-step" data-state="waiting"/g)).toHaveLength(5);
    expect(html).toContain('HR, IT and the hiring manager');
    expect(html).toContain('Reset demo');
  });

  it('offers every story line, marks the one being followed, and says where each stands', () => {
    const html = page(storyAt(2, ['cfo'], 'Approve the cost'), SUMMARIES);
    expect(html).toContain('Choose a story to follow');
    expect(html).toContain('A project, from proposal to release');
    expect(html).toContain('Marketing campaign');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(storyStatusLabel(SUMMARIES[0]!, personas)).toBe('2 of 8 steps done, Karan’s turn');
    expect(storyStatusLabel(SUMMARIES[1]!, personas)).toBe('Not started');
    expect(storyStatusLabel(SUMMARIES[2]!, personas)).toBe('Complete');
    expect(html).toContain('2 of 8 steps done, Karan’s turn');
  });

  it('shows a reading state instead of inventing steps', () => {
    const html = page(null, null);
    expect(html).toContain('Reading the story');
    expect(html).not.toContain('nexora-step');
    expect(html).not.toContain('Choose a story to follow');
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

  it('the top-bar switcher lists every person', () => {
    const html = render(<DemoPanel defaultOpen />, state({ config: OFFICE }));
    for (const candidate of OFFICE.personas) {
      expect(html).toContain(candidate.displayName);
      expect(html).toContain(candidate.title);
    }
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(OFFICE.personas.length);
  });

  it('everyone lands on their own desk, in their own workspace', () => {
    const find = (key: string) => OFFICE.personas.find((persona) => persona.key === key)!;
    expect(demoHomePath('org_demo', find('ceo'))).toBe(
      '/app/desk?organizationId=org_demo&workspaceId=wsp_eng',
    );
    expect(demoHomePath('org_demo', find('hr'))).toBe(
      '/app/desk?organizationId=org_demo&workspaceId=wsp_hr',
    );
    expect(demoHomePath('org_demo', find('cto'))).toBe(
      '/app/desk?organizationId=org_demo&workspaceId=wsp_tech',
    );
  });
});
