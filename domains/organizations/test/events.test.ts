/**
 * Organization domain event tests: types, payloads, envelope metadata, and
 * tenant-id resolution.
 */

import { describe, expect, it } from 'vitest';
import type { UserId } from '@nexora/contracts/common';

import {
  memberAddedEvent,
  memberRemovedEvent,
  ORGANIZATIONS_EVENT_CATEGORY,
  organizationActivatedEvent,
  organizationArchivedEvent,
  organizationCreatedEvent,
  ORGANIZATION_EVENT_TYPES,
  organizationSettingsUpdatedEvent,
  organizationSuspendedEvent,
} from '../src/events/index.js';
import { OrganizationId } from '../src/value-objects/organization-id.js';
import { testContext } from './helpers.js';

const context = testContext();
const organizationId = OrganizationId.create();

describe('organization events', () => {
  it('created carries identity, slug, name, type, and status', () => {
    const event = organizationCreatedEvent(context, organizationId, {
      organizationId,
      slug: 'acme',
      name: 'Acme Corp',
      type: 'enterprise',
      status: 'provisioning',
    });
    expect(event.type).toBe(ORGANIZATION_EVENT_TYPES.organizationCreated);
    expect(event.payload).toEqual({
      organizationId,
      slug: 'acme',
      name: 'Acme Corp',
      type: 'enterprise',
      status: 'provisioning',
    });
  });

  it('activated carries the organization id', () => {
    const event = organizationActivatedEvent(context, organizationId);
    expect(event.type).toBe(ORGANIZATION_EVENT_TYPES.organizationActivated);
    expect(event.payload.organizationId).toBe(organizationId);
  });

  it('suspended carries the reason', () => {
    const event = organizationSuspendedEvent(context, organizationId, 'non-payment');
    expect(event.type).toBe(ORGANIZATION_EVENT_TYPES.organizationSuspended);
    expect(event.payload).toEqual({ organizationId, reason: 'non-payment' });
  });

  it('archived carries the reason', () => {
    const event = organizationArchivedEvent(context, organizationId, 'closed');
    expect(event.type).toBe(ORGANIZATION_EVENT_TYPES.organizationArchived);
    expect(event.payload.reason).toBe('closed');
  });

  it('member added carries membership and role', () => {
    const event = memberAddedEvent(context, {
      organizationId,
      membershipId: 'mbr_1',
      userId: 'usr_1' as UserId,
      role: 'admin',
    });
    expect(event.type).toBe(ORGANIZATION_EVENT_TYPES.memberAdded);
    expect(event.payload.role).toBe('admin');
    expect(event.payload.membershipId).toBe('mbr_1');
  });

  it('member removed carries the role held at removal time', () => {
    const event = memberRemovedEvent(context, {
      organizationId,
      membershipId: 'mbr_1',
      userId: 'usr_1' as UserId,
      role: 'owner',
    });
    expect(event.type).toBe(ORGANIZATION_EVENT_TYPES.memberRemoved);
    expect(event.payload.role).toBe('owner');
  });

  it('settings updated carries the changed field keys', () => {
    const event = organizationSettingsUpdatedEvent(context, organizationId, [
      'defaultLocale',
      'retentionDays',
    ]);
    expect(event.type).toBe(ORGANIZATION_EVENT_TYPES.organizationSettingsUpdated);
    expect(event.payload.changedFields).toEqual(['defaultLocale', 'retentionDays']);
  });
});

describe('event envelope', () => {
  it('rides the shared envelope with platform category and identity metadata', () => {
    const event = organizationActivatedEvent(context, organizationId);
    expect(event.id).toMatch(/^evt_/);
    expect(event.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.metadata?.category).toBe(ORGANIZATIONS_EVENT_CATEGORY);
    expect(event.metadata?.category).toBe('platform');
    expect(event.metadata?.priority).toBe('normal');
    expect(event.metadata?.deliverySemantics).toBe('at_least_once');
    expect(event.metadata?.version).toBe(1);
    expect(event.correlationId).toBe('corr_test');
  });

  it('resolves tenantId from the organization id when context has none', () => {
    const event = organizationCreatedEvent(context, organizationId, {
      organizationId,
      slug: 'acme',
      name: 'Acme Corp',
      type: 'enterprise',
      status: 'provisioning',
    });
    expect(event.tenantId).toBe(organizationId);
  });

  it('prefers an explicit tenant id from the context', () => {
    const event = organizationActivatedEvent(
      testContext({ tenantId: 'tenant_explicit' as never }),
      organizationId,
    );
    expect(event.tenantId).toBe('tenant_explicit');
  });

  it('propagates the actor for audit attribution', () => {
    const event = organizationSuspendedEvent(
      testContext({ actor: { kind: 'agent', id: 'agt_1' } }),
      organizationId,
      'policy',
    );
    expect(event.actor).toEqual({ kind: 'agent', id: 'agt_1' });
  });
});
