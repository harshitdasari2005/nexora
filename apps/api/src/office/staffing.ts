/**
 * @nexora/app-api — which seats of an organization somebody holds.
 *
 * A young organization does not have every department yet. A workflow stage
 * whose seat NOBODY holds would wait for ever, so it falls to the chief
 * executive until that seat is filled (see request-authority.ts). This reads
 * who holds what, from the same trusted membership the role resolver uses:
 * team type × seat → business role → capabilities.
 */

import type { TenantId } from '@nexora/contracts/common';
import type { WorkspaceMembershipRepository, WorkspaceRepository } from '@nexora/domain-workspaces';
import type { DomainCatalog } from '@nexora/module-domains';

import { businessRoleForSeat } from '../business-context/business-role-resolver.js';

/** The capabilities held in an organization, overall and team by team. */
export interface StaffingSnapshot {
  /** Every capability somebody in the organization holds. */
  organization: ReadonlySet<string>;
  /** The capabilities held inside each team. */
  byTeam: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Reads an organization's staffing. */
export interface Staffing {
  read(organizationId: string): Promise<StaffingSnapshot>;
}

export interface StaffingDependencies {
  workspaces: WorkspaceRepository;
  workspaceMemberships: WorkspaceMembershipRepository;
  catalog: DomainCatalog;
}

/** Builds the staffing reader over the trusted membership records. */
export function createStaffing(dependencies: StaffingDependencies): Staffing {
  return {
    async read(organizationId) {
      const organization = new Set<string>();
      const byTeam = new Map<string, Set<string>>();
      const teams = await dependencies.workspaces.listByOrganization(organizationId as TenantId);
      for (const team of teams) {
        const held = new Set<string>();
        for (const membership of await dependencies.workspaceMemberships.listByWorkspace(team.id)) {
          const roleId = businessRoleForSeat(team.type.value, membership.role);
          const role = roleId === undefined ? undefined : dependencies.catalog.roles.get(roleId);
          for (const capability of role?.capabilityIds ?? []) {
            held.add(capability);
            organization.add(capability);
          }
        }
        byTeam.set(team.id, held);
      }
      return { organization, byTeam };
    },
  };
}
