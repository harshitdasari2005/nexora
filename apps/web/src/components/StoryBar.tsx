/**
 * @nexora/app-web — the guided story bar.
 *
 * In the demo office, every page carries one line about the hiring story:
 * which step it is at, and whose turn it is. When it is the turn of the
 * person signed in, the bar is the amber marker and points at the page where
 * the work is done; otherwise it names who the story is waiting for and
 * offers to continue as them.
 *
 * The bar decides nothing. The story is derived on the server from the hiring
 * records (`GET /api/demo/story`) and read again after every change.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, typography } from '@nexora/design-system';

import { useDemo } from '../demo/demo-state.js';
import { CHANGE_EVENT } from '../lib/api.js';
import {
  demoScopeQuery,
  fetchDemoStory,
  type DemoPersona,
  type DemoStory,
  type StoryScreen,
} from '../lib/demo.js';

const SCREEN_LABEL: Record<StoryScreen, string> = {
  hiring: 'Hiring',
  recruiting: 'Recruiting',
  onboarding: 'Onboarding',
};

/** Reads the guided story for the current demo session, and again after every change. */
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
    fetchDemoStory().then(setStory, () => setStory(null));
  }, [enabled]);

  useEffect(() => {
    load();
    window.addEventListener(CHANGE_EVENT, load);
    return () => window.removeEventListener(CHANGE_EVENT, load);
    // The persona is part of the key: a different person may see a different turn.
  }, [load, personaKey]);

  return story;
}

/** Names the people a step is waiting for: "Karan Malhotra, Chief Financial Officer". */
export function describePeople(people: readonly DemoPersona[]): string {
  const named = people.map((person) => `${person.displayName}, ${person.title}`);
  if (named.length <= 1) return named[0] ?? 'someone in the office';
  return `${named.slice(0, -1).join('; ')} and ${named[named.length - 1]}`;
}

/** Props of {@link StoryBarView}. */
export interface StoryBarViewProps {
  story: DemoStory;
  /** The persona of the current session. */
  persona: DemoPersona;
  personas: readonly DemoPersona[];
  /** The screen the user is on, when it is one of the story's screens. */
  currentScreen?: StoryScreen;
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
  currentScreen,
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
          {story.finished ? (
            <>
              <div className="nexora-story-title">The hiring story is complete</div>
              <div className="nexora-story-text">
                {story.steps[story.steps.length - 1]?.detail} Reset the demo to run it again.
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
          {next !== undefined && myTurn && currentScreen !== next.screen ? (
            <Link to={hrefFor(next.screen)} style={{ textDecoration: 'none' }}>
              <Button>Open {SCREEN_LABEL[next.screen]}</Button>
            </Link>
          ) : null}
          {next !== undefined && myTurn && currentScreen === next.screen ? (
            <span style={{ fontSize: typography.sizes.sm, fontWeight: 600 }}>
              It is on this page.
            </span>
          ) : null}
          {next !== undefined && !myTurn
            ? waitingFor.slice(0, 3).map((person) => (
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
              All steps
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
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
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (demo.config === null || demo.persona === null || story === null) return null;
  // The guided demo page IS the story; it does not need a summary of itself.
  if (pathname.startsWith('/app/demo')) return null;
  const { config, persona } = demo;

  const ownScope =
    organizationId !== undefined && workspaceId !== undefined
      ? `organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`
      : demoScopeQuery(config.organizationId, persona);
  const currentScreen = (['hiring', 'recruiting', 'onboarding'] as const).find((screen) =>
    pathname.startsWith(`/app/${screen}`),
  );

  return (
    <StoryBarView
      story={story}
      persona={persona}
      personas={config.personas}
      {...(currentScreen === undefined ? {} : { currentScreen })}
      hrefFor={(screen) => `/app/${screen}?${ownScope}`}
      storyHref={`/app/demo?${ownScope}`}
      busy={demo.busy}
      onContinueAs={(target, screen) => {
        void demo
          .switchPersona(target.key)
          .then(() => navigate(`/app/${screen}?${demoScopeQuery(config.organizationId, target)}`));
      }}
    />
  );
}
