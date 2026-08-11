# Changelog

All notable changes to `@nexora/application-workspaces` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `CreateWorkspace` use case: provision (create → activate) a new workspace
  and add the creator as the first owner.
- `ListWorkspaces` query with `WorkspaceDto`.
- Command handler contract, validator, and the
  `WorkspaceApplicationService` orchestrator with `EventPublisher`
  integration.
