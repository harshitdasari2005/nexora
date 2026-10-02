/**
 * @nexora/app-api — the story lines of the Guided Demo.
 *
 * The demo office can be walked through along several story lines:
 *
 *   hiring    a new colleague, from the team's request to their first project
 *   project   a project, from its proposal through the work to its release
 *   flow.*    one story per office workflow (leave, campaign, customer
 *             problem, discount, …) — every department in the catalog
 *
 * No story is set by a click. Each is DERIVED from the records the real
 * screens write, and "whose turn it is" is answered by the same authority
 * rules the routes enforce — the guide can never name someone the server
 * would refuse.
 */

import {
  OfficeRequest,
  WORKFLOW_CATALOG,
  findWorkflowStage,
  type OfficeRequestRepository,
  type WorkflowDefinition,
  type WorkflowSeat,
} from '@nexora/domain-hr';
import {
  ProjectTask,
  type ProjectRepository,
  type ProjectTaskRepository,
} from '@nexora/domain-projects';

import {
  hasPermission,
  resolveEffectivePermissions,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import type { RequestAuthority } from '../office/request-authority.js';
import {
  deriveStory,
  type DemoStory,
  type NamedDemoStory,
  type StoryFacts,
  type StoryInfo,
  type StoryStep,
} from './story.js';
import { DEMO_PERSONAS, type DemoIds, type DemoPersonaKey } from './world.js';

/** Who opens each workflow's story in the demo office (anyone allowed may, in real use). */
const STARTER: Record<string, DemoPersonaKey> = {
  project_proposal: 'cto',
  decision: 'manager',
  leave: 'dev_aarav',
  performance_review: 'dev_aarav',
  resignation: 'dev_meghna',
  complaint: 'dev_aarav',
  bug: 'dev_meghna',
  release: 'dev_aarav',
  incident: 'manager',
  campaign: 'marketing',
  content: 'marketing',
  discount: 'sales',
  contract: 'sales',
  ticket: 'support',
  escalation: 'support',
  refund: 'support',
  purchase: 'dev_meghna',
  expense_claim: 'dev_aarav',
  budget_request: 'manager',
  travel: 'sales',
  access: 'dev_aarav',
  equipment: 'dev_meghna',
  security_incident: 'dev_aarav',
  legal_review: 'sales',
  policy: 'hr',
};

/** Whose job a seat's stage is, as an office would say it. */
const SEAT_OWNER: Record<WorkflowSeat, string> = {
  manager: 'The requester’s manager',
  executive: 'The CEO',
  hr: 'HR',
  finance: 'Finance',
  it: 'IT',
  engineering: 'Engineering',
  marketing: 'Marketing',
  sales: 'Sales',
  support: 'Customer support',
  legal: 'Legal',
  requester: 'The person who asked',
};

export const HIRING_STORY: StoryInfo = {
  key: 'hiring',
  title: 'Hiring a new colleague',
  department: 'People',
  about:
    'The team asks, the CEO and Finance decide, HR recruits, the newcomer is onboarded and put on a project.',
};

export const PROJECT_STORY: StoryInfo = {
  key: 'project',
  title: 'A project, from proposal to release',
  department: 'Engineering',
  about:
    'A project is proposed and approved, work is assigned and tracked through review, and the result is released.',
};

/** Every story the demo can follow, in the order they are offered. */
export const STORIES: readonly StoryInfo[] = [
  HIRING_STORY,
  PROJECT_STORY,
  ...WORKFLOW_CATALOG.map((definition) => ({
    key: `flow.${definition.key}`,
    title: definition.name,
    department: definition.department,
    about: definition.description,
  })),
];

/** What is known about the request a workflow story follows. */
export interface StoryRequestFacts {
  status: string;
  /** What it asks for, in one line. */
  summary: string;
  stages: readonly { key: string; state: StoryStep['state'] }[];
  /** Who may take the stage it is waiting at, most natural person first. */
  pendingWho: readonly DemoPersonaKey[];
  /** Where each of them acts from, when it is not their own workspace. */
  at: Readonly<Partial<Record<DemoPersonaKey, string>>>;
}

/** Derives the story of one office workflow from its newest request. */
export function deriveWorkflowStory(
  definition: WorkflowDefinition,
  request: StoryRequestFacts | undefined,
): DemoStory {
  const starter = STARTER[definition.key] ?? 'manager';
  const steps: StoryStep[] = [
    {
      key: 'raise',
      title: 'Someone asks',
      state: request === undefined ? 'current' : 'done',
      detail:
        request === undefined
          ? 'Nobody has started this yet.'
          : `Started: ${request.summary === '' ? definition.name : request.summary}.`,
      who: request === undefined ? [starter] : [],
      screen: 'requests',
      owner: 'Anyone in the office',
    },
    ...definition.stages.map((stage): StoryStep => {
      const state = request?.stages.find((entry) => entry.key === stage.key)?.state ?? 'waiting';
      return {
        key: stage.key,
        title: stage.label,
        state,
        detail:
          state === 'done'
            ? 'Done.'
            : state === 'skipped'
              ? 'Not needed: the person who asked holds this seat.'
              : state === 'returned'
                ? 'Refused, with a reason. Start a new one to run the story again.'
                : state === 'current'
                  ? stage.kind === 'decide'
                    ? 'Waiting for a decision.'
                    : 'Waiting for the work to be done.'
                  : 'Not yet.',
        who: state === 'current' ? (request?.pendingWho ?? []) : [],
        screen: 'requests',
        owner: SEAT_OWNER[stage.seat],
      };
    }),
  ];

  if (request === undefined) {
    return {
      steps,
      next: {
        step: 'raise',
        who: [starter],
        action: `Start a “${definition.name}” workflow`,
        screen: 'requests',
      },
      finished: false,
    };
  }
  const current = steps.find((step) => step.state === 'current');
  const refused = request.status === 'rejected' || request.status === 'withdrawn';
  return {
    subject: request.summary === '' ? definition.name : request.summary,
    steps,
    ...(current !== undefined && current.who.length > 0
      ? {
          next: {
            step: current.key,
            who: current.who,
            action: current.title,
            screen: 'requests',
            ...(Object.keys(request.at).length === 0 ? {} : { at: request.at }),
          },
        }
      : refused
        ? {
            next: {
              step: 'raise',
              who: [starter],
              action: `Start a new “${definition.name}” workflow`,
              screen: 'requests',
            },
          }
        : {}),
    finished: request.status === 'approved',
  };
}

/** What is known about the project story. */
export interface ProjectStoryFacts {
  /** The newest project proposal. */
  proposal?: StoryRequestFacts & { name: string };
  /** The project the approved proposal opened. */
  projectOpened: boolean;
  /** The newest task on that project. */
  task?: {
    title: string;
    status: 'todo' | 'in_progress' | 'in_review' | 'done';
    assignee?: DemoPersonaKey;
    reviewers: readonly DemoPersonaKey[];
    at: Readonly<Partial<Record<DemoPersonaKey, string>>>;
  };
  /** The newest release request raised after the proposal. */
  release?: StoryRequestFacts;
}

/** Derives the project story: proposal → approval → work assigned → tracked → released. */
export function deriveProjectStory(facts: ProjectStoryFacts): DemoStory {
  const { proposal, task, release } = facts;
  const proposalStage = (key: string): StoryStep['state'] =>
    proposal?.stages.find((stage) => stage.key === key)?.state ?? 'waiting';
  const name = proposal?.name ?? 'the project';
  const refused = proposal?.status === 'rejected' || proposal?.status === 'withdrawn';
  const opened = facts.projectOpened && proposal?.status === 'approved';
  const builder: readonly DemoPersonaKey[] = task?.assignee === undefined ? [] : [task.assignee];

  type Draft = Omit<StoryStep, 'key' | 'title' | 'screen' | 'owner'> & {
    action?: string;
    at?: Readonly<Partial<Record<DemoPersonaKey, string>>>;
  };
  const waiting = (detail: string): Draft => ({ state: 'waiting', detail, who: [] });
  const done = (detail: string): Draft => ({ state: 'done', detail, who: [] });

  const propose: Draft =
    proposal === undefined || refused
      ? {
          state: refused ? 'returned' : 'current',
          detail: refused
            ? 'The last proposal was refused. A new one starts the story again.'
            : 'Nobody has proposed a project yet.',
          who: ['cto'],
          action: 'Propose a project: start a “Project proposal” workflow',
        }
      : done(`“${name}” was proposed.`);

  const decision = (stageKey: string, label: string, doneText: string): Draft => {
    if (proposal === undefined || refused) return waiting('Starts once a project is proposed.');
    const state = proposalStage(stageKey);
    if (state === 'done' || state === 'skipped') return done(doneText);
    if (state === 'current') {
      return {
        state: 'current',
        detail: `The proposal is waiting for ${label}.`,
        who: proposal.pendingWho,
        action: `Decide on the proposal for “${name}”`,
        at: proposal.at,
      };
    }
    return waiting('Not yet.');
  };

  const assign: Draft = !opened
    ? waiting('Starts once the proposal is approved and the project is open.')
    : task === undefined
      ? {
          state: 'current',
          detail: `“${name}” is open and has no tasks yet.`,
          who: ['manager'],
          action: `Create the first task on “${name}” and give it to someone`,
        }
      : done(`Work was given out: “${task.title}”.`);

  const build: Draft =
    task === undefined
      ? waiting('Starts once a task is assigned.')
      : task.status === 'todo'
        ? {
            state: 'current',
            detail: `“${task.title}” is waiting to be started.`,
            who: builder,
            action: `Start “${task.title}”`,
          }
        : task.status === 'in_progress'
          ? {
              state: 'current',
              detail: `“${task.title}” is in progress.`,
              who: builder,
              action: `Finish “${task.title}” and hand it in`,
            }
          : done(`“${task.title}” was handed in.`);

  const review: Draft =
    task === undefined || task.status === 'todo' || task.status === 'in_progress'
      ? waiting('Starts once the work is handed in.')
      : task.status === 'in_review'
        ? {
            state: 'current',
            detail: `“${task.title}” is waiting for review.`,
            who: task.reviewers,
            action: `Review “${task.title}”: accept it or send it back`,
            at: task.at,
          }
        : done(`“${task.title}” was accepted.`);

  const releaseStep: Draft =
    task?.status !== 'done'
      ? waiting('Starts once the work is accepted.')
      : release === undefined || release.status === 'rejected' || release.status === 'withdrawn'
        ? {
            state: 'current',
            detail: 'The work is done and not released yet.',
            who: builder.length > 0 ? builder : ['manager'],
            action: 'Ask to release it: start a “Release approval” workflow',
          }
        : release.status === 'approved'
          ? done('Released.')
          : {
              state: 'current',
              detail: 'The release is on its way through its approvals.',
              who: release.pendingWho,
              action: 'Take your step of the release approval',
              at: release.at,
            };

  const drafts: {
    key: string;
    title: string;
    screen: StoryStep['screen'];
    owner: string;
    draft: Draft;
  }[] = [
    {
      key: 'propose',
      title: 'A project is proposed',
      screen: 'requests',
      owner: 'Whoever has the idea',
      draft: propose,
    },
    {
      key: 'ceo',
      title: 'The CEO decides',
      screen: 'requests',
      owner: 'The CEO',
      draft: decision('executive', 'the CEO', 'The CEO approved the proposal.'),
    },
    {
      key: 'finance',
      title: 'Finance approves the cost',
      screen: 'requests',
      owner: 'Finance',
      draft: decision(
        'finance',
        'Finance',
        'Finance approved the cost, and the project was opened.',
      ),
    },
    {
      key: 'assign',
      title: 'The work is given out',
      screen: 'tasks',
      owner: 'The team’s manager',
      draft: assign,
    },
    {
      key: 'build',
      title: 'The work is done',
      screen: 'tasks',
      owner: 'The person it was given to',
      draft: build,
    },
    {
      key: 'review',
      title: 'The work is reviewed',
      screen: 'tasks',
      owner: 'The team’s manager',
      draft: review,
    },
    {
      key: 'release',
      title: 'It is released',
      screen: 'requests',
      owner: 'The team, its manager and engineering',
      draft: releaseStep,
    },
  ];
  const steps: StoryStep[] = drafts.map(({ key, title, screen, owner, draft }) => ({
    key,
    title,
    screen,
    owner,
    state: draft.state,
    detail: draft.detail,
    who: draft.who,
  }));
  const next = drafts.find(
    (entry) => entry.draft.action !== undefined && entry.draft.who.length > 0,
  );
  return {
    ...(proposal === undefined ? {} : { subject: proposal.name }),
    steps,
    ...(next === undefined
      ? {}
      : {
          next: {
            step: next.key,
            who: next.draft.who,
            action: next.draft.action as string,
            screen: next.screen,
            ...(next.draft.at === undefined || Object.keys(next.draft.at).length === 0
              ? {}
              : { at: next.draft.at }),
          },
        }),
    finished: steps.every((step) => step.state === 'done'),
  };
}

/** What the stories reader needs. */
export interface StoriesReaderDependencies {
  ids: DemoIds;
  requests: OfficeRequestRepository;
  tasks: ProjectTaskRepository;
  projects: ProjectRepository;
  authority: RequestAuthority;
  permissions: PermissionResolverDependencies;
  /** The demo persona a user id belongs to (undefined for anyone else). */
  personaOfUser: (userId: string) => DemoPersonaKey | undefined;
  /** The hiring story's facts (its own reader). */
  readHiringFacts: (organizationId: string) => Promise<StoryFacts>;
}

/** Reads and derives the demo's stories from the demo organization's records. */
export class StoriesReader {
  readonly #deps: StoriesReaderDependencies;

  constructor(dependencies: StoriesReaderDependencies) {
    this.#deps = dependencies;
  }

  /** The workspace a persona acts from for a piece of work in `workspaceId`. */
  #seatOf(persona: DemoPersonaKey, workspaceId: string): string {
    const home = DEMO_PERSONAS.find((entry) => entry.key === persona);
    // The CEO sits in every team; everyone else acts from their own.
    return persona === 'ceo' || home === undefined
      ? workspaceId
      : this.#deps.ids.workspaceIds[home.workspace];
  }

  /** The demo people (most natural first: the CEO last) who pass `allowed`. */
  async #who(
    workspaceId: string,
    allowed: (persona: DemoPersonaKey, userId: string, seat: string) => Promise<boolean>,
  ): Promise<{ who: DemoPersonaKey[]; at: Partial<Record<DemoPersonaKey, string>> }> {
    const who: DemoPersonaKey[] = [];
    const at: Partial<Record<DemoPersonaKey, string>> = {};
    const order = [...DEMO_PERSONAS].sort(
      (a, b) => Number(a.key === 'ceo') - Number(b.key === 'ceo'),
    );
    for (const persona of order) {
      const seat = this.#seatOf(persona.key, workspaceId);
      if (await allowed(persona.key, this.#deps.ids.userIds[persona.key], seat)) {
        who.push(persona.key);
        if (seat !== this.#deps.ids.workspaceIds[persona.workspace]) at[persona.key] = seat;
      }
    }
    return { who: who.slice(0, 3), at };
  }

  async #requestFacts(request: OfficeRequest): Promise<StoryRequestFacts> {
    const definition = request.workflow;
    const snapshot = OfficeRequest.snapshot(request);
    const summary =
      definition === undefined
        ? ''
        : definition.summaryFields
            .map((key) => snapshot.details[key])
            .filter((value): value is string => typeof value === 'string')
            .join(', ');
    const { who, at } =
      request.pendingStage === undefined
        ? { who: [], at: {} }
        : await this.#who(request.workspaceId, async (_persona, userId, seat) => {
            if (request.decisionBlocker(userId) !== undefined) return false;
            const scope = { organizationId: request.organizationId, workspaceId: seat };
            const effective = await resolveEffectivePermissions(this.#deps.permissions, {
              userId,
              tenantId: request.organizationId,
              workspaceId: seat,
            });
            return this.#deps.authority.mayTakePending(request, scope, effective, userId);
          });
    return { status: request.status, summary, stages: request.stageStates(), pendingWho: who, at };
  }

  /** The newest request of a workflow that was not withdrawn. */
  #newest(all: readonly OfficeRequest[], type: string, after?: string): OfficeRequest | undefined {
    return all.find(
      (request) =>
        request.type === type &&
        request.status !== 'withdrawn' &&
        (after === undefined || OfficeRequest.snapshot(request).createdAt >= after),
    );
  }

  async #projectFacts(all: readonly OfficeRequest[]): Promise<ProjectStoryFacts> {
    const organizationId = this.#deps.ids.organizationId as never;
    const proposal = this.#newest(all, 'project_proposal');
    if (proposal === undefined) return { projectOpened: false };
    const snapshot = OfficeRequest.snapshot(proposal);
    const name =
      typeof snapshot.details['name'] === 'string' ? snapshot.details['name'] : 'Project';
    const proposalFacts = { ...(await this.#requestFacts(proposal)), name };
    const project = (await this.#deps.projects.listByOrganization(organizationId)).find(
      (entry) => entry.name.value.toLowerCase() === name.toLowerCase(),
    );
    if (project === undefined) return { proposal: proposalFacts, projectOpened: false };

    const task = (await this.#deps.tasks.listByOrganization(organizationId)).find(
      (entry) => entry.projectId === project.id,
    );
    const release = this.#newest(all, 'release', snapshot.createdAt);
    const releaseFacts = release === undefined ? undefined : await this.#requestFacts(release);
    if (task === undefined) {
      return {
        proposal: proposalFacts,
        projectOpened: true,
        ...(releaseFacts === undefined ? {} : { release: releaseFacts }),
      };
    }
    const taskSnapshot = ProjectTask.snapshot(task);
    const assignee = this.#deps.personaOfUser(task.assigneeId);
    const reviewers = await this.#who(task.workspaceId, async (_persona, userId, seat) => {
      if (userId === task.assigneeId) return false;
      const effective = await resolveEffectivePermissions(this.#deps.permissions, {
        userId,
        tenantId: task.organizationId,
        workspaceId: seat,
      });
      return hasPermission(effective, 'tasks.manage') && seat === task.workspaceId;
    });
    return {
      proposal: proposalFacts,
      projectOpened: true,
      task: {
        title: taskSnapshot.title,
        status: taskSnapshot.status,
        ...(assignee === undefined ? {} : { assignee }),
        reviewers: reviewers.who,
        at: reviewers.at,
      },
      ...(releaseFacts === undefined ? {} : { release: releaseFacts }),
    };
  }

  /** One story, by key (undefined when there is no such story). */
  async read(key: string): Promise<NamedDemoStory | undefined> {
    const info = STORIES.find((story) => story.key === key);
    if (info === undefined) return undefined;
    const organizationId = this.#deps.ids.organizationId;
    if (key === HIRING_STORY.key) {
      return { ...info, ...deriveStory(await this.#deps.readHiringFacts(organizationId)) };
    }
    const all = await this.#deps.requests.listByOrganization(organizationId as never);
    if (key === PROJECT_STORY.key) {
      return { ...info, ...deriveProjectStory(await this.#projectFacts(all)) };
    }
    const definition = WORKFLOW_CATALOG.find((entry) => `flow.${entry.key}` === key);
    if (definition === undefined) return undefined;
    const newest = this.#newest(all, definition.key);
    return {
      ...info,
      ...deriveWorkflowStory(
        definition,
        newest === undefined ? undefined : await this.#requestFacts(newest),
      ),
    };
  }

  /** Every story with where it stands (for choosing one). */
  async list(): Promise<
    (StoryInfo & {
      status: 'not_started' | 'in_progress' | 'finished';
      stepCount: number;
      stepsDone: number;
      waitingFor: readonly DemoPersonaKey[];
    })[]
  > {
    const out = [];
    for (const info of STORIES) {
      const story = await this.read(info.key);
      if (story === undefined) continue;
      const stepsDone = story.steps.filter(
        (step) => step.state === 'done' || step.state === 'skipped',
      ).length;
      out.push({
        ...info,
        status: story.finished
          ? ('finished' as const)
          : stepsDone === 0
            ? ('not_started' as const)
            : ('in_progress' as const),
        stepCount: story.steps.length,
        stepsDone,
        waitingFor: story.next?.who ?? [],
      });
    }
    return out;
  }
}

/** The label of a stage in a workflow (exported for tests). */
export function stageLabel(definition: WorkflowDefinition, key: string): string {
  return findWorkflowStage(definition, key)?.label ?? key;
}
