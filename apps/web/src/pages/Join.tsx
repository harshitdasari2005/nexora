/**
 * @nexora/app-web — the page an invite link opens.
 *
 * A one-time link gives one seat in one team. The person has to be signed in
 * as themselves before they can take it, so a link opened while signed out is
 * remembered across sign-in and shown again afterwards. Nothing is joined
 * until the person presses the button, and the server decides what the link
 * is worth.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Stack } from '@nexora/design-system';

import { LoadingScreen } from '../components/LoadingScreen.js';
import { Fact, Page } from '../components/Page.js';
import { ApiError } from '../lib/api.js';
import {
  acceptInvite,
  forgetInvite,
  pendingInvite,
  previewInvite,
  rememberInvite,
  type InvitePreview,
} from '../lib/people.js';
import { useSession } from '../session.js';

/** What the join page is showing. */
export type JoinState =
  | { kind: 'missing' }
  | { kind: 'signed_out' }
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready'; preview: InvitePreview };

/** The join page. */
export function JoinPage(): JSX.Element {
  const session = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code') ?? pendingInvite();
  const signedOut =
    !session.loading &&
    ((session.error?.isUnauthorized ?? false) || (session.error === null && session.data === null));
  const signedIn = session.data !== null;
  const [state, setState] = useState<JoinState>({ kind: 'loading' });
  const [joining, setJoining] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (code === null || code === '') return setState({ kind: 'missing' });
    if (signedOut) return setState({ kind: 'signed_out' });
    if (!signedIn) return;
    let cancelled = false;
    previewInvite(code).then(
      (preview) => {
        if (cancelled) return;
        if (preview.alreadyInTeam) forgetInvite();
        setState({ kind: 'ready', preview });
      },
      (caught: unknown) => {
        if (cancelled) return;
        forgetInvite();
        setState({
          kind: 'invalid',
          message:
            caught instanceof ApiError
              ? caught.message
              : 'This invite could not be read. Try the link again.',
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, signedIn, signedOut]);

  if (session.loading || (state.kind === 'loading' && !signedOut)) return <LoadingScreen />;

  const join = (): void => {
    if (code === null) return;
    setJoining(true);
    setProblem(null);
    acceptInvite(code).then(
      async (joined) => {
        forgetInvite();
        await session.reload();
        navigate(
          `/app/desk?organizationId=${encodeURIComponent(joined.organizationId)}&workspaceId=${encodeURIComponent(joined.workspaceId)}`,
          { replace: true },
        );
      },
      (caught: unknown) => {
        setJoining(false);
        setProblem(caught instanceof ApiError ? caught.message : 'That did not work — try again.');
      },
    );
  };

  return (
    <JoinView
      state={state}
      joining={joining}
      problem={problem}
      onSignIn={() => {
        if (code !== null) rememberInvite(code);
        window.location.assign('/api/auth/login');
      }}
      onJoin={join}
      onDecline={() => {
        forgetInvite();
        navigate('/app', { replace: true });
      }}
    />
  );
}

/** Props of {@link JoinView}. */
export interface JoinViewProps {
  state: JoinState;
  joining: boolean;
  problem: string | null;
  onSignIn: () => void;
  onJoin: () => void;
  /** Leave the invitation for later (the link stays usable). */
  onDecline: () => void;
}

/** The pure page content (exported for tests). */
export function JoinView({
  state,
  joining,
  problem,
  onSignIn,
  onJoin,
  onDecline,
}: JoinViewProps): JSX.Element {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center' }}>
      <Page standalone>
        <Card padding={8}>
          <Stack gap={4} style={{ maxWidth: 560 }}>
            {state.kind === 'missing' ? (
              <>
                <h1 className="nexora-page-title">This invite link is incomplete</h1>
                <p className="nexora-page-lede">
                  Open the full link you were sent, or ask the person who invited you for a new one.
                </p>
                <Link to="/">Back to the start</Link>
              </>
            ) : null}
            {state.kind === 'signed_out' ? (
              <>
                <h1 className="nexora-page-title">You have been invited to a team</h1>
                <p className="nexora-page-lede">
                  Sign in, or create your account, to see the invitation. You join only when you say
                  so.
                </p>
                <div className="nexora-actions">
                  <Button onClick={onSignIn}>Sign in to continue</Button>
                </div>
              </>
            ) : null}
            {state.kind === 'invalid' ? (
              <>
                <h1 className="nexora-page-title">This invite cannot be used</h1>
                <p className="nexora-page-lede">{state.message}</p>
                <Link to="/app">Go to Nexora</Link>
              </>
            ) : null}
            {state.kind === 'ready' ? (
              <>
                <h1 className="nexora-page-title">
                  Join {state.preview.teamName} at {state.preview.organizationName}
                </h1>
                <div className="nexora-facts">
                  <Fact label="Your seat">{state.preview.seatLabel}</Fact>
                  <Fact label="You will work as">{state.preview.roleName}</Fact>
                </div>
                {state.preview.alreadyInTeam ? (
                  <>
                    <p className="nexora-page-lede">You are already in this team.</p>
                    <Link
                      to={`/app/desk?organizationId=${encodeURIComponent(state.preview.organizationId)}&workspaceId=${encodeURIComponent(state.preview.teamId)}`}
                    >
                      Go to my desk
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="nexora-page-lede">
                      Your seat decides which requests reach you and what you can approve. This link
                      works once.
                    </p>
                    {problem === null ? null : (
                      <div role="alert" style={{ color: 'var(--nexora-danger)' }}>
                        {problem}
                      </div>
                    )}
                    <div className="nexora-actions">
                      <Button onClick={onJoin} disabled={joining}>
                        {joining ? 'Joining…' : 'Join the team'}
                      </Button>
                      <Button variant="ghost" onClick={onDecline} disabled={joining}>
                        Not now
                      </Button>
                    </div>
                  </>
                )}
              </>
            ) : null}
          </Stack>
        </Card>
      </Page>
    </div>
  );
}
