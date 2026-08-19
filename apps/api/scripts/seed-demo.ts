/**
 * @nexora/app-api — deterministic local demo seed/reset.
 *
 * Provisions (or resets) the SMALLEST possible data set needed to walk the
 * hero flow reliably in local development:
 *
 *   CEO login -> problem exists -> evidence exists -> known solution exists
 *   -> remediation plan can be created -> approval appears -> approval
 *   succeeds -> action executes -> verification succeeds -> RESOLVED
 *
 * Everything is created through the EXISTING application-layer handlers
 * (the same ones the REST routes use) — never raw SQL for writes, so every
 * domain invariant is respected exactly as it would be for a real user.
 * The only direct table access is the RESET step: clearing the demo
 * workspace's own `business_problems` / `remediation_plans` /
 * `remediation_plan_steps` rows and the demo notification, so re-running
 * this script always starts the hero flow from a clean, reproducible state
 * — no domain "delete" operation exists for these (nor should one), so a
 * scoped delete in this throwaway demo script is the right boundary.
 *
 * Usage:
 *   pnpm demo:reset
 *
 * Precondition: the demo user must have logged in at least once (OIDC
 * JIT-provisions the `users` row on first login) — run `pnpm dev:local`,
 * open http://localhost:5173, and sign in as alex@nexora.dev / nexora123
 * (seeded in infrastructure/keycloak/realm-nexora.json) before the first
 * `pnpm demo:reset`.
 *
 * Scope: this script ONLY ever touches rows scoped to its own dedicated
 * demo organization (slug `nexora-demo`) — it never reads or deletes any
 * other organization's data.
 */

import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { and, eq, inArray } from 'drizzle-orm';
import {
  businessProblems,
  createDatabase,
  notifications as notificationsTable,
  PgNotificationRepository,
  PgUserRepository,
  remediationPlans,
  remediationPlanSteps,
  type NexoraDatabase,
} from '@nexora/persistence';
import { Email } from '@nexora/domain-identity';
import { Notification } from '@nexora/module-notifications';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import { buildContainer } from '../src/container.js';
import { buildPgRepositories } from '../src/app.js';
import { buildApplicationEventPublisher } from '../src/events/application-publisher.js';
import type { ApiConfig } from '../src/config.js';

/** The demo user's email — override with DEMO_USER_EMAIL if needed. */
const DEMO_USER_EMAIL = process.env['DEMO_USER_EMAIL']?.trim() || 'alex@nexora.dev';

/** Fixed, deterministic demo identifiers (never touches any other org/workspace). */
const DEMO_ORG_SLUG = 'nexora-demo';
const DEMO_ORG_NAME = 'Nexora Demo';
const DEMO_WORKSPACE_SLUG = 'demo';
const DEMO_WORKSPACE_NAME = 'Demo';
const DEMO_PROJECT_NAME = 'Mobile Banking Demo';
const DEMO_ARTICLE_TITLE = 'Project attention playbook';
const DEMO_ARTICLE_BODY =
  'When active projects need attention: review the project attention queue, ' +
  'check what needs attention, and clear the notification backlog. This is ' +
  'the standard project attention remediation.';
const DEMO_NOTIFICATION_SOURCE_EVENT = 'demo-seed:project-attention';

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error(
      'DATABASE_URL is not set. Run this from a checkout with the repo-root .env configured ' +
        '(see .env.example) and PostgreSQL running (`pnpm dev:local` or `pnpm dev:infra`).',
    );
  }

  const db: NexoraDatabase = createDatabase(databaseUrl);
  const config = { s3: undefined } as unknown as ApiConfig;
  const repositories = buildPgRepositories(db, config);
  const { publisher } = buildApplicationEventPublisher({ repositories });
  const container = buildContainer({ config, repositories, publisher });

  // --- 0. the demo user must already exist (JIT-provisioned on first login) ---
  const user = await new PgUserRepository(db).findByEmail(Email.create(DEMO_USER_EMAIL));
  if (user === undefined) {
    throw new Error(
      `No user found for ${DEMO_USER_EMAIL}. Log in once via the browser ` +
        `(http://localhost:5173, sign in as ${DEMO_USER_EMAIL} / nexora123) to provision the ` +
        'account, then re-run `pnpm demo:reset`.',
    );
  }
  const userId = user.id as UserId;
  log(`Demo user: ${DEMO_USER_EMAIL} (${userId})`);

  // --- 1. organization (idempotent: reuse if it already exists) -------------
  const existingOrgs = await container.listOrganizations.handle({ userId });
  if (!existingOrgs.ok) {
    throw new Error('Could not list organizations for the demo user.');
  }
  let organizationId = existingOrgs.value.find((org) => org.slug === DEMO_ORG_SLUG)?.id;
  if (organizationId === undefined) {
    const created = await container.createOrganization.handle({
      name: DEMO_ORG_NAME,
      slug: DEMO_ORG_SLUG,
      type: 'startup',
      actorId: userId,
      correlationId: 'demo-seed:create-organization',
    });
    if (!created.ok) {
      throw new Error(`Could not create the demo organization: ${created.error.message}`);
    }
    organizationId = created.value.organization.id;
    log(`Created organization ${DEMO_ORG_NAME} (${organizationId})`);
  } else {
    log(`Reusing organization ${DEMO_ORG_NAME} (${organizationId})`);
  }
  const tenantId = organizationId as TenantId;

  // --- 2. workspace (idempotent) ---------------------------------------------
  const existingWorkspaces = await container.listMyWorkspaces.handle({
    userId,
    organizationId: tenantId,
  });
  if (!existingWorkspaces.ok) {
    throw new Error('Could not list workspaces for the demo user.');
  }
  let workspaceId = existingWorkspaces.value.find((ws) => ws.slug === DEMO_WORKSPACE_SLUG)?.id;
  if (workspaceId === undefined) {
    const created = await container.createWorkspace.handle({
      organizationId: tenantId,
      slug: DEMO_WORKSPACE_SLUG,
      name: DEMO_WORKSPACE_NAME,
      type: 'engineering',
      actorId: userId,
      correlationId: 'demo-seed:create-workspace',
    });
    if (!created.ok) {
      throw new Error(`Could not create the demo workspace: ${created.error.message}`);
    }
    workspaceId = created.value.workspace.id;
    log(`Created workspace ${DEMO_WORKSPACE_NAME} (${workspaceId})`);
  } else {
    log(`Reusing workspace ${DEMO_WORKSPACE_NAME} (${workspaceId})`);
  }
  const workspaceIdBranded = workspaceId as WorkspaceId;

  // --- 3. an ACTIVE project (v1 projects auto-activate on creation) ---------
  const existingProjects = await repositories.projects.findByName(tenantId, DEMO_PROJECT_NAME);
  if (existingProjects.length === 0) {
    const created = await container.createProject.handle({
      organizationId: tenantId,
      name: DEMO_PROJECT_NAME,
      actorId: userId,
      correlationId: 'demo-seed:create-project',
    });
    if (!created.ok) {
      throw new Error(`Could not create the demo project: ${created.error.message}`);
    }
    log(`Created project ${DEMO_PROJECT_NAME} (${created.value.project.id})`);
  } else {
    log(`Reusing project ${DEMO_PROJECT_NAME} (${existingProjects[0]?.id})`);
  }

  // --- 4. the known-solution knowledge article (published + indexed) --------
  const existingArticles = await repositories.knowledgeArticles.listByWorkspace(
    tenantId,
    workspaceIdBranded,
  );
  const existingArticle = existingArticles.find((article) => article.title === DEMO_ARTICLE_TITLE);
  if (existingArticle === undefined || existingArticle.status.value !== 'published') {
    let articleId = existingArticle?.id;
    if (articleId === undefined) {
      const created = await container.createArticle.handle({
        tenantId,
        workspaceId: workspaceIdBranded,
        actorId: userId,
        title: DEMO_ARTICLE_TITLE,
        body: DEMO_ARTICLE_BODY,
        correlationId: 'demo-seed:create-article',
      });
      if (!created.ok) {
        throw new Error(`Could not create the demo knowledge article: ${created.error.message}`);
      }
      articleId = created.value.article.id;
    }
    const published = await container.publishArticle.handle({
      tenantId,
      workspaceId: workspaceIdBranded,
      actorId: userId,
      articleId,
      correlationId: 'demo-seed:publish-article',
    });
    if (!published.ok) {
      throw new Error(`Could not publish the demo knowledge article: ${published.error.message}`);
    }
    const indexed = await container.indexArticle.handle({
      tenantId,
      workspaceId: workspaceIdBranded,
      articleId: published.value.article.id,
      title: published.value.article.title,
      text: published.value.article.body,
      version: published.value.article.contentVersion,
    });
    if (!indexed.ok) {
      throw new Error(`Could not index the demo knowledge article: ${indexed.error.message}`);
    }
    log(`Published + indexed knowledge article "${DEMO_ARTICLE_TITLE}"`);
  } else {
    log(`Reusing published knowledge article "${DEMO_ARTICLE_TITLE}"`);
  }

  // --- 5. RESET: clear any stale problem/plan state for the demo tenant -----
  const stalePlans = await db
    .select({ id: remediationPlans.id })
    .from(remediationPlans)
    .where(eq(remediationPlans.tenantId, tenantId));
  const stalePlanIds = stalePlans.map((row) => row.id);
  if (stalePlanIds.length > 0) {
    await db.delete(remediationPlanSteps).where(inArray(remediationPlanSteps.planId, stalePlanIds));
  }
  await db.delete(remediationPlans).where(eq(remediationPlans.tenantId, tenantId));
  await db.delete(businessProblems).where(eq(businessProblems.tenantId, tenantId));
  log('Cleared any stale remediation plans/problems for the demo workspace.');

  // --- 6. RESET: a fresh UNREAD notification (the project_attention trigger) -
  await db
    .delete(notificationsTable)
    .where(
      and(
        eq(notificationsTable.tenantId, tenantId),
        eq(notificationsTable.sourceEventId, DEMO_NOTIFICATION_SOURCE_EVENT),
      ),
    );
  const notificationRepo = new PgNotificationRepository(db);
  await notificationRepo.save(
    Notification.create(
      {
        recipientId: userId,
        tenantId,
        workspaceId: workspaceIdBranded,
        type: 'project.decision_needed',
        category: 'project',
        title: `Decision needed on ${DEMO_PROJECT_NAME}`,
        body: 'The release plan needs your sign-off.',
        priority: 'normal',
        sourceEventId: DEMO_NOTIFICATION_SOURCE_EVENT,
        correlationId: 'demo-seed:notification',
      },
      new Date().toISOString(),
    ),
  );
  log('Seeded a fresh unread notification.');

  log('');
  log('Demo ready. Next steps:');
  log('  1. pnpm dev:local (if not already running)');
  log(`  2. Open http://localhost:5173 and sign in as ${DEMO_USER_EMAIL} / nexora123`);
  log(`  3. Switch to "${DEMO_ORG_NAME}" / "${DEMO_WORKSPACE_NAME}" if not already selected`);
  log('  4. Open Problems, click "Scan now" — the project_attention problem appears');
  log('  5. Investigate -> Create remediation plan -> Run next step -> Approve -> Resolved');
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(
      `\ndemo:reset failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
