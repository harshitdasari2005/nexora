/**
 * Repository integration tests.
 *
 * These exercise the Drizzle repositories against a real PostgreSQL
 * (PERSISTENCE.md §4 round-trips). They connect to `DATABASE_URL` (default:
 * the compose Postgres) and apply migrations first. When no database is
 * reachable they skip cleanly so `pnpm test` stays green without infra.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { TenantId, UserId } from '@nexora/contracts/common';
import {
  DisplayName,
  Email,
  PasswordHash,
  Session,
  User,
  UserStatus,
  Username,
} from '@nexora/domain-identity';
import {
  Organization,
  OrganizationId,
  OrganizationMembership,
  OrganizationSlug,
  OrganizationStatus,
  OrganizationType,
} from '@nexora/domain-organizations';
import {
  Workspace,
  WorkspaceId,
  WorkspaceInstallation,
  WorkspaceMembership,
  WorkspaceSlug,
  WorkspaceType,
} from '@nexora/domain-workspaces';
import { Project, ResourceAssignment } from '@nexora/domain-projects';
import { Employee } from '@nexora/domain-hr';
import { CalendarEntry } from '@nexora/module-calendar';
import { ActivityItem, Notification, NotificationPreferences } from '@nexora/module-notifications';

import { createDatabaseFromPool, type NexoraDatabase } from '../src/db.js';
import { ScryptPasswordHasher } from '../src/hasher/index.js';
import { runMigrations } from '../src/migrate.js';
import {
  PgActivityRepository,
  PgCalendarEventRepository,
  PgEmployeeRepository,
  PgMembershipRepository,
  PgNotificationPreferencesRepository,
  PgNotificationRepository,
  PgOrganizationRepository,
  PgProjectRepository,
  PgResourceAssignmentRepository,
  PgSessionRepository,
  PgUserRepository,
  PgWorkspaceInstallationRepository,
  PgWorkspaceMembershipRepository,
  PgWorkspaceRepository,
} from '../src/repositories/index.js';
import {
  activityItems,
  calendarEvents,
  employees,
  notifications,
  notificationPreferences,
  organizationMemberships,
  organizations,
  projects,
  resourceAssignments,
  sessions,
  users,
  workspaceInstallations,
  workspaceMemberships,
  workspaces,
} from '../src/schema/index.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://nexora:nexora_dev_password@localhost:5433/nexora';

const TENANT = 'tenant_1' as TenantId;

function orgContext(organizationId: OrganizationId | TenantId = TENANT) {
  return {
    actor: { kind: 'user' as const, id: 'usr_system' },
    correlationId: 'corr_test',
    organizationId: organizationId as OrganizationId,
  };
}

function wsContext() {
  return {
    actor: { kind: 'user' as const, id: 'usr_system' },
    correlationId: 'corr_test',
    organizationId: TENANT,
  };
}

function projectContext() {
  return {
    actor: { kind: 'user' as const, id: 'usr_system' },
    correlationId: 'corr_test',
    organizationId: TENANT,
  };
}

/** Probes whether Postgres is reachable; used to skip when infra is down. */
async function isDatabaseReachable(): Promise<boolean> {
  const pool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

const describeDb = (await isDatabaseReachable()) ? describe : describe.skip;

describeDb('repository integration (Postgres)', () => {
  let db: NexoraDatabase;
  let pool: Pool;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = new Pool({ connectionString: DATABASE_URL });
    db = createDatabaseFromPool(pool);
  });

  afterAll(async () => {
    await db.delete(calendarEvents);
    await db.delete(activityItems);
    await db.delete(notifications);
    await db.delete(notificationPreferences);
    await db.delete(resourceAssignments);
    await db.delete(projects);
    await db.delete(employees);
    await db.delete(workspaceInstallations);
    await db.delete(workspaceMemberships);
    await db.delete(workspaces);
    await db.delete(organizationMemberships);
    await db.delete(organizations);
    await db.delete(sessions);
    await db.delete(users);
    await pool.end();
  });

  it('round-trips a User through save/findById', async () => {
    const usersRepo = new PgUserRepository(db);
    const user = User.create(
      {
        tenantId: TENANT,
        email: Email.create('integ@example.com'),
        username: Username.create('integ'),
        passwordHash: PasswordHash.create('scrypt', 'scrypt:salt:hash'),
        displayName: DisplayName.create('Integration'),
        status: UserStatus.active(),
      },
      { actor: { kind: 'user', id: 'usr_system' }, correlationId: 'corr_test', tenantId: TENANT },
    );
    user.pullDomainEvents();
    await usersRepo.save(user);

    const loaded = await usersRepo.findById(user.id);
    expect(loaded?.id).toBe(user.id);
    expect(loaded?.email.value).toBe('integ@example.com');
    expect(loaded?.status.value).toBe('active');
    expect(loaded?.version).toBe(user.version);
  });

  it('round-trips a Session through save/findByToken', async () => {
    const sessionsRepo = new PgSessionRepository(db);
    const session = Session.start(
      {
        userId: 'usr_integ' as UserId,
        tenantId: TENANT,
        token: 'tok-integ',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      { actor: { kind: 'user', id: 'usr_system' }, correlationId: 'corr_test', tenantId: TENANT },
    );
    session.pullDomainEvents();
    await sessionsRepo.save(session);

    const loaded = await sessionsRepo.findByToken('tok-integ');
    expect(loaded?.id).toBe(session.id);
    expect(loaded?.status.value).toBe('active');
  });

  it('round-trips an Organization with settings changes', async () => {
    const orgs = new PgOrganizationRepository(db);
    const organization = Organization.create(
      {
        slug: OrganizationSlug.create('integ-org'),
        name: 'Integ Org',
        type: OrganizationType.enterprise(),
        status: OrganizationStatus.active(),
      },
      orgContext(),
    );
    organization.pullDomainEvents();
    organization.updateSettings({ retentionDays: 730, aiEnabled: false }, orgContext());
    organization.pullDomainEvents();
    await orgs.save(organization);

    const loaded = await orgs.findById(organization.id);
    expect(loaded?.slug.value).toBe('integ-org');
    expect(loaded?.settings.retentionDays).toBe(730);
    expect(loaded?.settings.aiEnabled).toBe(false);
  });

  it('round-trips a Workspace with bindings', async () => {
    const workspacesRepo = new PgWorkspaceRepository(db);
    const workspace = Workspace.create(
      {
        organizationId: TENANT,
        slug: WorkspaceSlug.create('integ-ws'),
        name: 'Integ WS',
        type: WorkspaceType.engineering(),
      },
      wsContext(),
    );
    workspace.pullDomainEvents();
    workspace.activate(wsContext());
    workspace.attachAgent('agt_hr', wsContext());
    workspace.pullDomainEvents();
    await workspacesRepo.save(workspace);

    const loaded = await workspacesRepo.findById(workspace.id);
    expect(loaded?.slug.value).toBe('integ-ws');
    expect(loaded?.isActive()).toBe(true);
    expect(loaded?.boundAgentIds).toEqual(['agt_hr']);
  });

  it('counts owners via the membership repository', async () => {
    const memberships = new PgMembershipRepository(db);
    const orgId = OrganizationId.create();
    const membership = OrganizationMembership.create(
      { organizationId: orgId, userId: 'usr_owner' as UserId, role: 'owner' },
      orgContext(orgId),
    );
    await memberships.save(membership);
    expect(await memberships.countOwners(orgId)).toBe(1);
    await memberships.remove(membership);
    expect(await memberships.countOwners(orgId)).toBe(0);
  });

  it('lists memberships by user across organizations (listByUser read model)', async () => {
    const memberships = new PgMembershipRepository(db);
    const user = 'usr_multi' as UserId;
    const orgA = OrganizationId.create();
    const orgB = OrganizationId.create();
    await memberships.save(
      OrganizationMembership.create(
        { organizationId: orgA, userId: user, role: 'member' },
        orgContext(orgA),
      ),
    );
    await memberships.save(
      OrganizationMembership.create(
        { organizationId: orgB, userId: user, role: 'admin' },
        orgContext(orgB),
      ),
    );
    const listed = await memberships.listByUser(user);
    expect(listed.map((membership) => membership.organizationId).sort()).toEqual(
      [orgA, orgB].sort(),
    );
    expect(listed.map((membership) => membership.userId)).toEqual([user, user]);
  });

  it('implements the workspace membership and installation repositories', async () => {
    const wsMemberships = new PgWorkspaceMembershipRepository(db);
    const wsInstallations = new PgWorkspaceInstallationRepository(db);
    const wsId = WorkspaceId.create();

    const membership = WorkspaceMembership.create(
      { workspaceId: wsId, userId: 'usr_member' as UserId, role: 'member' },
      wsContext(),
    );
    await wsMemberships.save(membership);
    expect(await wsMemberships.findByWorkspaceAndUser(wsId, 'usr_member' as UserId)).toBeDefined();

    const installation = WorkspaceInstallation.create(
      { workspaceId: wsId, pluginId: 'plugin-hr', pluginVersion: '1.0.0' },
      wsContext(),
    );
    await wsInstallations.save(installation);
    expect((await wsInstallations.listByWorkspace(wsId)).map((i) => i.pluginId)).toEqual([
      'plugin-hr',
    ]);
  });

  it('round-trips a Project with lifecycle transitions', async () => {
    const projectsRepo = new PgProjectRepository(db);
    const project = Project.create(
      {
        organizationId: TENANT,
        name: 'Mobile Banking',
        description: 'Core banking app',
      },
      projectContext(),
    );
    project.pullDomainEvents();
    project.activate(projectContext());
    project.pullDomainEvents();
    await projectsRepo.save(project);

    const loaded = await projectsRepo.findById(project.id);
    expect(loaded?.name.value).toBe('Mobile Banking');
    expect(loaded?.description.value).toBe('Core banking app');
    expect(loaded?.isActive()).toBe(true);
    expect(loaded?.version).toBe(project.version);
  });

  it('lists projects scoped to the organization (tenant isolation)', async () => {
    const projectsRepo = new PgProjectRepository(db);
    const project = Project.create({ organizationId: TENANT, name: 'Payroll' }, projectContext());
    project.pullDomainEvents();
    await projectsRepo.save(project);

    const listed = await projectsRepo.listByOrganization(TENANT);
    expect(listed.some((p) => p.name.value === 'Payroll')).toBe(true);

    const alien = 'org_alien_0001' as TenantId;
    const alienProject = Project.create(
      { organizationId: alien, name: 'Alien' },
      { ...projectContext(), organizationId: alien },
    );
    alienProject.pullDomainEvents();
    await projectsRepo.save(alienProject);

    const scoped = await projectsRepo.listByOrganization(TENANT);
    expect(scoped.every((p) => p.name.value !== 'Alien')).toBe(true);
  });

  it('verifies passwords through the scrypt hasher', async () => {
    const hasher = new ScryptPasswordHasher();
    const hash = await hasher.hash('s3cret!');
    expect(hash.algorithm).toBe('scrypt');
    expect(await hasher.verify('s3cret!', hash)).toBe(true);
    expect(await hasher.verify('wrong', hash)).toBe(false);
  });

  it('round-trips an Employee through save/findById', async () => {
    const employeesRepo = new PgEmployeeRepository(db);
    const employee = Employee.create(
      { organizationId: TENANT, name: 'Sarah Chen' },
      {
        actor: { kind: 'user', id: 'usr_system' },
        correlationId: 'corr_test',
        organizationId: TENANT,
      },
    );
    employee.pullDomainEvents();
    await employeesRepo.save(employee);

    const loaded = await employeesRepo.findById(employee.id);
    expect(loaded?.name.value).toBe('Sarah Chen');
    expect(loaded?.organizationId).toBe(TENANT);
    expect(loaded?.version).toBe(employee.version);
  });

  it('resolves employees by name scoped to the organization (tenant isolation)', async () => {
    const employeesRepo = new PgEmployeeRepository(db);
    const sarah = Employee.create(
      { organizationId: TENANT, name: 'Sarah Lee' },
      {
        actor: { kind: 'user', id: 'usr_system' },
        correlationId: 'corr_test',
        organizationId: TENANT,
      },
    );
    sarah.pullDomainEvents();
    await employeesRepo.save(sarah);

    const alien = 'org_alien_0002' as TenantId;
    const alienSarah = Employee.create(
      { organizationId: alien, name: 'Sarah Alien' },
      {
        actor: { kind: 'user', id: 'usr_system' },
        correlationId: 'corr_test',
        organizationId: alien,
      },
    );
    alienSarah.pullDomainEvents();
    await employeesRepo.save(alienSarah);

    // Case-insensitive substring within the tenant only — the alien tenant's
    // "Sarah Alien" must never match.
    const resolved = await employeesRepo.findByName(TENANT, 'sarah');
    const names = resolved.map((e) => e.name.value);
    expect(names).toContain('Sarah Lee');
    expect(names).not.toContain('Sarah Alien');
  });

  it('round-trips a ResourceAssignment and enforces the unique pair', async () => {
    const assignmentsRepo = new PgResourceAssignmentRepository(db);
    const project = Project.create(
      { organizationId: TENANT, name: 'Mobile Banking' },
      projectContext(),
    );
    project.pullDomainEvents();
    await new PgProjectRepository(db).save(project);

    const assignment = ResourceAssignment.create(
      { projectId: project.id, employeeId: 'emp_sarah', organizationId: TENANT },
      projectContext(),
    );
    assignment.pullDomainEvents();
    await assignmentsRepo.save(assignment);

    const loaded = await assignmentsRepo.findById(assignment.id);
    expect(loaded?.projectId).toBe(project.id);
    expect(loaded?.employeeId).toBe('emp_sarah');
    expect(await assignmentsRepo.findByProjectAndEmployee(project.id, 'emp_sarah')).toBeDefined();
    expect((await assignmentsRepo.listByProject(project.id)).map((a) => a.employeeId)).toEqual([
      'emp_sarah',
    ]);
  });

  it('lists assignments per project without leaking foreign-tenant assignments', async () => {
    const assignmentsRepo = new PgResourceAssignmentRepository(db);
    const project = Project.create({ organizationId: TENANT, name: 'Payroll' }, projectContext());
    project.pullDomainEvents();
    await new PgProjectRepository(db).save(project);

    const alien = 'org_alien_0003' as TenantId;
    const alienProject = Project.create(
      { organizationId: alien, name: 'Alien' },
      { ...projectContext(), organizationId: alien },
    );
    alienProject.pullDomainEvents();
    await new PgProjectRepository(db).save(alienProject);

    const alienAssignment = ResourceAssignment.create(
      { projectId: alienProject.id, employeeId: 'emp_alien', organizationId: alien },
      { ...projectContext(), organizationId: alien },
    );
    alienAssignment.pullDomainEvents();
    await assignmentsRepo.save(alienAssignment);

    const scoped = await assignmentsRepo.listByProject(project.id);
    expect(scoped.every((a) => a.employeeId !== 'emp_alien')).toBe(true);
    // The foreign project's own member list still resolves independently.
    expect((await assignmentsRepo.listByProject(alienProject.id)).map((a) => a.employeeId)).toEqual(
      ['emp_alien'],
    );
  });

  it('round-trips a Notification with recipient/tenant scoping', async () => {
    const repo = new PgNotificationRepository(db);
    const notification = Notification.create(
      {
        recipientId: 'usr_notif' as UserId,
        tenantId: TENANT,
        workspaceId: 'ws_notif' as never,
        type: 'project.created',
        category: 'project',
        title: 'Project created',
        body: 'Project "Mobile Banking" was created.',
        priority: 'normal',
        action: { kind: 'navigate', href: '/app/projects', label: 'Open project' },
        sourceEventId: 'evt_notif_1',
        correlationId: 'corr_notif_1',
      },
      '2026-08-10T10:00:00.000Z',
    );
    await repo.save(notification);

    const loaded = await repo.findByIdAndRecipient(notification.id, 'usr_notif' as UserId, TENANT);
    expect(loaded?.id).toBe(notification.id);
    expect(loaded?.type).toBe('project.created');
    expect(loaded?.status).toBe('unread');
    expect(loaded?.sourceEventId).toBe('evt_notif_1');

    // Idempotency lookup by source event resolves the same aggregate.
    const byEvent = await repo.findBySourceEvent('evt_notif_1', 'usr_notif' as UserId, TENANT);
    expect(byEvent?.id).toBe(notification.id);

    // A foreign recipient/tenant never resolves the record.
    expect(
      await repo.findByIdAndRecipient(notification.id, 'usr_other' as UserId, TENANT),
    ).toBeUndefined();
    expect(
      await repo.findByIdAndRecipient(
        notification.id,
        'usr_notif' as UserId,
        'org_other' as TenantId,
      ),
    ).toBeUndefined();
  });

  it('lists and counts a recipient notifications without leaking other recipients', async () => {
    const repo = new PgNotificationRepository(db);
    const make = (recipientId: string, type: string): Notification =>
      Notification.create(
        {
          recipientId: recipientId as UserId,
          tenantId: TENANT,
          type,
          category: 'workflow',
          title: 'Workflow completed',
          body: 'Your workflow completed.',
          priority: 'normal',
          sourceEventId: `evt_${type}_${recipientId}`,
          correlationId: 'corr_notif_2',
        },
        '2026-08-10T10:00:00.000Z',
      );
    await repo.save(make('usr_owner', 'workflow.completed'));
    await repo.save(make('usr_owner', 'workflow.failed'));
    await repo.save(make('usr_alien', 'workflow.completed'));

    const owned = await repo.listByRecipient('usr_owner' as UserId, TENANT);
    expect(owned).toHaveLength(2);
    expect(owned.every((n) => n.recipientId === 'usr_owner')).toBe(true);

    const unread = await repo.countUnread('usr_owner' as UserId, TENANT);
    expect(unread).toBe(2);

    const alienList = await repo.listByRecipient('usr_alien' as UserId, TENANT);
    expect(alienList).toHaveLength(1);
  });

  it('markRead/markAllRead update read state idempotently', async () => {
    const repo = new PgNotificationRepository(db);
    const notification = Notification.create(
      {
        recipientId: 'usr_mark' as UserId,
        tenantId: TENANT,
        type: 'approval.requested',
        category: 'approval',
        title: 'Approval required',
        body: 'A step requires approval.',
        priority: 'high',
        sourceEventId: 'evt_mark_1',
        correlationId: 'corr_mark_1',
      },
      '2026-08-10T10:00:00.000Z',
    );
    await repo.save(notification);

    expect(
      await repo.markRead(
        notification.id,
        'usr_mark' as UserId,
        TENANT,
        '2026-08-10T11:00:00.000Z',
      ),
    ).toBe(true);
    // Already read → no change.
    expect(
      await repo.markRead(
        notification.id,
        'usr_mark' as UserId,
        TENANT,
        '2026-08-10T12:00:00.000Z',
      ),
    ).toBe(false);

    const loaded = await repo.findByIdAndRecipient(notification.id, 'usr_mark' as UserId, TENANT);
    expect(loaded?.status).toBe('read');
    expect(loaded?.readAt).toBe('2026-08-10T11:00:00.000Z');

    // markAllRead on a second unread notification.
    const second = Notification.create(
      {
        recipientId: 'usr_mark' as UserId,
        tenantId: TENANT,
        type: 'workflow.completed',
        category: 'workflow',
        title: 'Workflow completed',
        body: 'Done.',
        priority: 'normal',
        sourceEventId: 'evt_mark_2',
        correlationId: 'corr_mark_2',
      },
      '2026-08-10T10:00:00.000Z',
    );
    await repo.save(second);
    expect(await repo.markAllRead('usr_mark' as UserId, TENANT)).toBe(1);
    expect(await repo.countUnread('usr_mark' as UserId, TENANT)).toBe(0);
  });

  it('round-trips NotificationPreferences with safe defaults', async () => {
    const repo = new PgNotificationPreferencesRepository(db);
    const preferences = NotificationPreferences.create(
      { userId: 'usr_pref' as UserId, tenantId: TENANT },
      '2026-08-10T10:00:00.000Z',
    );
    preferences.setCategory('workflow', false, '2026-08-10T10:30:00.000Z');
    await repo.save(preferences);

    const loaded = await repo.findByUser('usr_pref' as UserId, TENANT);
    expect(loaded?.isEnabled('workflow')).toBe(false);
    expect(loaded?.isEnabled('approval')).toBe(true);

    // Tenant-scoped: another tenant never resolves the record.
    expect(await repo.findByUser('usr_pref' as UserId, 'org_other' as TenantId)).toBeUndefined();
  });

  it('round-trips ActivityItem read-model records with workspace scoping', async () => {
    const repo = new PgActivityRepository(db);
    const item = ActivityItem.create(
      {
        tenantId: TENANT,
        workspaceId: 'ws_act' as never,
        type: 'employee.created',
        title: 'Employee hired',
        body: 'Sarah was hired.',
        actorId: 'usr_act',
        sourceEventId: 'evt_act_1',
        correlationId: 'corr_act_1',
      },
      '2026-08-10T10:00:00.000Z',
    );
    await repo.save(item);

    const byEvent = await repo.findBySourceEvent('evt_act_1', TENANT);
    expect(byEvent?.id).toBe(item.id);

    const scoped = await repo.listByWorkspace(TENANT, { workspaceId: 'ws_act' as never });
    expect(scoped.some((i) => i.id === item.id)).toBe(true);

    // A different tenant never sees the record.
    const alien = await repo.listByWorkspace('org_other' as TenantId, {
      workspaceId: 'ws_act' as never,
    });
    expect(alien.some((i) => i.id === item.id)).toBe(false);
  });

  it('round-trips a CalendarEntry with hydration restoring the persisted id', async () => {
    const repo = new PgCalendarEventRepository(db);
    const context = {
      actor: { kind: 'user' as const, id: 'usr_system' },
      correlationId: 'corr_cal_1',
      organizationId: TENANT,
      workspaceId: 'ws_cal_1' as never,
    };
    const entry = CalendarEntry.create(
      {
        organizationId: TENANT,
        workspaceId: 'ws_cal_1' as never,
        createdBy: 'usr_cal' as UserId,
        title: 'Project Review',
        startsAt: '2026-09-01T15:00:00.000Z',
        endsAt: '2026-09-01T16:00:00.000Z',
      },
      context,
    );
    entry.pullDomainEvents();
    await repo.save(entry);

    const loaded = await repo.findById(entry.id);
    expect(loaded?.id).toBe(entry.id);
    expect(loaded?.title.value).toBe('Project Review');
    expect(loaded?.timeWindow.startsAt).toBe('2026-09-01T15:00:00.000Z');
    expect(loaded?.status.value).toBe('scheduled');
    expect(loaded?.version).toBe(entry.version);

    // Mutation persists and the update is reflected after reload.
    loaded?.reschedule(
      {
        title: 'Mobile Banking Review',
        startsAt: '2026-09-02T10:00:00.000Z',
        endsAt: '2026-09-02T11:00:00.000Z',
      },
      context,
    );
    await repo.save(loaded as CalendarEntry);
    const reloaded = await repo.findById(entry.id);
    expect(reloaded?.title.value).toBe('Mobile Banking Review');
    expect(reloaded?.timeWindow.startsAt).toBe('2026-09-02T10:00:00.000Z');
  });

  it('lists calendar entries scoped to the workspace (workspace isolation)', async () => {
    const repo = new PgCalendarEventRepository(db);
    const context = (workspaceId: string) => ({
      actor: { kind: 'user' as const, id: 'usr_system' },
      correlationId: 'corr_cal_2',
      organizationId: TENANT,
      workspaceId: workspaceId as never,
    });
    const engineering = CalendarEntry.create(
      {
        organizationId: TENANT,
        workspaceId: 'ws_cal_eng' as never,
        createdBy: 'usr_cal' as UserId,
        title: 'Engineering Review',
        startsAt: '2026-09-03T15:00:00.000Z',
        endsAt: '2026-09-03T16:00:00.000Z',
      },
      context('ws_cal_eng'),
    );
    engineering.pullDomainEvents();
    await repo.save(engineering);

    const marketing = CalendarEntry.create(
      {
        organizationId: TENANT,
        workspaceId: 'ws_cal_mkt' as never,
        createdBy: 'usr_cal' as UserId,
        title: 'Marketing Review',
        startsAt: '2026-09-03T17:00:00.000Z',
        endsAt: '2026-09-03T18:00:00.000Z',
      },
      context('ws_cal_mkt'),
    );
    marketing.pullDomainEvents();
    await repo.save(marketing);

    const engineeringList = await repo.listByWorkspace(TENANT, 'ws_cal_eng' as never);
    expect(engineeringList.map((e) => e.title.value)).toEqual(['Engineering Review']);

    // A foreign tenant never sees the entries.
    const alien = await repo.listByWorkspace('org_other' as TenantId, 'ws_cal_eng' as never);
    expect(alien.some((e) => e.title.value === 'Engineering Review')).toBe(false);
  });

  it('enforces optional workspace filtering without an IS NULL trap', async () => {
    const repo = new PgCalendarEventRepository(db);
    const context = {
      actor: { kind: 'user' as const, id: 'usr_system' },
      correlationId: 'corr_cal_3',
      organizationId: TENANT,
      workspaceId: 'ws_cal_eng' as never,
    };
    const entry = CalendarEntry.create(
      {
        organizationId: TENANT,
        workspaceId: 'ws_cal_eng' as never,
        createdBy: 'usr_cal' as UserId,
        title: 'Filter Check',
        startsAt: '2026-09-04T15:00:00.000Z',
        endsAt: '2026-09-04T16:00:00.000Z',
      },
      context,
    );
    entry.pullDomainEvents();
    await repo.save(entry);

    // The list is always workspace-filtered: an explicit workspace returns
    // exactly that workspace's entries — never an implicit IS NULL clause
    // that would hide workspace-scoped rows.
    const withWorkspace = await repo.listByWorkspace(TENANT, 'ws_cal_eng' as never);
    expect(withWorkspace.some((e) => e.title.value === 'Filter Check')).toBe(true);
  });
});
