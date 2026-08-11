/**
 * @nexora/application-knowledge — RetrieveKnowledge validator.
 *
 * Validates the user-controlled search question BEFORE retrieval (fail
 * fast). Scope fields (tenant + workspace) arrive via the trusted context
 * and are never validated from user input.
 */

import { ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';

import type { RetrieveKnowledgeQuery } from '../queries/retrieve-knowledge.query.js';

/** The maximum question length (bounded before any scoring). */
export const KNOWLEDGE_QUERY_MAX_LENGTH = 500;

/** Validates a {@link RetrieveKnowledgeQuery}; throws {@link ValidationError}. */
export function validateRetrieveKnowledge(query: RetrieveKnowledgeQuery): void {
  const issues: FieldIssue[] = [];
  const trimmed = query.query.trim();
  if (trimmed.length === 0) {
    issues.push({ path: 'query', message: 'A question is required' });
  } else if (trimmed.length > KNOWLEDGE_QUERY_MAX_LENGTH) {
    issues.push({
      path: 'query',
      message: `Question must be at most ${KNOWLEDGE_QUERY_MAX_LENGTH} characters`,
    });
  }
  if (issues.length > 0) {
    throw new ValidationError('Invalid knowledge query', issues);
  }
}
