/**
 * S24 Phase 2 — command-center validation tests: widget/action integrity,
 * unsupported widget types and data sources, and role → domain cross-checks
 * against the Phase 1 catalog. All validation is registration-time —
 * invalid configuration is never discovered mid-request.
 */

import { describe, expect, it } from 'vitest';
import { createInitialCatalog } from '@nexora/module-domains';
import type { CommandCenterDefinition } from '@nexora/contracts/command-center';

import { CommandCenterRegistry } from '../src/registry/command-center-registry.js';
import { InvalidCommandCenterError, UnknownRoleReferenceError } from '../src/errors.js';

const BASE_CENTER: CommandCenterDefinition = {
  id: 'ceo',
  name: 'Command Center',
  domainId: 'executive',
  roleId: 'executive.ceo',
  widgets: [
    {
      id: 'projects_kpi',
      type: 'kpi',
      title: 'Projects',
      dataSource: 'measurements.overview.projects',
      span: 1,
    },
  ],
  actions: [
    { id: 'view_projects', label: 'View projects', kind: 'navigate', href: '/app/projects' },
  ],
};

function makeRegistry(): CommandCenterRegistry {
  return new CommandCenterRegistry(createInitialCatalog());
}

function expectInvalid(def: CommandCenterDefinition, message: string): void {
  const registry = makeRegistry();
  let caught: unknown;
  try {
    registry.register(def);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(InvalidCommandCenterError);
  // Detailed field messages live in `issues` (Phase 1 convention) — the
  // error message itself is the short `Invalid command-center definition`.
  const error = caught as InvalidCommandCenterError;
  expect(error.issues.some((issue) => message.test(issue.message))).toBe(true);
}

describe('CommandCenterDefinition validation (S24 Phase 2)', () => {
  it('rejects a command center referencing an unknown domain', () => {
    expect(() =>
      makeRegistry().register({
        ...BASE_CENTER,
        domainId: 'nonexistent',
        roleId: 'nonexistent.role',
      }),
    ).toThrow(UnknownRoleReferenceError);
  });

  it('rejects a command center referencing an unknown role', () => {
    expect(() =>
      makeRegistry().register({ ...BASE_CENTER, roleId: 'executive.not_a_role' }),
    ).toThrow(UnknownRoleReferenceError);
  });

  it('rejects a command center binding a role of another domain', () => {
    expect(() =>
      makeRegistry().register({
        ...BASE_CENTER,
        domainId: 'executive',
        roleId: 'technology.developer',
      }),
    ).toThrow(UnknownRoleReferenceError);
  });

  it('rejects duplicate widget ids within a command center', () => {
    expectInvalid(
      {
        ...BASE_CENTER,
        widgets: [
          BASE_CENTER.widgets[0],
          { id: 'projects_kpi', type: 'list', title: 'Projects', dataSource: 'projects.list' },
        ],
      },
      /Duplicate widget 'projects_kpi'/,
    );
  });

  it('rejects duplicate action ids within a command center', () => {
    expectInvalid(
      {
        ...BASE_CENTER,
        actions: [
          BASE_CENTER.actions[0],
          { id: 'view_projects', label: 'View projects', kind: 'navigate', href: '/app/projects' },
        ],
      },
      /Duplicate action 'view_projects'/,
    );
  });

  it('rejects an unsupported widget type', () => {
    expectInvalid(
      {
        ...BASE_CENTER,
        widgets: [{ id: 'w', type: 'chart' as never, title: 'Chart', dataSource: 'projects.list' }],
      },
      /Unsupported widget type 'chart'/,
    );
  });

  it('rejects an unsupported data source', () => {
    expectInvalid(
      {
        ...BASE_CENTER,
        widgets: [{ id: 'w', type: 'list', title: 'W', dataSource: 'invented.source' }],
      },
      /Unsupported data source 'invented.source'/,
    );
  });

  it('rejects a non-navigate action kind', () => {
    expectInvalid(
      {
        ...BASE_CENTER,
        actions: [{ id: 'a', label: 'Run', kind: 'execute' as never, href: '/app/projects' }],
      },
      /Unsupported action kind 'execute'/,
    );
  });

  it('rejects an invalid command-center id', () => {
    expectInvalid({ ...BASE_CENTER, id: 'Ceo Center' }, /Invalid command-center id/);
  });
});
