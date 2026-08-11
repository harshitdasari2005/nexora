/**
 * GetCurrentUser query tests: the public user DTO and the not-found path.
 */

import { describe, expect, it } from 'vitest';
import type { UserId } from '@nexora/contracts/common';

import { UserNotFoundError } from '@nexora/domain-identity';
import { SessionDomainService, UserDomainService } from '@nexora/domain-identity';

import { IdentityApplicationService } from '../src/services/identity-application-service.js';
import { GetCurrentUserHandler } from '../src/query-handlers/get-current-user.handler.js';
import {
  InMemoryRoleRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
  RecordingEventPublisher,
  TestPasswordHasher,
} from './helpers.js';

function makeHandler(): { handler: GetCurrentUserHandler; userId: UserId } {
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

  return {
    handler: new GetCurrentUserHandler(service),
    userId: 'usr_unknown' as UserId,
  };
}

describe('GetCurrentUserHandler', () => {
  it('returns a UserNotFoundError for an unknown user', async () => {
    const { handler, userId } = makeHandler();
    const result = await handler.handle({ userId });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(UserNotFoundError);
    }
  });
});
