/**
 * Domain event tests: envelope shape, category, and payloads.
 */

import { describe, expect, it } from 'vitest';
import type { UserId } from '@nexora/contracts/common';

import {
  IDENTITY_EVENT_TYPES,
  roleAssignedEvent,
  roleRemovedEvent,
  sessionEndedEvent,
  sessionStartedEvent,
  userActivatedEvent,
  userCreatedEvent,
  userDeactivatedEvent,
} from '../src/events/index.js';
import { testContext } from './helpers.js';

const USER_ID = 'usr_1' as UserId;

const context = testContext();

describe('identity domain events', () => {
  it('userCreatedEvent carries the canonical type and category', () => {
    const event = userCreatedEvent(context, {
      userId: USER_ID,
      email: 'a@b.com',
      username: 'alice',
      displayName: 'Alice',
    });
    expect(event.type).toBe(IDENTITY_EVENT_TYPES.userCreated);
    expect(event.metadata?.category).toBe('identity');
    expect(event.actor).toEqual(context.actor);
    expect(event.correlationId).toBe('corr_test');
    expect(event.tenantId).toBe('tenant_1');
    expect(event.version).toBe(1);
  });

  it('userActivatedEvent carries the payload', () => {
    const event = userActivatedEvent(context, { userId: USER_ID });
    expect(event.type).toBe(IDENTITY_EVENT_TYPES.userActivated);
    expect(event.payload.userId).toBe(USER_ID);
  });

  it('userDeactivatedEvent carries the reason', () => {
    const event = userDeactivatedEvent(context, { userId: USER_ID, reason: 'offboarding' });
    expect(event.type).toBe(IDENTITY_EVENT_TYPES.userDeactivated);
    expect(event.payload.reason).toBe('offboarding');
  });

  it('roleAssignedEvent carries the role', () => {
    const event = roleAssignedEvent(context, { userId: USER_ID, role: 'workspace.admin' });
    expect(event.type).toBe(IDENTITY_EVENT_TYPES.roleAssigned);
    expect(event.payload.role).toBe('workspace.admin');
  });

  it('roleRemovedEvent carries the role', () => {
    const event = roleRemovedEvent(context, { userId: USER_ID, role: 'hr.approver' });
    expect(event.type).toBe(IDENTITY_EVENT_TYPES.roleRemoved);
    expect(event.payload.role).toBe('hr.approver');
  });

  it('sessionStartedEvent carries session timing', () => {
    const event = sessionStartedEvent(context, {
      sessionId: 'ses_1',
      userId: USER_ID,
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T08:00:00.000Z',
    });
    expect(event.type).toBe(IDENTITY_EVENT_TYPES.sessionStarted);
    expect(event.payload.sessionId).toBe('ses_1');
    expect(event.payload.expiresAt).toBe('2026-01-01T08:00:00.000Z');
  });

  it('sessionEndedEvent carries the reason', () => {
    const event = sessionEndedEvent(context, {
      sessionId: 'ses_1',
      userId: USER_ID,
      reason: 'logout',
    });
    expect(event.type).toBe(IDENTITY_EVENT_TYPES.sessionEnded);
    expect(event.payload.reason).toBe('logout');
  });

  it('every event gets a unique id and occurrence timestamp', () => {
    const event = userCreatedEvent(context, {
      userId: USER_ID,
      email: 'a@b.com',
      username: 'alice',
      displayName: 'Alice',
    });
    expect(event.id).toMatch(/^evt_/);
    expect(Date.parse(event.occurredAt)).not.toBeNaN();
  });
});
