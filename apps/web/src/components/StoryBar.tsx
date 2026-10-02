/**
 * @nexora/app-web — the guided story bar.
 *
 * In the demo office, every page carries one line about the story the viewer
 * is following: which step it is at, and whose turn it is. When it is the turn
 * of the person signed in, the bar is the amber marker and points at the page
 * where the work is done; otherwise it names who the story is waiting for and
 * offers to continue as them.
 *
 * The bar decides nothing. Every story is derived on the server from the real
 * records (`GET /api/demo/story`) and read again after every change.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, typography } from '@nexora/design-system';

import { useDemo } from '../demo/demo-state.js';
import { CHANGE_EVENT } from '../lib/api.js';
import {
  DEFAULT_STORY,
  fetchDemoStory,
  selectedStoryKey,
  STORY_EVENT,
  type DemoPersona,
  type DemoStory,
  type StoryScreen,
} from '../lib/demo.js';

const SCREEN_LABEL: Record<StoryScreen, string> = {
  hiring: 'Hiring',
  recruiting: 'Recruiting',
  onboarding: 'Onboarding',
  requests: 'Office workflows',
  tasks: 'Tasks',
};
const SCREENS = Object.keys(SCREEN_LABEL) as StoryScreen[];

/** Reads the story the viewer follows, and again after every change. */
export function useDemoStory(): DemoStory | null {
  const demo = useDemo();
  const personaKey = demo.persona?.key;
  const enabled = demo.status === 'enabled' && personaKey !== undefined;
  const [story, setStory] = useState<DemoStory | null>(null);

  const load = useCallback(() => {
    if (!enabled) {
      setStory(null);
      return;
    }
    fetchDemoStory(selectedStoryKey()).then(setStory, () => {
      // A story that no longer exists: fall back to the first one.
      fetchDemoStory(DEFAULT_STORY).then(setStory, () => setStory(null));
    });
  }, [enabled]);

  useEffect(() => {
    load();
    window.addEventListener(CHANGE_EVENT, load);
    window.addEventListener(STORY_EVENT, load);
    return () => {
      window.removeEventListener(CHANGE_EVENT, load);
      window.removeEventListener(STORY_EVENT, load);
    };
    // The persona is part of the key: a different person may see a different turn.
  }, [load, personaKey]);

  return story;
}

/** Names the people a step is waiting for: "Karan Malhotra, Chief Financial Officer". */
export function describePeople(people: readonly DemoPersona[]): string {
  const named = people.map((person) => `${person.displayName}, ${person.title}`);
  if (named.length <= 1) return named[0] ?? 'someone in the office';
  return `${named.slice(0, -1).join('; ')} or ${named[named.length - 1]}`;
}

/** Props of {@link StoryBarView}. */
export interface StoryBarViewProps {
  story: DemoStory;
  /** The persona of the current session. */
  persona: DemoPersona;
  personas: readonly DemoPersona[];
  /** The step's page is the one on screen, in the workspace the step needs. */
  onStepPage?: boolean;
  /** Where "open the page" goes for the current persona. */
  hrefFor: (screen: StoryScreen) => string;
  /** The page listing every step (omitted on that page itself). */
  storyHref?: string;
  /** Signs in as someone else and goes to the step's screen. */
  onContinueAs: (persona: DemoPersona, screen: StoryScreen) => void;
  busy?: boolean;
}

/** The pure bar (exported for tests). */
export function StoryBarView({
  story,
  persona,
  personas,
  onStepPage = false,
  hrefFor,
  storyHref,
  onContinueAs,
  busy = false,
}: StoryBarViewProps): JSX.Element {
  const { next } = story;
  const stepNumber =
    next === undefined ? 0 : story.steps.findIndex((step) => step.key === next.step) + 1;
  const step = next === undefined ? undefined : story.steps[stepNumber - 1];
  const myTurn = next !== undefined && next.who.includes(persona.key);
  const waitingFor =
    next === undefined
      ? []
      : next.who
          .map((key) => personas.find((candidate) => candidate.key === key))
          .filter((candidate): candidate is DemoPersona => candidate !== undefined);
  const paused = story.steps.find((entry) => entry.state === 'waiting');

  const tone = story.finished ? 'done' : myTurn ? 'turn' : 'waiting';
  return (
    <aside className="nexora-story" data-tone={tone} aria-label="Guided demo">
      <div className="nexora-story-pips" aria-hidden>
        {story.steps.map((entry) => (
          <span key={entry.key} data-state={entry.state} />
        ))}
      </div>
      <div className="nexora-story-body">
        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
          <div className="nexora-story-name">Story: {story.title}</div>
          {story.finished ? (
            <>
              <div className="nexora-story-title">This story is complete</div>
              <div className="nexora-story-text">
                {story.steps[story.steps.length - 1]?.detail} Pick another story, or reset the demo
                to run this one again.
              </div>
            </>
          ) : next === undefined || step === undefined ? (
            <>
              <div className="nexora-story-title">Nothing is waiting on anyone right now</div>
              <div className="nexora-story-text">{paused?.detail}</div>
            </>
          ) : (
            <>
              <div className="nexora-story-title">
                {myTurn ? <span className="nexora-turn-tag">Your turn</span> : null}
                <span>
                  Step {stepNumber} of {story.steps.length}: {step.title}
                </span>
              </div>
              <div className="nexora-story-text">
                {myTurn
                  ? `${next.action}.`
                  : `Waiting for ${describePeople(waitingFor)}. ${step.detail}`}
              </div>
            </>
          )}
        </div>
        <div className="nexora-actions">
          {next !== undefined && myTurn && !onStepPage ? (
            <Link to={hrefFor(next.screen)} style={{ textDecoration: 'none' }}>
              <Button>Open {SCREEN_LABEL[next.screen]}</Button>
            </Link>
          ) : null}
          {next !== undefined && myTurn && onStepPage ? (
            <span style={{ fontSize: typography.sizes.sm, fontWeight: 600 }}>
              It is on this page.
            </span>
          ) : null}
          {next !== undefined && !myTurn
            ? waitingFor.slice(0, 2).map((person) => (
                <Button
                  key={person.key}
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onContinueAs(person, next.screen)}
                >
                  Continue as {person.displayName.split(' ')[0]}
                </Button>
              ))
            : null}
          {storyHref === undefined ? null : (
            <Link to={storyHref} className="nexora-story-link">
              All stories
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}

const scopeQuery = (organizationId: string, workspaceId: string): string =>
  `organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`;

/** The navigation a story needs: where each person does the pending step. */
export function useStoryNavigation(
  story: DemoStory | null,
  current: { organizationId?: string; workspaceId?: string },
): {
  hrefFor: (screen: StoryScreen) => string;
  onContinueAs: (target: DemoPersona, screen: StoryScreen) => void;
  ownScope: string;
  onStepPage: boolean;
} | null {
  const demo = useDemo();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (demo.config === null || demo.persona === null) return null;
  const { config, persona } = demo;
  const at = story?.next?.at ?? {};
  // Where THIS person does the step: the team the guide names, else where they are.
  const myWorkspace = at[persona.key] ?? current.workspaceId ?? persona.workspaceId;
  const organizationId = current.organizationId ?? config.organizationId;
  const screen = SCREENS.find((entry) => pathname.startsWith(`/app/${entry}`));
  return {
    hrefFor: (target) => `/app/${target}?${scopeQuery(organizationId, myWorkspace)}`,
    ownScope: scopeQuery(organizationId, current.workspaceId ?? persona.workspaceId),
    onStepPage:
      story?.next !== undefined &&
      screen === story.next.screen &&
      (current.workspaceId === undefined || current.workspaceId === myWorkspace),
    onContinueAs: (target, targetScreen) => {
      void demo
        .switchPersona(target.key)
        .then(() =>
          navigate(
            `/app/${targetScreen}?${scopeQuery(config.organizationId, at[target.key] ?? target.workspaceId)}`,
          ),
        );
    },
  };
}

/** The bar for the current demo session (renders nothing outside the demo office). */
export function StoryBar({
  organizationId,
  workspaceId,
}: {
  organizationId?: string;
  workspaceId?: string;
}): JSX.Element | null {
  const demo = useDemo();
  const story = useDemoStory();
  const { pathname } = useLocation();
  const navigation = useStoryNavigation(story, {
    ...(organizationId === undefined ? {} : { organizationId }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  });
  if (demo.config === null || demo.persona === null || story === null || navigation === null) {
    return null;
  }
  // The guided demo page IS the story; it does not need a summary of itself.
  if (pathname.startsWith('/app/demo')) return null;

  return (
    <StoryBarView
      story={story}
      persona={demo.persona}
      personas={demo.config.personas}
      onStepPage={navigation.onStepPage}
      hrefFor={navigation.hrefFor}
      storyHref={`/app/demo?${navigation.ownScope}`}
      busy={demo.busy}
      onContinueAs={navigation.onContinueAs}
    />
  );
}
