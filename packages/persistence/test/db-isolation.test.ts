/**
 * Regression tests for database-test isolation (product stabilization).
 *
 * Guards the destructive repository integration suite: it must NEVER run
 * against the live dev database (`nexora`), and it must target a dedicated
 * test database by default.
 */

import { describe, expect, it } from 'vitest';

import {
  LIVE_DATABASE_NAME,
  databaseNameOf,
  maintenanceUrlOf,
  resolveTestDatabaseUrl,
} from './db-isolation.js';

const LIVE_URL = 'postgres://nexora:nexora_dev_password@localhost:5433/nexora';
const TEST_URL = 'postgres://nexora:nexora_dev_password@localhost:5433/nexora_test';

describe('db-isolation (stabilization)', () => {
  it('extracts the database name from a connection string', () => {
    expect(databaseNameOf(LIVE_URL)).toBe(LIVE_DATABASE_NAME);
    expect(databaseNameOf(TEST_URL)).toBe('nexora_test');
    expect(databaseNameOf('postgres://user:pass@host:5432')).toBeNull();
    expect(databaseNameOf('not-a-url')).toBeNull();
  });

  it('defaults to a dedicated test database when no env is set', () => {
    const resolved = resolveTestDatabaseUrl({});
    expect(databaseNameOf(resolved)).toBe('nexora_test');
    expect(resolved).not.toBe(LIVE_URL);
  });

  it('honours TEST_DATABASE_URL when set', () => {
    const custom = 'postgres://ci:ci@db.example.com:5432/ci_test';
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: custom })).toBe(custom);
  });

  it('honours DATABASE_URL when TEST_DATABASE_URL is unset', () => {
    const custom = 'postgres://dev:dev@localhost:5433/custom_test';
    expect(resolveTestDatabaseUrl({ DATABASE_URL: custom })).toBe(custom);
  });

  it('refuses to run against the live dev database', () => {
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL: LIVE_URL })).toThrow(LIVE_DATABASE_NAME);
  });

  it('redirects the maintenance connection to the postgres database', () => {
    expect(databaseNameOf(maintenanceUrlOf(TEST_URL))).toBe('postgres');
  });
});
