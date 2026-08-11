/**
 * @nexora/application-identity — GetCurrentUserHandler.
 *
 * Resolves the current user DTO via the {@link IdentityApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { UserNotFoundError } from '@nexora/domain-identity';

import type {
  GetCurrentUserQuery,
  GetCurrentUserResult,
} from '../queries/get-current-user.query.js';
import type { IdentityApplicationService } from '../services/identity-application-service.js';

/** Handles {@link GetCurrentUserQuery}. */
export class GetCurrentUserHandler {
  readonly #service: IdentityApplicationService;

  constructor(service: IdentityApplicationService) {
    this.#service = service;
  }

  handle(query: GetCurrentUserQuery): Promise<Result<GetCurrentUserResult, UserNotFoundError>> {
    return this.#service.getCurrentUser(query.userId);
  }
}
