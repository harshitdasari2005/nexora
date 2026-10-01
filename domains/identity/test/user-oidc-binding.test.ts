/** AUTH-009 — the User aggregate's optional external identity binding. */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import { User } from '../src/entities/user.js';
import { InvalidIdentityValueError } from '../src/errors/index.js';
import {
  DisplayName,
  Email,
  PasswordHash,
  UserStatus,
  Username,
} from '../src/value-objects/index.js';
import { testContext } from './helpers.js';

const base = {
  tenantId: 'tnt_platform' as TenantId,
  email: Email.create('alex@nexora.dev'),
  username: Username.create('alex'),
  passwordHash: PasswordHash.create('scrypt', 'x'),
  displayName: DisplayName.create('Alex'),
  status: UserStatus.active(),
};

describe('User OIDC identity binding', () => {
  it('is unbound by default', () => {
    const user = User.create(base, testContext());
    expect(user.oidcIssuer).toBeUndefined();
    expect(user.oidcSubject).toBeUndefined();
    const snap = User.snapshot(user);
    expect(snap.oidcIssuer).toBeUndefined();
    expect(snap.oidcSubject).toBeUndefined();
  });

  it('is created bound, and the binding round-trips through snapshot/hydrate', () => {
    const user = User.create(
      { ...base, oidcIssuer: 'https://idp.example', oidcSubject: 'sub-1' },
      testContext(),
    );
    const hydrated = User.hydrate(User.snapshot(user));
    expect([hydrated.oidcIssuer, hydrated.oidcSubject]).toEqual(['https://idp.example', 'sub-1']);
  });

  it('only ever stores the PAIR: half a binding (or a blank one) is invalid', () => {
    expect(() =>
      User.create({ ...base, oidcIssuer: 'https://idp.example' }, testContext()),
    ).toThrow(InvalidIdentityValueError);
    expect(() => User.create({ ...base, oidcSubject: 'sub-1' }, testContext())).toThrow(
      InvalidIdentityValueError,
    );
    expect(() =>
      User.create(
        { ...base, oidcIssuer: 'https://idp.example', oidcSubject: '   ' },
        testContext(),
      ),
    ).toThrow(InvalidIdentityValueError);
    const blank = User.create({ ...base, oidcIssuer: ' ', oidcSubject: '' }, testContext());
    expect(blank.oidcIssuer).toBeUndefined();
  });
});
