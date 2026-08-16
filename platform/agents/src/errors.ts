/**
 * @nexora/module-agents — agent errors (S26 Phase 8).
 *
 * Registration-time errors: invalid definitions and unknown references fail
 * fast at startup, never mid-request. Resolution of an unknown role fails
 * safely (no agent) rather than throwing.
 */

import type { BusinessAgentId } from '@nexora/contracts/agent';

/** Base agent error. */
export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentError';
  }
}

/** A duplicate agent id was registered. */
export class DuplicateAgentError extends AgentError {
  constructor(id: BusinessAgentId) {
    super(`Agent already registered: ${id}`);
    this.name = 'DuplicateAgentError';
  }
}

/** The agent definition failed validation. */
export class InvalidAgentError extends AgentError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAgentError';
  }
}

/** The agent references an unknown role or domain. */
export class UnknownRoleReferenceError extends AgentError {
  constructor(roleId: string) {
    super(`Agent references an unknown role: ${roleId}`);
    this.name = 'UnknownRoleReferenceError';
  }
}

/** Maps an error to a stable agent error code (for API surfaces). */
export function toAgentError(error: unknown): AgentError {
  if (error instanceof AgentError) {
    return error;
  }
  return new AgentError(error instanceof Error ? error.message : 'Agent error');
}
