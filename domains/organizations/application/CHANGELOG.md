# Changelog

All notable changes to `@nexora/application-organizations` are documented
here. The format follows [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `CreateOrganization` use case: provision (create → activate) a new
  organization and add the creator as the first owner.
- `ListOrganizations` query with `OrganizationDto`.
- Command handler contract, validator, and the
  `OrganizationApplicationService` orchestrator with `EventPublisher`
  integration.
