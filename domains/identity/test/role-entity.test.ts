/**
 * Role and Permission aggregate tests: validation, permission lifecycle,
 * and invariants.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import {
  DuplicatePermissionError,
  InvalidIdentityValueError,
  PermissionNotFoundError,
} from '../src/errors/index.js';
import { Permission } from '../src/entities/permission.js';
import { Role } from '../src/entities/role.js';
import { InMemoryRoleRepository } from './helpers.js';

describe('Permission entity', () => {
  it('creates a valid permission', () => {
    const permission = Permission.create({ name: 'projects.create', scopes: ['projects:write'] });
    expect(permission.name).toBe('projects.create');
    expect(permission.scopes).toEqual(['projects:write']);
    expect(permission.id).toMatch(/^per_/);
  });

  it('rejects an invalid permission name', () => {
    expect(() =>
      Permission.create({ name: 'Projects.Create', scopes: ['projects:write'] }),
    ).toThrow(InvalidIdentityValueError);
    expect(() => Permission.create({ name: '', scopes: ['projects:write'] })).toThrow(
      InvalidIdentityValueError,
    );
  });

  it('rejects a permission without scopes', () => {
    expect(() => Permission.create({ name: 'projects.read', scopes: [] })).toThrow(
      InvalidIdentityValueError,
    );
  });

  it('rejects an invalid scope', () => {
    expect(() => Permission.create({ name: 'projects.read', scopes: ['PROJECTS:READ'] })).toThrow(
      InvalidIdentityValueError,
    );
  });
});

describe('Role aggregate', () => {
  it('creates a valid role', () => {
    const role = Role.create({ name: 'workspace.admin', level: 'workspace' });
    expect(role.name).toBe('workspace.admin');
    expect(role.level).toBe('workspace');
    expect(role.approver).toBe(false);
  });

  it('creates an approver role', () => {
    const role = Role.create({ name: 'finance.approver', level: 'application', approver: true });
    expect(role.approver).toBe(true);
  });

  it('rejects an invalid role name', () => {
    expect(() => Role.create({ name: 'Admin', level: 'workspace' })).toThrow(
      InvalidIdentityValueError,
    );
    expect(() => Role.create({ name: '', level: 'workspace' })).toThrow(InvalidIdentityValueError);
  });

  it('rejects an invalid role level', () => {
    expect(() => Role.create({ name: 'workspace.admin', level: 'invalid' as never })).toThrow(
      InvalidIdentityValueError,
    );
  });

  it('grants permissions from creation input', () => {
    const role = Role.create({
      name: 'workspace.admin',
      level: 'workspace',
      permissions: [{ name: 'projects.create', scopes: ['projects:write'] }],
    });
    expect(role.hasPermission('projects.create')).toBe(true);
    expect(role.scopesFor('projects.create')).toEqual(['projects:write']);
  });

  it('grants a permission via the aggregate method', () => {
    const role = Role.create({ name: 'workspace.admin', level: 'workspace' });
    role.grantPermission('hr.manage', ['hr:write']);
    expect(role.hasPermission('hr.manage')).toBe(true);
  });

  it('rejects granting a duplicate permission', () => {
    const role = Role.create({ name: 'workspace.admin', level: 'workspace' });
    role.grantPermission('projects.create', ['projects:write']);
    expect(() => role.grantPermission('projects.create', ['projects:read'])).toThrow(
      DuplicatePermissionError,
    );
  });

  it('rejects granting an invalid permission', () => {
    const role = Role.create({ name: 'workspace.admin', level: 'workspace' });
    expect(() => role.grantPermission('bad name', ['projects:write'])).toThrow(
      InvalidIdentityValueError,
    );
  });

  it('revokes a permission', () => {
    const role = Role.create({
      name: 'workspace.admin',
      level: 'workspace',
      permissions: [{ name: 'projects.create', scopes: ['projects:write'] }],
    });
    role.revokePermission('projects.create');
    expect(role.hasPermission('projects.create')).toBe(false);
    expect(role.scopesFor('projects.create')).toEqual([]);
  });

  it('rejects revoking an unknown permission', () => {
    const role = Role.create({ name: 'workspace.admin', level: 'workspace' });
    expect(() => role.revokePermission('nope.nope')).toThrow(PermissionNotFoundError);
  });

  it('returns empty scopes for an unheld permission', () => {
    const role = Role.create({ name: 'workspace.admin', level: 'workspace' });
    expect(role.scopesFor('missing.permission')).toEqual([]);
  });

  it('exposes its permissions as a defensive copy', () => {
    const role = Role.create({
      name: 'workspace.admin',
      level: 'workspace',
      permissions: [{ name: 'projects.create', scopes: ['projects:write'] }],
    });
    const permissions = role.permissions;
    expect(permissions).toHaveLength(1);
    expect(permissions[0]?.name).toBe('projects.create');
  });

  it('bumps the version on permission changes', () => {
    const role = Role.create({ name: 'workspace.admin', level: 'workspace' });
    const v1 = role.version;
    role.grantPermission('projects.create', ['projects:write']);
    expect(role.version).toBeGreaterThan(v1);
  });

  it('carries an optional tenant scope', () => {
    const global = Role.create({ name: 'platform.admin', level: 'global' });
    expect(global.tenantId).toBeUndefined();
    const scoped = Role.create({
      name: 'workspace.admin',
      level: 'workspace',
      tenantId: 'tenant_1' as TenantId,
    });
    expect(scoped.tenantId).toBe('tenant_1');
    // Round-trips through snapshot/hydrate.
    const hydrated = Role.hydrate(Role.snapshot(scoped));
    expect(hydrated.tenantId).toBe('tenant_1');
  });

  it('listByTenant isolates roles: tenants see their own + platform-global only', async () => {
    const repository = new InMemoryRoleRepository();
    await repository.save(Role.create({ name: 'platform.admin', level: 'global' }));
    await repository.save(
      Role.create({
        name: 'workspace.admin',
        level: 'workspace',
        tenantId: 'tenant_1' as TenantId,
      }),
    );
    await repository.save(
      Role.create({
        name: 'finance.approver',
        level: 'application',
        tenantId: 'tenant_2' as TenantId,
      }),
    );

    const tenant1 = await repository.listByTenant('tenant_1' as TenantId);
    expect(tenant1.map((role) => role.name).sort()).toEqual(['platform.admin', 'workspace.admin']);
    const tenant2 = await repository.listByTenant('tenant_2' as TenantId);
    expect(tenant2.map((role) => role.name).sort()).toEqual(['finance.approver', 'platform.admin']);
  });
});
