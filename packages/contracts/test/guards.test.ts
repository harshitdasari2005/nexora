/**
 * Runtime guard tests: the dependency-free guards validate untrusted input
 * against the canonical contract vocabulary.
 */

import { describe, expect, it } from 'vitest';

import {
  isCompatibilityLevel,
  isEventCategory,
  isEventDeliverySemantics,
  isEventPriority,
  isNotificationChannel,
  isNotificationPriority,
  isNotificationStatus,
  isPluginLifecycleState,
  isRegistryType,
  isSemVer,
  validateEventEnvelope,
} from '../src/guards/index.js';

describe('literal guards', () => {
  it('accepts canonical values and rejects everything else', () => {
    expect(isEventCategory('hr')).toBe(true);
    expect(isEventCategory('platform')).toBe(true);
    expect(isEventCategory('hrx')).toBe(false);
    expect(isEventCategory(42)).toBe(false);
    expect(isEventCategory(undefined)).toBe(false);
  });

  it('guards event priorities and delivery semantics', () => {
    expect(isEventPriority('critical')).toBe(true);
    expect(isEventPriority('urgent')).toBe(false);
    expect(isEventDeliverySemantics('exactly_once')).toBe(true);
    expect(isEventDeliverySemantics('at_most_once')).toBe(false);
  });

  it('guards notification vocabulary', () => {
    expect(isNotificationChannel('slack')).toBe(true);
    expect(isNotificationChannel('teams')).toBe(false);
    expect(isNotificationPriority('urgent')).toBe(true);
    expect(isNotificationStatus('dead_lettered')).toBe(false);
    expect(isNotificationStatus('read')).toBe(true);
  });

  it('guards plugin lifecycle, registry types, and compatibility', () => {
    expect(isPluginLifecycleState('active')).toBe(true);
    expect(isPluginLifecycleState('published')).toBe(false);
    expect(isRegistryType('capability')).toBe(true);
    expect(isRegistryType('analytics')).toBe(false);
    expect(isCompatibilityLevel('breaking')).toBe(true);
    expect(isCompatibilityLevel('minor')).toBe(false);
  });

  it('validates semantic versions', () => {
    expect(isSemVer('1.2.3')).toBe(true);
    expect(isSemVer('v1.2.3')).toBe(false);
    expect(isSemVer('1.2')).toBe(false);
    expect(isSemVer('1.2.3.4')).toBe(false);
  });
});

describe('validateEventEnvelope', () => {
  it('accepts a well-formed envelope vocabulary', () => {
    expect(
      validateEventEnvelope({
        type: 'employee.created',
        version: 1,
        metadata: { category: 'hr', priority: 'normal', deliverySemantics: 'at_least_once' },
      }),
    ).toBeNull();
  });

  it('rejects an empty type and a non-positive version', () => {
    expect(validateEventEnvelope({ type: '', version: 1 })).toMatch(/type/);
    expect(validateEventEnvelope({ type: 'x', version: 0 })).toMatch(/version/);
    expect(validateEventEnvelope({ type: 'x', version: 1.5 })).toMatch(/version/);
  });

  it('rejects non-canonical metadata vocabulary', () => {
    expect(
      validateEventEnvelope({
        type: 'x',
        version: 1,
        metadata: { category: 'hrx' },
      }),
    ).toMatch(/category/);
    expect(
      validateEventEnvelope({
        type: 'x',
        version: 1,
        metadata: { priority: 'urgent' },
      }),
    ).toMatch(/priority/);
    expect(
      validateEventEnvelope({
        type: 'x',
        version: 1,
        metadata: { deliverySemantics: 'at_most_once' },
      }),
    ).toMatch(/deliverySemantics/);
  });

  it('accepts envelopes without metadata', () => {
    expect(validateEventEnvelope({ type: 'x', version: 1 })).toBeNull();
  });
});
