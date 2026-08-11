/**
 * @nexora/application-organizations — CreateOrganizationHandler.
 *
 * The application entry point for organization creation: delegates to the
 * {@link OrganizationApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  CreateOrganizationCommand,
  CreateOrganizationResult,
} from '../commands/create-organization.command.js';
import type { CommandHandler } from '../commands/command-handler.js';
import type { OrganizationApplicationService } from '../services/organization-application-service.js';

/** Handles {@link CreateOrganizationCommand}. */
export class CreateOrganizationHandler implements CommandHandler<
  CreateOrganizationCommand,
  CreateOrganizationResult,
  NexoraError
> {
  readonly #service: OrganizationApplicationService;

  constructor(service: OrganizationApplicationService) {
    this.#service = service;
  }

  handle(
    command: CreateOrganizationCommand,
  ): Promise<Result<CreateOrganizationResult, NexoraError>> {
    return this.#service.createOrganization(command);
  }
}
