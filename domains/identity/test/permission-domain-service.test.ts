/**
 * PermissionDomainService tests: permission evaluation, scopes, effective
 * permissions, and role resolution errors.
 */

import { describe, expect, it } from 'vitest';

import { RoleNotFoundError } from '../src/errors/index.js';
import { PermissionDomainService } from '../src/services/index.js';
import { Role } from '../src/entities/role.js';
import { InMemoryRoleRepository } from './helpers.js';

function makeService(): {
  service: PermissionDomainService;
  roles: InMemoryRoleRepository;
} {
  const roles = new InMemoryRoleRepository();
  const service = new PermissionDomainService({ roles });
  return { service, roles };
}

function seedRoles(roles: InMemoryRoleRepository): void {
  roles.save(
    Role.create({
      name: 'workspace.admin',
      level: 'workspace',
      permissions: [
        { name: 'projects.create', scopes: ['projects:write'] },
        { name: 'projects.read', scopes: ['projects:read'] },
      ],
    }),
  );
  roles.save(
    Role.create({
      name: 'hr.approver',
      level: 'application',
      approver: true,
      permissions: [{ name: 'leave.approve', scopes: ['hr:write'] }],
    }),
  );
}

describe('PermissionDomainService.can', () => {
  it('allows a permission granted by a role', async () => {
    const { service, roles } = makeService();
    seedRoles(roles);
    const result = await service.can(['workspace.admin'], { name: 'projects.create' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.allowed).toBe(true);
    }
  });

  it('denies a permission not held by any role', async () => {
    const { service, roles } = makeService();
    seedRoles(roles);
    const result = await service.can(['workspace.admin'], { name: 'finance.review' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.allowed).toBe(false);
      expect(result.value.grantedBy).toBeUndefined();
    }
  });

  it('denies when the required scope is not granted', async () => {
    const { service, roles } = makeService();
    seedRoles(roles);
    const result = await service.can(['workspace.admin'], {
      name: 'projects.create',
      scopes: ['projects:delete'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.allowed).toBe(false);
    }
  });

  it('allows when a required scope is granted', async () => {
    const { service, roles } = makeService();
    seedRoles(roles);
    const result = await service.can(['workspace.admin'], {
      name: 'projects.create',
      scopes: ['projects:write'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.allowed).toBe(true);
      expect(result.value.grantedBy).toContain('projects:write');
    }
  });

  it('allows with an empty scope requirement when the name is held', async () => {
    const { service, roles } = makeService();
    seedRoles(roles);
    const result = await service.can(['hr.approver'], { name: 'leave.approve' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.allowed).toBe(true);
    }
  });

  it('requires every role to resolve', async () => {
    const { service, roles } = makeService();
    seedRoles(roles);
    const result = await service.can(['workspace.admin', 'ghost.role'], {
      name: 'projects.create',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(RoleNotFoundError);
    }
  });

  it('denies for an empty role set', async () => {
    const { service } = makeService();
    const result = await service.can([], { name: 'projects.create' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.allowed).toBe(false);
    }
  });
});

describe('PermissionDomainService.effectivePermissions', () => {
  it('unions permissions across roles, deduplicated by name', async () => {
    const { service, roles } = makeService();
    seedRoles(roles);
    roles.save(
      Role.create({
        name: 'contractor',
        level: 'workspace',
        permissions: [{ name: 'projects.read', scopes: ['projects:read'] }],
      }),
    );
    const result = await service.effectivePermissions(['workspace.admin', 'contractor']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const names = result.value.map((permission) => permission.name);
      expect(names).toContain('projects.create');
      expect(names).toContain('projects.read');
      expect(names.filter((name) => name === 'projects.read')).toHaveLength(1);
    }
  });

  it('returns an empty set for no roles', async () => {
    const { service } = makeService();
    const result = await service.effectivePermissions([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it('fails when a role is missing', async () => {
    const { service } = makeService();
    const result = await service.effectivePermissions(['missing.role']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(RoleNotFoundError);
    }
  });
});
