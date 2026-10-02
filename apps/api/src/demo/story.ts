/**
 * @nexora/app-api — the Guided Demo story (pure).
 *
 * The demo tells one story the way an office runs it: a team's manager asks
 * for a hire, the CEO decides, Finance decides, HR recruits and makes the
 * offer, the new colleague is onboarded by HR, IT and the manager, and the
 * manager puts them on the project.
 *
 * Nothing here is set by a click. `deriveStory` is a function of facts read
 * from the same records the real screens write — so a step is `done` only
 * when the record that proves it exists, and the guide can always say whose
 * turn it is. The guide never carries pay: no salary range and no offer
 * amount leave this module.
 */

import type { DemoPersonaKey } from './world.js';

/** The screen a step is done on. */
export type StoryScreen = 'hiring' | 'recruiting' | 'onboarding';

/** Where a step stands. */
export type StoryStepState = 'done' | 'current' | 'waiting' | 'skipped' | 'returned';

/** The keys of the story's steps, in order. */
export const STORY_STEP_KEYS = [
  'raise',
  'ceo',
  'finance',
  'open',
  'candidates',
  'offer',
  'onboard',
  'assign',
] as const;
export type StoryStepKey = (typeof STORY_STEP_KEYS)[number];

/** One step of the story. */
export interface StoryStep {
  key: StoryStepKey;
  /** What happens in this step, in plain words. */
  title: string;
  state: StoryStepState;
  /** One truthful sentence about where the step stands. */
  detail: string;
  /** Who acts now — set only on the current (or returned) step. */
  who: readonly DemoPersonaKey[];
  screen: StoryScreen;
}

/** The story as the guide shows it. */
export interface DemoStory {
  /** What the story is about once a request exists (the job title). */
  subject?: string;
  steps: readonly StoryStep[];
  /** The step someone has to act on next; absent when the story is finished. */
  next?: {
    step: StoryStepKey;
    who: readonly DemoPersonaKey[];
    action: string;
    screen: StoryScreen;
  };
  finished: boolean;
}

/** The facts the story is derived from (each read from the persisted records). */
export interface StoryFacts {
  /** The request the story follows: the newest one that was not withdrawn. */
  requisition?: {
    jobTitle: string;
    /** `pending_executive` | `pending_finance` | `approved` | `changes_requested`. */
    status: string;
    /** The persona who raised it (undefined when it was not a demo persona). */
    raisedBy?: DemoPersonaKey;
    /** The CEO raised it, so there is no separate CEO decision. */
    executiveNotRequired: boolean;
    /** The CEO approved it in the current round. */
    executiveApproved: boolean;
    /** The stage that sent it back, when it was sent back. */
    returnedFrom?: 'executive' | 'finance';
    hasProject: boolean;
  };
  /** The position HR opened for the request. */
  opening?: { status: string };
  /** The candidates on that position. */
  candidates: readonly {
    name: string;
    /** `applied` | `screening` | `interview` | `offer` | `hired` | `rejected` | `withdrawn`. */
    stage: string;
    feedbackCount: number;
  }[];
  /** The person hired through the request. */
  hire?: { name: string };
  /** That person's onboarding, once HR started it. */
  onboarding?: {
    completed: boolean;
    items: readonly { owner: 'hr' | 'it' | 'manager'; title: string; done: boolean }[];
  };
  /** The hire is on the project the request named. */
  assigned: boolean;
  projectName?: string;
}

const MANAGER: readonly DemoPersonaKey[] = ['manager'];
const CEO: readonly DemoPersonaKey[] = ['ceo'];
const FINANCE: readonly DemoPersonaKey[] = ['cfo'];
const HR: readonly DemoPersonaKey[] = ['hr'];
const IT: readonly DemoPersonaKey[] = ['dev_aarav'];

const OWNER_PERSONA: Record<'hr' | 'it' | 'manager', readonly DemoPersonaKey[]> = {
  hr: HR,
  it: IT,
  manager: MANAGER,
};

type StepDraft = Omit<StoryStep, 'key' | 'title' | 'screen'> & { action?: string };

const waiting = (detail: string): StepDraft => ({ state: 'waiting', detail, who: [] });
const done = (detail: string): StepDraft => ({ state: 'done', detail, who: [] });
const current = (who: readonly DemoPersonaKey[], detail: string, action: string): StepDraft => ({
  state: 'current',
  detail,
  who,
  action,
});

/** Derives the eight steps of the story from the facts. */
export function deriveStory(facts: StoryFacts): DemoStory {
  const { requisition, opening, candidates, hire, onboarding } = facts;
  const raiser = requisition?.raisedBy === undefined ? MANAGER : [requisition.raisedBy];
  const approved = requisition?.status === 'approved';

  // 1. The team asks for a hire.
  const raise: StepDraft =
    requisition === undefined
      ? current(MANAGER, 'Nobody has asked for a hire yet.', 'Raise a hiring request for the team')
      : requisition.status === 'changes_requested'
        ? {
            state: 'returned',
            detail: `${requisition.returnedFrom === 'finance' ? 'Finance' : 'The CEO'} sent the request back with a reason.`,
            who: raiser,
            action: 'Read the reason, revise the request and send it again',
          }
        : done(`A hiring request for a ${requisition.jobTitle} was raised.`);

  // 2. The CEO decides.
  const ceo: StepDraft =
    requisition === undefined
      ? waiting('Starts once a request is raised.')
      : requisition.executiveNotRequired
        ? {
            state: 'skipped',
            detail: 'The CEO raised the request, so no separate CEO decision is needed.',
            who: [],
          }
        : requisition.status === 'pending_executive'
          ? current(
              CEO,
              'The request is waiting for the CEO.',
              'Approve the request, or send it back with a reason',
            )
          : requisition.executiveApproved
            ? done('The CEO approved the request.')
            : waiting('Waiting for the revised request.');

  // 3. Finance decides.
  const finance: StepDraft =
    requisition === undefined
      ? waiting('Starts after the CEO decides.')
      : approved
        ? done('Finance approved the cost.')
        : requisition.status === 'pending_finance'
          ? current(
              FINANCE,
              'The request is waiting for Finance.',
              'Approve the cost, or send the request back with a reason',
            )
          : waiting('Starts after the CEO decides.');

  // 4. HR opens the position.
  const open: StepDraft = !approved
    ? waiting('Starts once the CEO and Finance have both approved.')
    : opening === undefined
      ? current(
          HR,
          'The request is approved and waiting for HR.',
          'Open the position and write the job posting',
        )
      : done('HR opened the position.');

  // 5. Candidates and interviews.
  const live = candidates.filter(
    (candidate) => !['rejected', 'withdrawn'].includes(candidate.stage),
  );
  const offered = live.find((candidate) => candidate.stage === 'offer');
  const interviewing = live.find((candidate) => candidate.stage === 'interview');
  const early = live.find((candidate) => ['applied', 'screening'].includes(candidate.stage));
  const candidatesStep: StepDraft =
    opening === undefined
      ? waiting('Starts once the position is open.')
      : hire !== undefined || offered !== undefined
        ? done('A candidate was interviewed and chosen.')
        : opening.status !== 'open'
          ? waiting(
              opening.status === 'on_hold'
                ? 'HR has put recruiting on hold.'
                : 'HR closed the position without filling it.',
            )
          : interviewing !== undefined
            ? interviewing.feedbackCount === 0
              ? current(
                  MANAGER,
                  `${interviewing.name} is at the interview stage.`,
                  `Give interview feedback on ${interviewing.name}`,
                )
              : current(
                  HR,
                  `${interviewing.name} has interview feedback.`,
                  `Make ${interviewing.name} an offer`,
                )
            : early !== undefined
              ? current(HR, `${early.name} has applied.`, `Move ${early.name} on to the interview`)
              : current(HR, 'The position is open and has no candidates yet.', 'Add a candidate');

  // 6. Offer and answer.
  const offer: StepDraft =
    hire !== undefined
      ? done(`${hire.name} accepted the offer and was hired.`)
      : offered !== undefined
        ? current(
            HR,
            `An offer is out to ${offered.name}.`,
            `Record ${offered.name}'s answer to the offer`,
          )
        : waiting('Starts once a candidate has been interviewed.');

  // 7. Onboarding.
  const remaining = onboarding?.items.filter((item) => !item.done) ?? [];
  const onboardWho = [...new Set(remaining.flatMap((item) => OWNER_PERSONA[item.owner]))];
  const onboard: StepDraft =
    hire === undefined
      ? waiting('Starts once someone is hired.')
      : onboarding === undefined
        ? current(
            HR,
            `${hire.name} is hired; onboarding has not started.`,
            `Start ${hire.name}'s onboarding`,
          )
        : onboarding.completed
          ? done(`${hire.name} is onboarded and active.`)
          : current(
              onboardWho,
              `${remaining.length} of ${onboarding.items.length} onboarding items ${remaining.length === 1 ? 'is' : 'are'} still open.`,
              'Complete your part of the onboarding checklist',
            );

  // 8. The manager puts them on the project.
  const assign: StepDraft =
    requisition !== undefined && !requisition.hasProject
      ? { state: 'skipped', detail: 'The request did not name a project.', who: [] }
      : facts.assigned
        ? done(`${hire?.name ?? 'The new colleague'} is on ${facts.projectName ?? 'the project'}.`)
        : hire !== undefined && onboarding?.completed === true
          ? current(
              raiser,
              `${hire.name} is active and not on a project yet.`,
              `Assign ${hire.name} to ${facts.projectName ?? 'the project'}`,
            )
          : waiting('Starts once onboarding is complete.');

  const drafts: Record<StoryStepKey, { title: string; screen: StoryScreen; draft: StepDraft }> = {
    raise: { title: 'The team asks for a hire', screen: 'hiring', draft: raise },
    ceo: { title: 'The CEO decides', screen: 'hiring', draft: ceo },
    finance: { title: 'Finance decides', screen: 'hiring', draft: finance },
    open: { title: 'HR opens the position', screen: 'recruiting', draft: open },
    candidates: { title: 'Candidates and interviews', screen: 'recruiting', draft: candidatesStep },
    offer: { title: 'Offer and answer', screen: 'recruiting', draft: offer },
    onboard: { title: 'Onboarding', screen: 'onboarding', draft: onboard },
    assign: { title: 'On to the project', screen: 'onboarding', draft: assign },
  };

  const steps: StoryStep[] = STORY_STEP_KEYS.map((key) => {
    const { title, screen, draft } = drafts[key];
    return { key, title, screen, state: draft.state, detail: draft.detail, who: draft.who };
  });
  const nextKey = STORY_STEP_KEYS.find((key) => drafts[key].draft.action !== undefined);
  const finished = steps.every((step) => step.state === 'done' || step.state === 'skipped');
  return {
    ...(requisition === undefined ? {} : { subject: requisition.jobTitle }),
    steps,
    ...(nextKey === undefined
      ? {}
      : {
          next: {
            step: nextKey,
            who: drafts[nextKey].draft.who,
            action: drafts[nextKey].draft.action as string,
            screen: drafts[nextKey].screen,
          },
        }),
    finished,
  };
}
