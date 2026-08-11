/**
 * Value object tests: construction validation and equality.
 */

import { describe, expect, it } from 'vitest';

import { InvalidIdentityValueError } from '../src/errors/index.js';
import { DisplayName } from '../src/value-objects/display-name.js';
import { Email } from '../src/value-objects/email.js';
import { PasswordHash } from '../src/value-objects/password-hash.js';
import { SessionStatus } from '../src/value-objects/session-status.js';
import { UserStatus } from '../src/value-objects/user-status.js';
import { Username } from '../src/value-objects/username.js';

describe('Email', () => {
  it('accepts a valid email', () => {
    expect(Email.create('user@example.com').value).toBe('user@example.com');
  });

  it('normalizes to lowercase and trims whitespace', () => {
    expect(Email.create('  User@Example.COM ').value).toBe('user@example.com');
  });

  it('rejects an email without an @', () => {
    expect(() => Email.create('not-an-email')).toThrow(InvalidIdentityValueError);
  });

  it('rejects an email without a domain', () => {
    expect(() => Email.create('user@localhost')).toThrow(InvalidIdentityValueError);
  });

  it('rejects an empty email', () => {
    expect(() => Email.create('')).toThrow(InvalidIdentityValueError);
  });

  it('compares equal case-insensitively', () => {
    expect(Email.create('A@B.com').equals(Email.create('a@b.com'))).toBe(true);
    expect(Email.create('a@b.com').equals(Email.create('c@b.com'))).toBe(false);
  });
});

describe('Username', () => {
  it('accepts a valid username', () => {
    expect(Username.create('alice_1').value).toBe('alice_1');
  });

  it('normalizes to lowercase', () => {
    expect(Username.create('Alice_1').value).toBe('alice_1');
  });

  it('rejects a username shorter than 3 characters', () => {
    expect(() => Username.create('ab')).toThrow(InvalidIdentityValueError);
  });

  it('rejects a username longer than 32 characters', () => {
    expect(() => Username.create('a'.repeat(33))).toThrow(InvalidIdentityValueError);
  });

  it('rejects a username with invalid characters', () => {
    expect(() => Username.create('alice@home')).toThrow(InvalidIdentityValueError);
    expect(() => Username.create('al ice')).toThrow(InvalidIdentityValueError);
  });

  it('rejects an empty username', () => {
    expect(() => Username.create('')).toThrow(InvalidIdentityValueError);
  });

  it('compares for equality', () => {
    expect(Username.create('alice').equals(Username.create('alice'))).toBe(true);
    expect(Username.create('alice').equals(Username.create('bob'))).toBe(false);
  });
});

describe('DisplayName', () => {
  it('accepts a valid display name', () => {
    expect(DisplayName.create('Alice Smith').value).toBe('Alice Smith');
  });

  it('trims surrounding whitespace', () => {
    expect(DisplayName.create('  Alice  ').value).toBe('Alice');
  });

  it('rejects an empty display name', () => {
    expect(() => DisplayName.create('   ')).toThrow(InvalidIdentityValueError);
  });

  it('rejects a display name over 120 characters', () => {
    expect(() => DisplayName.create('a'.repeat(121))).toThrow(InvalidIdentityValueError);
  });
});

describe('PasswordHash', () => {
  it('stores algorithm and hash', () => {
    const hash = PasswordHash.create('argon2id', 's0me-hash');
    expect(hash.algorithm).toBe('argon2id');
    expect(hash.hash).toBe('s0me-hash');
  });

  it('rejects an empty hash', () => {
    expect(() => PasswordHash.create('bcrypt', '')).toThrow(InvalidIdentityValueError);
  });

  it('compares for equality', () => {
    expect(PasswordHash.create('scrypt', 'x').equals(PasswordHash.create('scrypt', 'x'))).toBe(
      true,
    );
    expect(PasswordHash.create('scrypt', 'x').equals(PasswordHash.create('bcrypt', 'x'))).toBe(
      false,
    );
  });
});

describe('UserStatus', () => {
  it('exposes the canonical statuses', () => {
    expect(UserStatus.pending().value).toBe('pending');
    expect(UserStatus.active().value).toBe('active');
    expect(UserStatus.suspended().value).toBe('suspended');
    expect(UserStatus.deactivated().value).toBe('deactivated');
  });

  it('parses a valid status', () => {
    expect(UserStatus.from('active').isActive()).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(() => UserStatus.from('archived')).toThrow(InvalidIdentityValueError);
  });

  it('only reports active as active', () => {
    expect(UserStatus.active().isActive()).toBe(true);
    expect(UserStatus.pending().isActive()).toBe(false);
    expect(UserStatus.suspended().isActive()).toBe(false);
    expect(UserStatus.deactivated().isActive()).toBe(false);
  });
});

describe('SessionStatus', () => {
  it('exposes the canonical statuses', () => {
    expect(SessionStatus.active().value).toBe('active');
    expect(SessionStatus.expired().value).toBe('expired');
    expect(SessionStatus.ended().value).toBe('ended');
    expect(SessionStatus.revoked().value).toBe('revoked');
  });

  it('rejects an unknown status', () => {
    expect(() => SessionStatus.from('sleeping')).toThrow(InvalidIdentityValueError);
  });

  it('only reports active as active', () => {
    expect(SessionStatus.active().isActive()).toBe(true);
    expect(SessionStatus.expired().isActive()).toBe(false);
    expect(SessionStatus.ended().isActive()).toBe(false);
    expect(SessionStatus.revoked().isActive()).toBe(false);
  });
});
