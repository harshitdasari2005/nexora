/**
 * @nexora/app-web — Tasks page.
 *
 * Project work as it moves between a manager and the person doing it: to do,
 * in progress, in review, done. A manager sees the whole board and each
 * project's progress; everyone else sees the tasks given to them.
 *
 * Each task carries the caller's `actions` (computed on the server), so a
 * button only appears for the person whose turn it is — and the server
 * re-checks every click anyway.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Stack,
  Textarea,
  typography,
} from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { NavIcon } from '../components/NavIcon.js';
import { Page, PageHeader, Section, TurnTag } from '../components/Page.js';
import { ApiError } from '../lib/api.js';
import type { HiringScope } from '../lib/hiring.js';
import {
  createTask,
  listTasks,
  PRIORITY_LABEL,
  projectProgress,
  reassignTask,
  reviewTask,
  startTask,
  submitTask,
  TASK_STATUS_LABEL,
  TASK_STATUSES,
  taskHistoryVerb,
  type NewTask,
  type ProjectTask,
  type TaskBoard,
  type TaskPriority,
} from '../lib/tasks.js';
import { useShellScope } from '../lib/useShellScope.js';

const errorText = (caught: unknown): string =>
  caught instanceof ApiError ? caught.message : 'That did not work — try again.';

function day(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const EMPTY: TaskBoard = { tasks: [], canManage: false, assignees: [], projects: [] };

/** The tasks page. */
export function TasksPage(): JSX.Element {
  const { dashboard, loading, error, reload } = useShellScope();
  const organizationId = dashboard?.organization?.id;
  const workspaceId = dashboard?.workspace?.id;
  const [state, setState] = useState<{ board: TaskBoard; loaded: boolean; error: string | null }>({
    board: EMPTY,
    loaded: false,
    error: null,
  });

  const load = useCallback(() => {
    if (organizationId === undefined || workspaceId === undefined) return;
    listTasks({ organizationId, workspaceId }).then(
      (board) => setState({ board, loaded: true, error: null }),
      (caught: unknown) =>
        setState((current) => ({ ...current, loaded: true, error: errorText(caught) })),
    );
  }, [organizationId, workspaceId]);
  useEffect(load, [load]);

  if (loading && dashboard === null) return <LoadingScreen />;
  if (error !== null) return <ErrorState message={error.message} onRetry={reload} />;
  if (dashboard === null) return <LoadingScreen />;
  if (dashboard.organization === null || dashboard.workspace === null) {
    return <ErrorState message="Create an organization and a workspace first." />;
  }
  const scope = { organizationId: dashboard.organization.id, workspaceId: dashboard.workspace.id };

  return (
    <AppShell
      user={dashboard.user}
      organizationName={dashboard.organization.name}
      workspaceName={dashboard.workspace.name}
      organizationId={scope.organizationId}
      workspaceId={scope.workspaceId}
    >
      {state.error !== null ? (
        <ErrorState message={state.error} onRetry={load} />
      ) : !state.loaded ? (
        <Page wide>
          <PageHeader title="Tasks" />
          <Card padding={5}>
            <p style={{ color: 'var(--nexora-textSecondary)' }}>Reading the tasks…</p>
          </Card>
        </Page>
      ) : (
        <TasksView scope={scope} board={state.board} onChanged={load} />
      )}
    </AppShell>
  );
}

/** Props of {@link TasksView}. */
export interface TasksViewProps {
  scope: HiringScope;
  board: TaskBoard;
  /** Called after any change so the board is read back from the server. */
  onChanged: () => void;
}

/** The pure page content (exported for tests). */
export function TasksView({ scope, board, onChanged }: TasksViewProps): JSX.Element {
  const [creating, setCreating] = useState(false);
  const { tasks, canManage } = board;
  const progress = projectProgress(tasks);

  return (
    <Page wide>
      <PageHeader
        title="Tasks"
        lede={
          canManage
            ? 'Give work to the team, see where every task stands, and review what is handed in.'
            : 'The work given to you. Start a task, then hand it in for review.'
        }
        actions={
          canManage && !creating ? (
            <Button onClick={() => setCreating(true)}>New task</Button>
          ) : undefined
        }
      />

      {creating ? (
        <TaskForm
          board={board}
          onCancel={() => setCreating(false)}
          onSubmit={async (task) => {
            await createTask(scope, task);
            setCreating(false);
            onChanged();
          }}
        />
      ) : null}

      {tasks.length === 0 && !creating ? (
        <Card padding={10}>
          <EmptyState
            icon={<NavIcon name="tasks" size={18} />}
            title={canManage ? 'No tasks yet' : 'Nothing is assigned to you'}
            description={
              canManage
                ? 'Create a task on a project and give it to someone on the team.'
                : 'When your manager gives you a task, it shows up here.'
            }
          />
        </Card>
      ) : null}

      {canManage && progress.length > 0 ? (
        <Section title="Project progress">
          <div className="nexora-facts">
            {progress.map((project) => (
              <Card key={project.projectId} padding={4}>
                <div style={{ fontWeight: typography.weights.semibold }}>{project.name}</div>
                <div
                  className="nexora-meter"
                  role="img"
                  aria-label={`${project.done} of ${project.total} tasks done`}
                >
                  <span style={{ width: `${Math.round((project.done / project.total) * 100)}%` }} />
                </div>
                <div
                  style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}
                >
                  {project.done} of {project.total} tasks done
                </div>
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {tasks.length > 0 ? (
        <div className="nexora-board">
          {TASK_STATUSES.map((status) => {
            const column = tasks.filter((task) => task.status === status);
            return (
              <section
                key={status}
                className="nexora-board-column"
                aria-label={TASK_STATUS_LABEL[status]}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <h2 className="nexora-section-title">{TASK_STATUS_LABEL[status]}</h2>
                  <span style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}>
                    {column.length}
                  </span>
                </div>
                {column.length === 0 ? (
                  <div className="nexora-board-empty">Nothing here</div>
                ) : (
                  column.map((task) => (
                    <TaskCard
                      key={task.id}
                      scope={scope}
                      task={task}
                      assignees={board.assignees}
                      onChanged={onChanged}
                    />
                  ))
                )}
              </section>
            );
          })}
        </div>
      ) : null}
    </Page>
  );
}

/** One task: what it is, who has it, and what the caller may do next. */
export function TaskCard({
  scope,
  task,
  assignees,
  onChanged,
}: {
  scope: HiringScope;
  task: ProjectTask;
  assignees: TaskBoard['assignees'];
  onChanged: () => void;
}): JSX.Element {
  const [panel, setPanel] = useState<'submit' | 'send_back' | 'reassign' | 'history' | null>(null);
  const [note, setNote] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (label: string, work: () => Promise<unknown>): void => {
    setBusy(label);
    setError(null);
    work()
      .then(() => {
        setPanel(null);
        setNote('');
        onChanged();
      })
      .catch((caught: unknown) => setError(errorText(caught)))
      .finally(() => setBusy(null));
  };

  const { actions } = task;
  const myTurn = actions.canStart || actions.canSubmit || actions.canReview;
  const sentBack = [...task.history].reverse().find((entry) => entry.action === 'sent_back');
  const lastStep = task.history[task.history.length - 1];
  return (
    <Card padding={4} className={myTurn ? 'nexora-turn' : undefined}>
      <Stack gap={3} stretch>
        <Stack gap={1}>
          {myTurn ? (
            <div>
              <TurnTag>{actions.canReview ? 'Review it' : 'Your task'}</TurnTag>
            </div>
          ) : null}
          <h3
            style={{
              fontSize: typography.sizes.md,
              fontWeight: typography.weights.semibold,
              overflowWrap: 'anywhere',
            }}
          >
            {task.title}
          </h3>
          <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {task.projectName ?? 'Project'}
            {task.mine ? '' : `, with ${task.assigneeName ?? 'someone'}`}
          </div>
        </Stack>

        {task.description === undefined ? null : (
          <p style={{ fontSize: typography.sizes.sm, overflowWrap: 'anywhere' }}>
            {task.description}
          </p>
        )}

        <div className="nexora-actions" style={{ gap: 6 }}>
          {task.priority === 'normal' ? null : (
            <Badge tone={task.priority === 'high' ? 'danger' : 'neutral'}>
              {PRIORITY_LABEL[task.priority]} priority
            </Badge>
          )}
          {task.dueDate === undefined ? null : (
            <Badge tone="neutral">Due {day(task.dueDate)}</Badge>
          )}
        </div>

        {task.status === 'in_progress' &&
        sentBack?.comment !== undefined &&
        lastStep === sentBack ? (
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
            Sent back by {sentBack.actorName ?? 'the reviewer'}: “{sentBack.comment}”
          </p>
        ) : null}

        <div className="nexora-actions">
          {actions.canStart ? (
            <Button
              size="sm"
              loading={busy === 'start'}
              disabled={busy !== null}
              onClick={() => run('start', () => startTask(scope, task.id))}
            >
              Start
            </Button>
          ) : null}
          {actions.canSubmit && panel !== 'submit' ? (
            <Button size="sm" onClick={() => setPanel('submit')}>
              Hand in
            </Button>
          ) : null}
          {actions.canReview ? (
            <>
              <Button
                size="sm"
                loading={busy === 'accept'}
                disabled={busy !== null}
                onClick={() => run('accept', () => reviewTask(scope, task.id, 'accept', ''))}
              >
                Accept
              </Button>
              {panel === 'send_back' ? null : (
                <Button size="sm" variant="secondary" onClick={() => setPanel('send_back')}>
                  Send back
                </Button>
              )}
            </>
          ) : null}
          {actions.canReassign && assignees.length > 0 && panel !== 'reassign' ? (
            <Button size="sm" variant="ghost" onClick={() => setPanel('reassign')}>
              Reassign
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPanel(panel === 'history' ? null : 'history')}
          >
            {panel === 'history' ? 'Hide history' : 'History'}
          </Button>
        </div>

        {panel === 'submit' ? (
          <Stack gap={2} stretch>
            <Field label="Note for the reviewer" hint="Optional">
              <Textarea
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={1000}
              />
            </Field>
            <div className="nexora-actions">
              <Button
                size="sm"
                loading={busy === 'submit'}
                disabled={busy !== null}
                onClick={() => run('submit', () => submitTask(scope, task.id, note))}
              >
                Hand in for review
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </Stack>
        ) : null}

        {panel === 'send_back' ? (
          <Stack gap={2} stretch>
            <Field label="What should change" required>
              <Textarea
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={1000}
              />
            </Field>
            <div className="nexora-actions">
              <Button
                size="sm"
                variant="secondary"
                loading={busy === 'send_back'}
                disabled={busy !== null || note.trim().length < 3}
                onClick={() =>
                  run('send_back', () => reviewTask(scope, task.id, 'send_back', note))
                }
              >
                Send back
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </Stack>
        ) : null}

        {panel === 'reassign' ? (
          <Stack gap={2} stretch>
            <Field label="Give it to" required>
              <Select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                <option value="">Choose a person</option>
                {assignees
                  .filter((person) => person.userId !== task.assigneeId)
                  .map((person) => (
                    <option key={person.userId} value={person.userId}>
                      {person.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="nexora-actions">
              <Button
                size="sm"
                loading={busy === 'reassign'}
                disabled={busy !== null || assigneeId === ''}
                onClick={() => run('reassign', () => reassignTask(scope, task.id, assigneeId))}
              >
                Reassign
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </Stack>
        ) : null}

        {panel === 'history' ? (
          <Stack gap={1} stretch>
            {task.history.map((entry, index) => (
              <div key={`${entry.at}-${index}`} style={{ fontSize: typography.sizes.sm }}>
                <strong>{entry.actorName ?? 'Someone'}</strong> {taskHistoryVerb(entry.action)}
                {entry.comment === undefined ? '' : ` — “${entry.comment}”`}
              </div>
            ))}
          </Stack>
        ) : null}

        {error !== null ? (
          <p role="alert" style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
            {error}
          </p>
        ) : null}
      </Stack>
    </Card>
  );
}

function TaskForm({
  board,
  onSubmit,
  onCancel,
}: {
  board: TaskBoard;
  onSubmit: (task: NewTask) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [projectId, setProjectId] = useState(board.projects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (title.trim().length < 3) return setProblem('Say what needs doing.');
    if (projectId === '') return setProblem('Choose the project.');
    if (assigneeId === '') return setProblem('Choose who will do the work.');
    setProblem(null);
    setSubmitting(true);
    try {
      await onSubmit({
        projectId,
        title: title.trim(),
        ...(description.trim() === '' ? {} : { description: description.trim() }),
        priority,
        ...(dueDate === '' ? {} : { dueDate }),
        assigneeId,
      });
    } catch (caught) {
      setProblem(errorText(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card padding={5}>
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap={4} stretch>
          <h2 className="nexora-section-title">New task</h2>
          <Field label="What needs doing" required>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Build the login screen"
              maxLength={160}
            />
          </Field>
          <div className="nexora-fields">
            <Field label="Project" required>
              <Select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                {board.projects.length === 0 ? <option value="">No projects yet</option> : null}
                {board.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Give it to" required>
              <Select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                <option value="">Choose a person</option>
                {board.assignees.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" required>
              <Select
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </Select>
            </Field>
            <Field label="Due date" hint="Optional">
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Details" hint="Optional">
            <Textarea
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
            />
          </Field>
          {problem !== null ? (
            <p
              role="alert"
              style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}
            >
              {problem}
            </p>
          ) : null}
          <div className="nexora-actions">
            <Button type="submit" loading={submitting} disabled={submitting}>
              Create task
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </Stack>
      </form>
    </Card>
  );
}
