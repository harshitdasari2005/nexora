/**
 * @nexora/application-documents — UploadDocument validator.
 *
 * Validates the user-controlled upload fields BEFORE the application
 * service touches storage or the domain (fail fast; no partial state).
 * Identity/tenant/workspace arrive via the trusted context — the validator
 * only checks business values and content bounds.
 */

import { ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';

import type { UploadDocumentCommand } from '../commands/upload-document.command.js';

/** The maximum upload size (5 MiB — a safety bound, not a product limit). */
export const DOCUMENT_CONTENT_MAX_BYTES = 5 * 1024 * 1024;
/** The maximum title length (mirrors the domain value object). */
export const DOCUMENT_TITLE_MAX_LENGTH = 200;

/** Validates an {@link UploadDocumentCommand}; throws {@link ValidationError}. */
export function validateUploadDocument(command: UploadDocumentCommand): void {
  const issues: FieldIssue[] = [];
  const title = command.title.trim();
  if (title.length === 0) {
    issues.push({ path: 'title', message: 'A document title is required' });
  } else if (title.length > DOCUMENT_TITLE_MAX_LENGTH) {
    issues.push({
      path: 'title',
      message: `Title must be at most ${DOCUMENT_TITLE_MAX_LENGTH} characters`,
    });
  }
  if (command.workspaceId.trim().length === 0) {
    issues.push({ path: 'workspaceId', message: 'A workspace is required' });
  }
  if (command.contentType.trim().length === 0) {
    issues.push({ path: 'contentType', message: 'A content type is required' });
  }
  if (command.content.byteLength === 0) {
    issues.push({ path: 'content', message: 'The document is empty' });
  } else if (command.content.byteLength > DOCUMENT_CONTENT_MAX_BYTES) {
    issues.push({ path: 'content', message: 'The document exceeds the 5 MiB upload limit' });
  }
  if (issues.length > 0) {
    throw new ValidationError('Invalid document upload', issues);
  }
}
