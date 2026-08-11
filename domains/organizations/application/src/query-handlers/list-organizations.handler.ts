/**
 * @nexora/application-organizations — ListOrganizationsHandler.
 *
 * Resolves the organizations of a user via the
 * {@link OrganizationApplicationService}.
 */

import type { Result } from '@nexora/shared/result';

import type {
  ListOrganizationsQuery,
  ListOrganizationsResult,
} from '../queries/list-organizations.query.js';
import type { OrganizationApplicationService } from '../services/organization-application-service.js';

/** Handles {@link ListOrganizationsQuery}. */
export class ListOrganizationsHandler {
  readonly #service: OrganizationApplicationService;

  constructor(service: OrganizationApplicationService) {
    this.#service = service;
  }

  handle(query: ListOrganizationsQuery): Promise<Result<ListOrganizationsResult, never>> {
    return this.#service.listOrganizationsByUser(query.userId);
  }
}
