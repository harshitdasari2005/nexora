/**
 * @nexora/domain-identity — services barrel.
 */

export {
  UserDomainService,
  type UserDomainServiceDependencies,
  type RegisterUserInput,
  type UserCommandResult,
} from './user-domain-service.js';
export {
  SessionDomainService,
  type SessionDomainServiceDependencies,
  type StartSessionCredentials,
  type SessionCommandResult,
} from './session-domain-service.js';
export {
  PermissionDomainService,
  type PermissionDomainServiceDependencies,
  type PermissionRequest,
} from './permission-domain-service.js';
