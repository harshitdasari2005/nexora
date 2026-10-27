/**
 * EndSession use-case tests: logout ends the session, publishes the event,
 * and reports an unknown session.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import { IDENTITY_EVENT_TYPES, SessionNotFoundError } from '@nexora/domain-identity';
import { hashSessionToken, SessionDomainService, UserDomainService } from '@nexora/domain-identity';

import type { EndSessionCommand } from '../src/commands/end-session.command.js';
import { IdentityApplicationService } from '../src/services/identity-application-service.js';
import {
  InMemoryRoleRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
  RecordingEventPublisher,
  TestPasswordHasher,
} from './helpers.js';

const TENANT = 'tnt_platform' as TenantId;

async function makeLoggedInSession(): Promise<{
  service: IdentityApplicationService;
  sessions: InMemorySessionRepository;
  publisher: RecordingEventPublisher;
  sessionId: string;
  actorId: string;
}> {
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

  const authenticated = await service.authenticateWithOidc({
    oidcSubject: 'sub-alex',
    email: 'alex@nexora.dev',
    emailVerified: true,
    displayName: 'Alex Morgan',
    issuer: 'http://localhost:8080/realms/nexora',
    correlationId: 'corr_login',
  });
  if (!authenticated.ok) {
    throw new Error('setup failed');
  }
  const session = sessions.byToken.get(hashSessionToken(authenticated.value.sessionToken));
  if (session === undefined) {
    throw new Error('setup failed');
  }
  return {
    service,
    sessions,
    publisher,
    sessionId: session.id,
    actorId: authenticated.value.userId,
  };
}

function endCommand(sessionId: string, actorId: string): EndSessionCommand {
  return { sessionId, actorId, tenantId: TENANT, correlationId: 'corr_logout' };
}

describe('IdentityApplicationService.endSession', () => {
  it('ends the session and publishes SessionEnded', async () => {
    const { service, publisher, sessionId, actorId } = await makeLoggedInSession();
    const result = await service.endSession(endCommand(sessionId, actorId));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.session.status.value).toBe('ended');
    }
    expect(publisher.types).toContain(IDENTITY_EVENT_TYPES.sessionEnded);
  });

  it('returns a SessionNotFoundError for an unknown session', async () => {
    const { service, actorId } = await makeLoggedInSession();
    const result = await service.endSession(endCommand('ses_missing', actorId));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SessionNotFoundError);
    }
  });
});
