/**
 * @nexora/application-knowledge — UpdateArticle validator.
 *
 * Validates the user-controlled article fields BEFORE the domain is touched
 * (fail fast). The article id is validated structurally here; the trusted
 * scope resolution happens in the application service.
 */

import { ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';

import type { UpdateArticleCommand } from '../commands/update-article.command.js';
import { ARTICLE_BODY_MAX_LENGTH, ARTICLE_TITLE_MAX_LENGTH } from './create-article.validator.js';

/** Validates a {@link UpdateArticleCommand}; throws {@link ValidationError}. */
export function validateUpdateArticle(command: UpdateArticleCommand): void {
  const issues: FieldIssue[] = [];
  if (command.articleId.trim().length === 0) {
    issues.push({ path: 'articleId', message: 'An article id is required' });
  }
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
    throw new ValidationError('Invalid knowledge article update', issues);
  }
}
