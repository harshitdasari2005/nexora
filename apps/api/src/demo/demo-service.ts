/**
 * @nexora/app-api — the Demo World service.
 *
 * Seeds, signs in to, and resets the ONE deterministic demo organization.
 * It owns no business behaviour: it materializes real state through the real
 * seeder and mints real sessions through the real identity service. Every
 * target is derived from the fixed demo world ({@link demoIds}) — no method
 * takes an organization, workspace, user id or email from a caller.
 */

import type { UserId, WorkspaceId } from '@nexora/contracts/common';
import type { AuthenticateWithOidcHandler } from '@nexora/application-identity';
import { Email } from '@nexora/domain-identity';
import { ActivityItem } from '@nexora/module-notifications';
import type { NexoraDatabase } from '@nexora/persistence';

import type { RepositorySet } from '../container.js';
import { resetScopedData, type ResetScope } from './reset.js';
import { seedWorld, type SeedSummary } from './seed-world.js';
import {
  DEMO_PERSONAS,
  DEMO_PERSONA_KEYS,
  buildDemoWorld,
  demoIds,
  type DemoIds,
  type DemoPersonaDefinition,
  type DemoPersonaKey,
} from './world.js';

/** The OIDC-style issuer recorded for a demo sign-in (never a real IdP). */
const DEMO_ISSUER = 'nexora-demo';

/** The deterministic external identity of a demo persona (AUTH-009): issuer + subject. */
const demoOidcSubject = (personaKey: string): string => `demo:${personaKey}`;

/** Thrown for a failure the route maps to a specific HTTP status. */
export class DemoError extends Error {
  constructor(
    readonly code:
      | 'DEMO_NOT_SEEDED'
      | 'DEMO_SEED_CONFLICT'
      | 'DEMO_RESET_UNAVAILABLE'
      | 'DEMO_BUSY'
      | 'DEMO_NOT_DEMO_USER',
    message: string,
  ) {
    super(message);
    this.name = 'DemoError';
  }
}

/** The result of a completed reset. */
export interface DemoResetResult {
  /** Rows the reset removed, per table (only tables that had rows). */
  deleted: Record<string, number>;
  seed: SeedSummary;
  /** The activity item recording the reset in the freshly seeded organization. */
  auditItemId: string;
  resetAt: string;
}

/** A persona as exposed to the browser (no email, no user id). */
export interface DemoPersonaView {
  key: DemoPersonaKey;
  displayName: string;
  title: string;
  responsibility: string;
  workspaceId: string;
}

/** Dependencies of the {@link DemoService}. */
export interface DemoServiceDependencies {
  repositories: RepositorySet;
  /** The PostgreSQL client. Absent → reset is unavailable (in-memory repositories cannot be reset by scope). */
  database?: NexoraDatabase | undefined;
  authenticate: AuthenticateWithOidcHandler;
  now?: () => Date;
  /** How long a reset waits for in-flight requests to finish. */
  drainTimeoutMs?: number;
}

/** Seeds, signs in to and resets the demo organization. */
export class DemoService {
  readonly #repos: RepositorySet;
  readonly #database: NexoraDatabase | undefined;
  readonly #authenticate: AuthenticateWithOidcHandler;
  readonly #now: () => Date;
  readonly #drainTimeoutMs: number;
  readonly #ids: DemoIds;
  readonly #inFlight = new Set<symbol>();
  #resetting = false;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(dependencies: DemoServiceDependencies) {
    this.#repos = dependencies.repositories;
    this.#database = dependencies.database;
    this.#authenticate = dependencies.authenticate;
    this.#now = dependencies.now ?? (() => new Date());
    this.#drainTimeoutMs = dependencies.drainTimeoutMs ?? 15_000;
    this.#ids = demoIds();
  }

  /** The demo organization/workspace/user ids (derived, never client-supplied). */
  get ids(): DemoIds {
    return this.#ids;
  }

  /** Whether a reset is in progress (new requests are refused meanwhile). */
  get resetting(): boolean {
    return this.#resetting;
  }

  /** Marks a request in flight; returns the release function. */
  track(): () => void {
    const token = Symbol('demo-request');
    this.#inFlight.add(token);
    return () => {
      this.#inFlight.delete(token);
    };
  }

  /** The persona list shown to the browser. */
  personas(): readonly DemoPersonaView[] {
    return DEMO_PERSONAS.map((persona) => ({
      key: persona.key,
      displayName: persona.displayName,
      title: persona.title,
      responsibility: persona.responsibility,
      workspaceId: this.#ids.workspaceIds[persona.workspace],
    }));
  }

  /** The persona a user id belongs to, or undefined for any other user. */
  personaOfUser(userId: string): DemoPersonaKey | undefined {
    return DEMO_PERSONA_KEYS.find((key) => this.#ids.userIds[key] === userId);
  }

  /** Whether the demo world is present (its organization exists). */
  async isSeeded(): Promise<boolean> {
    const org = await this.#repos.organizations.findById(this.#ids.organizationId as never);
    return org !== undefined;
  }

  /** Seeds the demo world (idempotent, serialized with resets). */
  seed(): Promise<SeedSummary> {
    return this.#serialize(() => this.#seed());
  }

  /**
   * Starts a REAL session for a persona from the fixed allowlist. The user is
   * the deterministic seeded account; the session comes from the same
   * identity service the OIDC callback uses, so every request the browser
   * then makes runs through the normal authorization pipeline.
   */
  async login(personaKey: string): Promise<{ sessionToken: string; persona: DemoPersonaView }> {
    const persona = DEMO_PERSONAS.find((candidate) => candidate.key === personaKey);
    if (persona === undefined) {
      throw new DemoError('DEMO_NOT_DEMO_USER', 'Unknown demo persona');
    }
    const userId = this.#ids.userIds[persona.key] as UserId;
    const user = await this.#repos.users.findById(userId);
    if (user === undefined || user.email.value !== persona.email) {
      // Never let the identity service JIT-provision a look-alike account.
      throw new DemoError('DEMO_NOT_SEEDED', 'The demo world is not seeded');
    }
    const result = await this.#authenticate.handle({
      oidcSubject: demoOidcSubject(persona.key),
      email: persona.email,
      emailVerified: true,
      displayName: persona.displayName,
      issuer: DEMO_ISSUER,
      correlationId: `demo-login:${persona.key}`,
    });
    if (!result.ok) throw result.error;
    if (result.value.userId !== userId) {
      throw new DemoError('DEMO_NOT_DEMO_USER', 'Demo sign-in resolved to an unexpected account');
    }
    return {
      sessionToken: result.value.sessionToken,
      persona: this.#view(persona),
    };
  }

  /**
   * Restores the deterministic demo world. Serialized (one reset/seed at a
   * time), refuses new requests while it runs, waits for in-flight requests to
   * drain, deletes ONLY the demo organization's rows/users/sessions, reseeds,
   * and records the reset as an activity item of the fresh organization.
   *
   * The reset erases the demo's earlier audit history (audit is a read model
   * over the rows it deletes) — the recorded item says so.
   */
  reset(requestedByUserId: string): Promise<DemoResetResult> {
    return this.#serialize(async () => {
      if (this.#database === undefined) {
        throw new DemoError(
          'DEMO_RESET_UNAVAILABLE',
          'Reset needs the PostgreSQL database (in-memory repositories cannot be reset by scope)',
        );
      }
      const database = this.#database;
      this.#resetting = true;
      try {
        // The reset request itself is not tracked (see the route), so the
        // drain waits for every OTHER in-flight request.
        const drained = await this.#awaitDrain();
        if (!drained) {
          throw new DemoError('DEMO_BUSY', 'Demo requests are still running — try again shortly');
        }
        const deleted = await resetScopedData(database, this.#scope());
        const seed = await this.#seed();
        const resetAt = this.#now().toISOString();
        const item = ActivityItem.create(
          {
            tenantId: this.#ids.organizationId as never,
            workspaceId: this.#ids.workspaceIds.eng as WorkspaceId,
            type: 'demo.reset',
            title: 'Demo world reset',
            body:
              'The demo organization was restored to its deterministic seed. ' +
              'Audit history recorded before this reset was cleared with the demo data.',
            actorId: requestedByUserId,
            sourceEventId: `demo-reset:${resetAt}`,
            correlationId: `demo-reset:${resetAt}`,
          },
          resetAt,
        );
        await this.#repos.activity.save(item);
        return {
          deleted: Object.fromEntries(Object.entries(deleted).filter(([, count]) => count > 0)),
          seed,
          auditItemId: item.id,
          resetAt,
        };
      } finally {
        this.#resetting = false;
      }
    });
  }

  /** The reset scope: the demo world's own organization, workspaces and users. */
  #scope(): ResetScope {
    return {
      organizationIds: [this.#ids.organizationId],
      workspaceIds: [this.#ids.workspaceIds.eng, this.#ids.workspaceIds.fin],
      userIds: DEMO_PERSONA_KEYS.map((key) => this.#ids.userIds[key]),
    };
  }

  async #seed(): Promise<SeedSummary> {
    // Refuse to adopt a pre-existing account: an email that already belongs to
    // a different user id is foreign data the seed must never overwrite.
    for (const persona of DEMO_PERSONAS) {
      const existing = await this.#repos.users.findByEmail(Email.create(persona.email));
      if (existing !== undefined && existing.id !== this.#ids.userIds[persona.key]) {
        throw new DemoError(
          'DEMO_SEED_CONFLICT',
          `Demo persona email ${persona.email} already belongs to another account`,
        );
      }
    }
    // Demo accounts are bound to their deterministic identity at seed time, so a
    // demo login resolves them by (issuer, subject) exactly like any OIDC user.
    return seedWorld(this.#repos, buildDemoWorld(), {
      oidcIdentity: (userKey) => ({ issuer: DEMO_ISSUER, subject: demoOidcSubject(userKey) }),
    });
  }

  async #awaitDrain(): Promise<boolean> {
    const deadline = Date.now() + this.#drainTimeoutMs;
    while (this.#inFlight.size > 0) {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return true;
  }

  #serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(work, work);
    this.#chain = next.catch(() => undefined);
    return next;
  }

  #view(persona: DemoPersonaDefinition): DemoPersonaView {
    return {
      key: persona.key,
      displayName: persona.displayName,
      title: persona.title,
      responsibility: persona.responsibility,
      workspaceId: this.#ids.workspaceIds[persona.workspace],
    };
  }
}
