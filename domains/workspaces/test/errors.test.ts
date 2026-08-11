/**
 * Workspace error hierarchy tests: canonical codes, subclassing, and the
 * toWorkspaceError mapping.
 */

import { describe, expect, it } from 'vitest';
import { NexoraError, ValidationError } from '@nexora/shared/errors';

import {
  AgentAlreadyBoundError,
  AgentNotBoundError,
  InvalidWorkspaceValueError,
  isWorkspaceDomainError,
  KnowledgeAlreadyAttachedError,
  KnowledgeNotAttachedError,
  LastOwnerRemovalError,
  MemberAlreadyExistsError,
  MemberNotFoundError,
  PluginAlreadyInstalledError,
  PluginNotFoundError,
  SlugAlreadyExistsError,
  toWorkspaceError,
  WorkflowAlreadyAttachedError,
  WorkflowNotAttachedError,
  WorkspaceArchivedError,
  WorkspaceDomainError,
  WorkspaceNotFoundError,
  WorkspaceNotActiveError,
  WorkspaceStateTransitionError,
} from '../src/errors/index.js';

describe('WorkspaceDomainError hierarchy', () => {
  it('extends the shared NexoraError hierarchy', () => {
    expect(new WorkspaceDomainError('boom') instanceof NexoraError).toBe(true);
  });

  it('defaults to the business-rule code', () => {
    expect(new WorkspaceDomainError('boom').code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('assigns canonical codes', () => {
    expect(new WorkspaceNotFoundError().code).toBe('NOT_FOUND');
    expect(new SlugAlreadyExistsError().code).toBe('CONFLICT');
    expect(new MemberNotFoundError().code).toBe('NOT_FOUND');
    expect(new MemberAlreadyExistsError().code).toBe('CONFLICT');
    expect(new PluginNotFoundError().code).toBe('NOT_FOUND');
    expect(new PluginAlreadyInstalledError().code).toBe('CONFLICT');
    expect(new AgentAlreadyBoundError().code).toBe('CONFLICT');
    expect(new AgentNotBoundError().code).toBe('NOT_FOUND');
    expect(new KnowledgeAlreadyAttachedError().code).toBe('CONFLICT');
    expect(new KnowledgeNotAttachedError().code).toBe('NOT_FOUND');
    expect(new WorkflowAlreadyAttachedError().code).toBe('CONFLICT');
    expect(new WorkflowNotAttachedError().code).toBe('NOT_FOUND');
    expect(new WorkspaceNotActiveError().code).toBe('BUSINESS_RULE_VIOLATION');
    expect(new WorkspaceArchivedError().code).toBe('BUSINESS_RULE_VIOLATION');
    expect(new LastOwnerRemovalError().code).toBe('BUSINESS_RULE_VIOLATION');
    expect(new WorkspaceStateTransitionError('x').code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('InvalidWorkspaceValueError carries the canonical validation code and issues', () => {
    const error = new InvalidWorkspaceValueError('Invalid slug', [
      { path: 'slug', message: 'bad' },
    ]);
    expect(error instanceof WorkspaceDomainError).toBe(true);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.issues).toEqual([{ path: 'slug', message: 'bad' }]);
  });
});

describe('isWorkspaceDomainError', () => {
  it('narrows workspace errors', () => {
    expect(isWorkspaceDomainError(new WorkspaceNotFoundError())).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isWorkspaceDomainError(new Error('x'))).toBe(false);
    expect(isWorkspaceDomainError('string')).toBe(false);
    expect(isWorkspaceDomainError(undefined)).toBe(false);
  });
});

describe('toWorkspaceError', () => {
  it('passes workspace errors through unchanged', () => {
    const error = new WorkspaceNotFoundError({ workspaceId: 'wsp_1' });
    expect(toWorkspaceError(error)).toBe(error);
  });

  it('maps shared ValidationError into InvalidWorkspaceValueError', () => {
    const validation = new ValidationError('bad', [{ path: 'slug', message: 'no' }]);
    const mapped = toWorkspaceError(validation) as InvalidWorkspaceValueError;
    expect(mapped).toBeInstanceOf(InvalidWorkspaceValueError);
    expect(mapped.issues).toEqual([{ path: 'slug', message: 'no' }]);
  });

  it('wraps plain errors and non-error values as INTERNAL_ERROR', () => {
    expect(toWorkspaceError(new Error('db down')).code).toBe('INTERNAL_ERROR');
    expect(toWorkspaceError('boom').code).toBe('INTERNAL_ERROR');
    expect(toWorkspaceError(undefined).code).toBe('INTERNAL_ERROR');
  });
});
