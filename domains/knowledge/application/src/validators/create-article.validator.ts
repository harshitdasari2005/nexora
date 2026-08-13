/**
 * @nexora/application-knowledge — CreateArticle validator.
 *
 * Validates the user-controlled article fields BEFORE the domain is touched
 * (fail fast). Scope fields (tenant + workspace) arrive via the trusted
 * context and are never validated from user input.
 */

import { ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';

import type { CreateArticleCommand } from '../commands/create-article.command.js';

/** The maximum article title length (mirrors the domain). */
export const ARTICLE_TITLE_MAX_LENGTH = 200;
/** The maximum article body length (mirrors the domain). */
export const ARTICLE_BODY_MAX_LENGTH = 100_000;

/** Validates a {@link CreateArticleCommand}; throws {@link ValidationError}. */
export function validateCreateArticle(command: CreateArticleCommand): void {
  const issues: FieldIssue[] = [];
  const title = command.title.trim();
  if (title.length === 0) {
    issues.push({ path: 'title', message: 'A title is required' });
  } else if (title.length > ARTICLE_TITLE_MAX_LENGTH) {
    issues.push({
      path: 'title',
      message: `Title must be at most ${ARTICLE_TITLE_MAX_LENGTH} characters`,
    });
  }
  const body = command.body.trim();
  if (body.length === 0) {
    issues.push({ path: 'body', message: 'A body is required' });
  } else if (body.length > ARTICLE_BODY_MAX_LENGTH) {
    issues.push({
      path: 'body',
      message: `Body must be at most ${ARTICLE_BODY_MAX_LENGTH} characters`,
    });
  }
  if (issues.length > 0) {
    throw new ValidationError('Invalid knowledge article', issues);
  }
}
