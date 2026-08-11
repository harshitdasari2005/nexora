/**
 * AuthenticateWithOidc use-case tests: idempotent provisioning from OIDC
 * claims, session issuance for the verified principal, event publishing,
 * and validation failures.
 */

import { describe, expect, it } from 'vitest';
import type { UserId } from '@nexora/contracts/common';
import { ValidationError } from '@nexora/shared/errors';

import { IDENTITY_EVENT_TYPES } from '@nexora/domain-identity';
import { SessionDomainService, UserDomainService } from '@nexora/domain-identity';

import type { AuthenticateWithOidcCommand } from '../src/commands/authenticate-with-oidc.command.js';
import {
  deriveUsername,
  IdentityApplicationService,
} from '../src/services/identity-application-service.js';
import {
  InMemoryRoleRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
  RecordingEventPublisher,
  TestPasswordHasher,
} from './helpers.js';

interface Environment {
  service: IdentityApplicationService;
  users: InMemoryUserRepository;
  sessions: InMemorySessionRepository;
  publisher: RecordingEventPublisher;
}

function makeEnvironment(): Environment {
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
  return { service, users, sessions, publisher };
}

function command(
  overrides: Partial<AuthenticateWithOidcCommand> = {},
): AuthenticateWithOidcCommand {
  return {
    oidcSubject: '6f1a2b3c-0000-0000-0000-000000000001',
    email: 'alex@nexora.dev',
    emailVerified: true,
    displayName: 'Alex Morgan',
    issuer: 'http://localhost:8080/realms/nexora',
    correlationId: 'corr_oidc_1',
    ...overrides,
  };
}

describe('IdentityApplicationService.authenticateWithOidc', () => {
  it('provisions a new user and issues a session for the verified principal', async () => {
    const { service, users, sessions, publisher } = makeEnvironment();
    const result = await service.authenticateWithOidc(command());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isNewUser).toBe(true);
      expect(result.value.sessionToken).toBeTruthy();
      const user = users.users.get(result.value.userId as UserId);
      expect(user).toBeDefined();
      expect(user?.status.isActive()).toBe(true);
      expect(sessions.sessions.size).toBe(1);
    }
    expect(publisher.types).toContain(IDENTITY_EVENT_TYPES.userCreated);
    expect(publisher.types).toContain(IDENTITY_EVENT_TYPES.sessionStarted);
  });

  it('is idempotent: re-authentication reuses the existing user and issues a new session', async () => {
    const { service, users, publisher } = makeEnvironment();
    const first = await service.authenticateWithOidc(command());
    expect(first.ok && first.value.isNewUser).toBe(true);

    const second = await service.authenticateWithOidc(command({ correlationId: 'corr_oidc_2' }));
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.isNewUser).toBe(false);
      expect(users.users.size).toBe(1);
    }
    expect(
      publisher.types.filter((type) => type === IDENTITY_EVENT_TYPES.userCreated),
    ).toHaveLength(1);
  });

  it('derives a username from the email local part', async () => {
    const { service, users } = makeEnvironment();
    const result = await service.authenticateWithOidc(command({ email: 'jane.doe@acme.dev' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(users.users.get(result.value.userId as UserId)?.username.value).toBe('jane.doe');
    }
  });

  it('falls back to a safe username when the local part is invalid or too short', async () => {
    // 2 characters: too short for the username pattern.
    expect(deriveUsername('ab@example.com')).toMatch(/^user_[0-9a-f]{8}$/);
    // Sanitizes to an empty local part: falls back too.
    expect(deriveUsername('+@example.com')).toMatch(/^user_[0-9a-f]{8}$/);
    // A sanitized local part that stays valid is kept.
    expect(deriveUsername('x+tag@example.com')).toBe('xtag');
  });

  it('rejects an unverified email', async () => {
    const { service, users } = makeEnvironment();
    const result = await service.authenticateWithOidc(command({ emailVerified: false }));
    // The email is the platform login key; provisioning from an unverified
    // email would let a Keycloak self-registered account claim a victim's
    // email (realm allows registration). Reject at the boundary.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
    expect(users.users.size).toBe(0);
  });

  it('rejects a malformed command with a ValidationError', async () => {
    const { service } = makeEnvironment();
    const result = await service.authenticateWithOidc(
      command({ email: 'not-an-email', oidcSubject: '' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });

  it('does not start a session for an inactive user', async () => {
    const { service, users } = makeEnvironment();
    const first = await service.authenticateWithOidc(command());
    if (!first.ok) {
      throw new Error('setup failed');
    }
    const user = users.users.get(first.value.userId as UserId);
    if (user === undefined) {
      throw new Error('setup failed');
    }
    user.deactivate('offboarding', {
      actor: { kind: 'user', id: first.value.userId },
      correlationId: 'corr_deactivate',
      tenantId: user.tenantId,
    });
    const second = await service.authenticateWithOidc(command({ correlationId: 'corr_oidc_3' }));
    expect(second.ok).toBe(false);
  });
});
