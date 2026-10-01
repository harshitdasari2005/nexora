/**
 * AUTH-009 — an OIDC login is bound to the stable external identity
 * (issuer + subject), not to the email address.
 *
 * Email is consulted only to create an account or to bind a legacy UNBOUND
 * account; an account bound to one identity is never reused by another, and the
 * failure reveals nothing about why.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId } from '@nexora/contracts/common';
import {
  InvalidCredentialsError,
  SessionDomainService,
  UserDomainService,
} from '@nexora/domain-identity';
import { ValidationError } from '@nexora/shared/errors';

import type { AuthenticateWithOidcCommand } from '../src/commands/authenticate-with-oidc.command.js';
import { IdentityApplicationService } from '../src/services/identity-application-service.js';
import {
  InMemoryRoleRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
  RecordingEventPublisher,
  TestPasswordHasher,
} from './helpers.js';

const ISSUER = 'http://localhost:8080/realms/nexora';
const OTHER_ISSUER = 'https://login.other-idp.example';

function makeEnvironment() {
  const users = new InMemoryUserRepository();
  const sessions = new InMemorySessionRepository();
  const roles = new InMemoryRoleRepository();
  const hasher = new TestPasswordHasher();
  const publisher = new RecordingEventPublisher();
  const usersService = new UserDomainService({ users, roles, sessions, hasher });
  const sessionsService = new SessionDomainService({ sessions, users, hasher });
  const service = new IdentityApplicationService({
    users,
    usersService,
    sessionsService,
    publisher,
  });
  return { service, users, sessions, usersService };
}

function command(
  overrides: Partial<AuthenticateWithOidcCommand> = {},
): AuthenticateWithOidcCommand {
  return {
    oidcSubject: 'sub-alex',
    email: 'alex@nexora.dev',
    emailVerified: true,
    displayName: 'Alex Morgan',
    issuer: ISSUER,
    correlationId: 'corr_bind',
    ...overrides,
  };
}

async function loginOk(
  env: ReturnType<typeof makeEnvironment>,
  overrides: Partial<AuthenticateWithOidcCommand> = {},
) {
  const result = await env.service.authenticateWithOidc(command(overrides));
  if (!result.ok) throw new Error(`login failed: ${result.error.message}`);
  return result.value;
}

/** An account that existed BEFORE binding was introduced: active, verified email, no OIDC identity. */
async function legacyUser(env: ReturnType<typeof makeEnvironment>, email = 'alex@nexora.dev') {
  const registered = await env.usersService.register(
    {
      tenantId: 'tnt_platform' as TenantId,
      email,
      username: email.split('@')[0]!,
      password: 'oidc-legacy-password-0001',
      displayName: 'Legacy User',
      status: 'active',
    },
    {
      actor: { kind: 'user', id: 'legacy' },
      correlationId: 'corr_legacy',
      tenantId: 'tnt_platform' as TenantId,
    },
  );
  if (!registered.ok) throw new Error('legacy setup failed');
  return registered.value.user;
}

describe('AUTH-009 — provisioning and returning logins', () => {
  it('first login creates the user BOUND to issuer + subject in the same insert', async () => {
    const env = makeEnvironment();
    const out = await loginOk(env);
    expect(out.isNewUser).toBe(true);
    const user = env.users.users.get(out.userId as UserId)!;
    expect(user.oidcIssuer).toBe(ISSUER);
    expect(user.oidcSubject).toBe('sub-alex');
    expect(env.users.users.size).toBe(1);
  });

  it('a returning login with the same issuer + subject reuses the user (no second account)', async () => {
    const env = makeEnvironment();
    const first = await loginOk(env);
    const second = await loginOk(env, { correlationId: 'corr_2' });
    expect(second.userId).toBe(first.userId);
    expect(second.isNewUser).toBe(false);
    expect(env.users.users.size).toBe(1);
  });

  it('email case and whitespace normalisation still resolves the same account', async () => {
    const env = makeEnvironment();
    const first = await loginOk(env);
    const again = await loginOk(env, { email: '  ALEX@Nexora.DEV ', correlationId: 'corr_3' });
    expect(again.userId).toBe(first.userId);
    // And for the legacy bind path: a differently-cased email still finds the unbound account.
    const legacyEnv = makeEnvironment();
    const legacy = await legacyUser(legacyEnv, 'person@nexora.dev');
    const bound = await loginOk(legacyEnv, { email: ' PERSON@nexora.dev', oidcSubject: 'sub-p' });
    expect(bound.userId).toBe(legacy.id);
  });
});

describe('AUTH-009 — a bound account cannot be taken over through its email', () => {
  it('same email + DIFFERENT subject is rejected with the generic error; nothing is created or changed', async () => {
    const env = makeEnvironment();
    const first = await loginOk(env);
    const hijack = await env.service.authenticateWithOidc(command({ oidcSubject: 'sub-attacker' }));
    expect(hijack.ok).toBe(false);
    if (!hijack.ok) expect(hijack.error).toBeInstanceOf(InvalidCredentialsError);
    expect(env.users.users.size).toBe(1);
    const user = env.users.users.get(first.userId as UserId)!;
    expect([user.oidcIssuer, user.oidcSubject]).toEqual([ISSUER, 'sub-alex']);
    expect(env.sessions.sessions.size).toBe(1); // no session was issued to the attacker
  });

  it('same email + DIFFERENT issuer (even the same subject) is rejected', async () => {
    const env = makeEnvironment();
    await loginOk(env);
    for (const overrides of [
      { issuer: OTHER_ISSUER, oidcSubject: 'sub-other' },
      { issuer: OTHER_ISSUER, oidcSubject: 'sub-alex' },
    ]) {
      const result = await env.service.authenticateWithOidc(command(overrides));
      expect(result.ok, JSON.stringify(overrides)).toBe(false);
      if (!result.ok) expect(result.error).toBeInstanceOf(InvalidCredentialsError);
    }
    expect(env.users.users.size).toBe(1);
  });

  it('different email + the SAME bound issuer + subject authenticates the bound user (email is not authoritative)', async () => {
    const env = makeEnvironment();
    const first = await loginOk(env);
    const renamed = await loginOk(env, {
      email: 'alex.renamed@nexora.dev',
      correlationId: 'corr_r',
    });
    expect(renamed.userId).toBe(first.userId);
    expect(renamed.isNewUser).toBe(false);
    expect(env.users.users.size).toBe(1); // no new account for the new email
  });

  it('a raw email alone never authenticates a bound user (every login needs the verified identity)', async () => {
    const env = makeEnvironment();
    await loginOk(env);
    // An identity the IdP never bound to this account, presenting the same email.
    const result = await env.service.authenticateWithOidc(command({ oidcSubject: 'sub-new' }));
    expect(result.ok).toBe(false);
  });

  it('the failure is the generic invalid-credentials error and reveals neither the account nor the binding', async () => {
    const env = makeEnvironment();
    await loginOk(env);
    const bySubject = await env.service.authenticateWithOidc(command({ oidcSubject: 'sub-x' }));
    const byIssuer = await env.service.authenticateWithOidc(
      command({ issuer: OTHER_ISSUER, oidcSubject: 'sub-y' }),
    );
    for (const result of [bySubject, byIssuer]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const text = JSON.stringify({
          message: result.error.message,
          details: result.error.details,
        });
        expect(result.error.message).toBe('Invalid credentials');
        expect(result.error.details).toBeUndefined();
        for (const secret of [
          ISSUER,
          OTHER_ISSUER,
          'sub-alex',
          'sub-x',
          'sub-y',
          'alex@nexora.dev',
        ]) {
          expect(text).not.toContain(secret);
        }
      }
    }
    // Issuer-only and subject-only mismatches are indistinguishable.
    if (!bySubject.ok && !byIssuer.ok) {
      expect(bySubject.error.message).toBe(byIssuer.error.message);
      expect(bySubject.error.code).toBe(byIssuer.error.code);
    }
  });
});

describe('AUTH-009 — unverified emails and legacy (unbound) accounts', () => {
  it('email_verified=false creates and binds nothing, before any lookup', async () => {
    const env = makeEnvironment();
    const legacy = await legacyUser(env);
    const result = await env.service.authenticateWithOidc(command({ emailVerified: false }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(ValidationError);
    expect(env.users.users.size).toBe(1);
    expect(env.users.users.get(legacy.id)!.oidcIssuer).toBeUndefined();
    expect(env.sessions.sessions.size).toBe(0);
  });

  it('an empty issuer or subject is rejected before any lookup', async () => {
    const env = makeEnvironment();
    for (const overrides of [{ issuer: '  ' }, { oidcSubject: '' }]) {
      const result = await env.service.authenticateWithOidc(command(overrides));
      expect(result.ok).toBe(false);
    }
    expect(env.users.users.size).toBe(0);
  });

  it('a legacy unbound account is bound at its first OIDC login; the same identity then succeeds; a different identity with the same email is rejected', async () => {
    const env = makeEnvironment();
    const legacy = await legacyUser(env);
    const first = await loginOk(env);
    expect(first.userId).toBe(legacy.id);
    expect(first.isNewUser).toBe(false);
    const bound = env.users.users.get(legacy.id)!;
    expect([bound.oidcIssuer, bound.oidcSubject]).toEqual([ISSUER, 'sub-alex']);
    expect((await loginOk(env, { correlationId: 'again' })).userId).toBe(legacy.id);
    const other = await env.service.authenticateWithOidc(command({ oidcSubject: 'sub-other' }));
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error).toBeInstanceOf(InvalidCredentialsError);
    expect(env.users.users.size).toBe(1);
  });

  it('an identity already bound to ANOTHER account never silently binds a legacy account', async () => {
    const env = makeEnvironment();
    await loginOk(env, { email: 'owner@nexora.dev', oidcSubject: 'sub-shared' }); // owns (ISSUER, sub-shared)
    const legacy = await legacyUser(env, 'legacy@nexora.dev');
    // The same identity now presents the legacy account's email: identity wins (it is the owner's).
    const result = await loginOk(env, { email: 'legacy@nexora.dev', oidcSubject: 'sub-shared' });
    expect(result.userId).not.toBe(legacy.id);
    expect(env.users.users.get(legacy.id)!.oidcIssuer).toBeUndefined();
  });
});

describe('AUTH-009 — concurrent first logins', () => {
  it('two simultaneous first logins for one legacy account with DIFFERENT subjects: exactly one binding wins, the loser is rejected', async () => {
    const env = makeEnvironment();
    const legacy = await legacyUser(env);
    const [a, b] = await Promise.all([
      env.service.authenticateWithOidc(command({ oidcSubject: 'sub-A', correlationId: 'ca' })),
      env.service.authenticateWithOidc(command({ oidcSubject: 'sub-B', correlationId: 'cb' })),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const user = env.users.users.get(legacy.id)!;
    expect(['sub-A', 'sub-B']).toContain(user.oidcSubject);
    const winner = a.ok ? 'sub-A' : 'sub-B';
    expect(user.oidcSubject).toBe(winner);
    expect(env.users.users.size).toBe(1);
  });

  it('two simultaneous first logins of the SAME identity both succeed against one account', async () => {
    const env = makeEnvironment();
    const legacy = await legacyUser(env);
    const results = await Promise.all([
      env.service.authenticateWithOidc(command({ correlationId: 'c1' })),
      env.service.authenticateWithOidc(command({ correlationId: 'c2' })),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(env.users.users.size).toBe(1);
    expect(env.users.users.get(legacy.id)!.oidcSubject).toBe('sub-alex');
  });
});
