# Changelog

All notable changes to `@nexora/application-identity` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `AuthenticateWithOidc` use case: idempotent user provisioning from verified
  OIDC claims + session issuance for the verified principal
  (`SessionDomainService.startVerified`).
- `EndSession` use case (logout).
- `GetCurrentUser` query with `UserDto`.
- Command/query handler contracts, validators, and the
  `IdentityApplicationService` orchestrator with `EventPublisher` integration.
