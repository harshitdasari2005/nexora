/**
 * @nexora/app-web — "Tell the office what you need".
 *
 * One sentence in plain words. The assistant reads which workflow it starts
 * and fills the form in; the person checks it and sends it. Nothing is raised
 * by asking, and whoever decides the request is still a person.
 */

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Input, Stack, typography } from '@nexora/design-system';

import { ApiError } from '../lib/api.js';
import type { HiringScope } from '../lib/hiring.js';
import {
  suggestRequest,
  type RequestSuggestion,
  type Workflow,
  type WorkflowCatalog,
} from '../lib/requests.js';
import { RequestForm } from '../pages/Requests.js';
import { NavIcon } from './NavIcon.js';

/** Where the ask stands. */
export type AskState =
  | { kind: 'idle' }
  | { kind: 'thinking' }
  | { kind: 'suggested'; sentence: string; suggestion: RequestSuggestion; workflow: Workflow }
  | { kind: 'no_match'; sentence: string }
  | { kind: 'sent'; workflow: Workflow }
  | { kind: 'failed'; message: string };

/** Finds a workflow of the catalog by its key. */
export function workflowOf(catalog: WorkflowCatalog, key: string): Workflow | undefined {
  for (const department of catalog.departments) {
    const found = department.workflows.find((workflow) => workflow.key === key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Things people say, to show what the box is for. */
export const ASK_EXAMPLES = [
  'I need next Monday to Wednesday off for a wedding',
  'Please buy two Android test phones for the device lab, about ₹45,000 each',
  'The login screen crashes when the OTP is pasted',
] as const;

/** Props of {@link AskOffice}. */
export interface AskOfficeProps {
  scope: HiringScope;
  catalog: WorkflowCatalog;
  /** Called after a request was sent, so the page re-reads what is in motion. */
  onSent?: () => void;
  /** The starting state (tests). */
  initialState?: AskState;
}

/** The ask box and what the assistant makes of the sentence. */
export function AskOffice({
  scope,
  catalog,
  onSent,
  initialState = { kind: 'idle' },
}: AskOfficeProps): JSX.Element {
  const [sentence, setSentence] = useState('');
  const [state, setState] = useState<AskState>(initialState);
  const query = `organizationId=${encodeURIComponent(scope.organizationId)}&workspaceId=${encodeURIComponent(scope.workspaceId)}`;

  const ask = (text: string): void => {
    const asked = text.trim();
    if (asked.length < 5) return;
    setState({ kind: 'thinking' });
    suggestRequest(scope, asked).then(
      (suggestion) => {
        const workflow = suggestion === null ? undefined : workflowOf(catalog, suggestion.type);
        setState(
          suggestion === null || workflow === undefined
            ? { kind: 'no_match', sentence: asked }
            : { kind: 'suggested', sentence: asked, suggestion, workflow },
        );
      },
      (caught: unknown) =>
        setState({
          kind: 'failed',
          message: caught instanceof ApiError ? caught.message : 'That did not work — try again.',
        }),
    );
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    ask(sentence);
  };

  if (state.kind === 'suggested') {
    return (
      <Stack gap={3} stretch>
        <p className="nexora-assistant-note">
          <NavIcon name="sparkles" size={14} />
          <span>
            You wrote “{state.sentence}”. That starts a <strong>{state.workflow.name}</strong>{' '}
            request. Check what was filled in, then send it.
          </span>
        </p>
        <RequestForm
          scope={scope}
          workflow={state.workflow}
          assistant={catalog.assistant}
          initial={{ sentence: state.sentence, draft: state.suggestion.draft }}
          onCancel={() => setState({ kind: 'idle' })}
          onSent={() => {
            setSentence('');
            setState({ kind: 'sent', workflow: state.workflow });
            onSent?.();
          }}
        />
      </Stack>
    );
  }

  return (
    <Card padding={5}>
      <form onSubmit={submit}>
        <Stack gap={3} stretch>
          <div>
            <h2 className="nexora-section-title">Tell the office what you need</h2>
            <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              Write it the way you would say it. The assistant picks the right workflow and fills it
              in; you check it and send it, and people decide.
            </p>
          </div>
          <div className="nexora-ask-row">
            <Input
              value={sentence}
              onChange={(event) => setSentence(event.target.value)}
              placeholder={ASK_EXAMPLES[0]}
              aria-label="What you need"
              maxLength={1000}
            />
            <Button
              type="submit"
              loading={state.kind === 'thinking'}
              disabled={state.kind === 'thinking' || sentence.trim().length < 5}
            >
              Prepare it
            </Button>
          </div>
          {state.kind === 'idle' || state.kind === 'thinking' ? (
            <div className="nexora-ask-examples">
              {ASK_EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={state.kind === 'thinking'}
                  onClick={() => {
                    setSentence(example);
                    ask(example);
                  }}
                >
                  {example}
                </button>
              ))}
            </div>
          ) : null}
          {state.kind === 'no_match' ? (
            <p role="status" style={{ fontSize: typography.sizes.sm }}>
              That does not start any of the office workflows.{' '}
              <Link to={`/app/requests?${query}`}>Pick a workflow yourself</Link>, or{' '}
              <Link to={`/app/assistant?${query}`}>ask the assistant a question</Link>.
            </p>
          ) : null}
          {state.kind === 'sent' ? (
            <p role="status" style={{ fontSize: typography.sizes.sm }}>
              Sent. Your {state.workflow.name.toLowerCase()} request is now with:{' '}
              <strong>{state.workflow.stages[0]?.label ?? 'the next person'}</strong>.{' '}
              <Link to={`/app/requests?${query}`}>Follow it in Office workflows</Link>.
            </p>
          ) : null}
          {state.kind === 'failed' ? (
            <p
              role="alert"
              style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}
            >
              {state.message}
            </p>
          ) : null}
        </Stack>
      </form>
    </Card>
  );
}
