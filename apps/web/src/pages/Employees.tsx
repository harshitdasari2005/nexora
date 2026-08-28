/**
 * @nexora/app-web — Employees page.
 *
 * The HR application view (Employee/HR vertical slice; FRONTEND.md §7
 * application experience): lists the employees of the current organization
 * with loading, empty, and error states. The page talks to the same
 * application layer the AI uses (`GET /api/employees`) — one business
 * execution path for humans and agents. Employees are typically created by
 * the flagship workflow (“Hire Priya and assign her to Mobile Banking”) or
 * the AI hire capability, so this view is intentionally read-only: the
 * authoritative write path is the governed AI/approval surface.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Skeleton,
  Stack,
  typography,
} from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type { DashboardResponse, EmployeeDto } from '../lib/types.js';
import { useSession } from '../session.js';

/** The employees application page. */
export function Employees(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    employees: EmployeeDto[];
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, employees: [], loading: true, error: null });

  const load = useCallback(async () => {
    // Keeps any already-loaded dashboard visible while refetching — a role
    // switch re-runs this exact effect, and resetting to `null` would
    // unmount AppShell (sidebar included) on every switch.
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const params = new URLSearchParams();
      const organizationId = searchParams.get('organizationId');
      if (organizationId !== null) params.set('organizationId', organizationId);
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      const dashboard = await api<DashboardResponse>(`/dashboard${suffix}`);
      if (dashboard.organization === null) {
        setState({ dashboard, employees: [], loading: false, error: null });
        return;
      }
      const listed = await api<{ employees: EmployeeDto[] }>(
        `/employees?organizationId=${encodeURIComponent(dashboard.organization.id)}`,
      );
      setState({ dashboard, employees: listed.employees, loading: false, error: null });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error:
          error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
      }));
    }
  }, [searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.loading && state.dashboard === null) {
    return <LoadingScreen />;
  }
  if (state.error !== null) {
    return <ErrorState message={state.error.message} onRetry={() => void load()} />;
  }
  const { dashboard } = state;
  if (dashboard === null || session === null) {
    return <LoadingScreen />;
  }
  if (dashboard.organization === null) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <Card padding={10} elevationLevel="md" style={{ maxWidth: 520, width: '100%' }}>
          <EmptyState
            icon="🚀"
            title="Create your organization first"
            description="Employees live inside an organization. Set one up to get started."
            action={
              <Button size="lg" onClick={() => void load()}>
                Reload
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <AppShell
      user={dashboard.user}
      organizationName={dashboard.organization.name}
      workspaceName={dashboard.workspace?.name ?? 'No workspace yet'}
      organizationId={dashboard.organization.id}
      workspaceId={dashboard.workspace?.id}
    >
      <EmployeesView
        organizationName={dashboard.organization.name}
        initialEmployees={state.employees}
      />
    </AppShell>
  );
}

/** Props of {@link EmployeesView}. */
export interface EmployeesViewProps {
  /** The current organization name. */
  organizationName: string;
  /** The employees to render. */
  initialEmployees: readonly EmployeeDto[];
}

/** The pure employees content (exported for smoke tests). */
export function EmployeesView({
  organizationName,
  initialEmployees,
}: EmployeesViewProps): JSX.Element {
  const [employees] = useState<EmployeeDto[]>(() => [...initialEmployees]);

  return (
    <Stack gap={8} style={{ maxWidth: 880, margin: '0 auto' }}>
      <Stack direction="row" gap={4} align="center" justify="space-between">
        <Stack gap={1}>
          <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
            Employees
          </h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName}
          </p>
        </Stack>
        <Badge tone="primary" dot>
          {employees.length} {employees.length === 1 ? 'employee' : 'employees'}
        </Badge>
      </Stack>

      {/* Employee list */}
      <section>
        <h2
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.semibold,
            marginBottom: 12,
          }}
        >
          People in {organizationName}
        </h2>
        {employees.length === 0 ? (
          <Card>
            <EmptyState
              icon="⚕"
              title="No employees yet"
              description="Ask the AI: “Hire Priya and assign her to the Mobile Banking project.”"
            />
          </Card>
        ) : (
          <Stack gap={3}>
            {employees.map((employee) => (
              <EmployeeRow key={employee.id} employee={employee} />
            ))}
          </Stack>
        )}
      </section>
    </Stack>
  );
}

/** A single employee row with status display. */
export function EmployeeRow({ employee }: { employee: EmployeeDto }): JSX.Element {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <Stack
        direction="row"
        gap={3}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap={0.5} style={{ minWidth: 0 }}>
          <div style={{ fontWeight: typography.weights.semibold }}>{employee.name}</div>
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            Joined{' '}
            {new Date(employee.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>
        </Stack>
        <div style={{ flexShrink: 0 }}>
          <EmployeeStatusBadge status={employee.status} />
        </div>
      </Stack>
    </Card>
  );
}

/** Maps an employee lifecycle status to a tone (loading skeleton for unknown states). */
export function EmployeeStatusBadge({ status }: { status: string }): JSX.Element {
  if (status === 'proposed') {
    return <Badge>Proposed</Badge>;
  }
  if (status === 'hired') {
    return <Badge tone="primary">Hired</Badge>;
  }
  if (status === 'onboarding') {
    return <Badge tone="warning">Onboarding</Badge>;
  }
  if (status === 'active') {
    return (
      <Badge tone="success" dot>
        Active
      </Badge>
    );
  }
  if (status === 'on_leave') {
    return <Badge tone="warning">On leave</Badge>;
  }
  if (status === 'exiting') {
    return <Badge tone="warning">Exiting</Badge>;
  }
  if (status === 'offboarded') {
    return <Badge>Offboarded</Badge>;
  }
  if (status === 'cancelled') {
    return <Badge tone="danger">Cancelled</Badge>;
  }
  return <Skeleton height={18} width={70} />;
}
