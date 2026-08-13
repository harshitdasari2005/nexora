/**
 * @nexora/application-documents — UploadDocumentVersion validator.
 *
 * Validates the user-controlled revision fields BEFORE the application
 * service touches storage or the domain. Identity/tenant/workspace arrive
 * via the trusted context — the validator only checks business values and
 * content bounds (the same bounds as a first upload).
 */

import { ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';

import type { UploadDocumentVersionCommand } from '../commands/upload-document-version.command.js';
import { DOCUMENT_CONTENT_MAX_BYTES } from './upload-document.validator.js';

/** Validates an {@link UploadDocumentVersionCommand}; throws {@link ValidationError}. */
export function validateUploadDocumentVersion(command: UploadDocumentVersionCommand): void {
  const issues: FieldIssue[] = [];
  if (command.documentId.trim().length === 0) {
    issues.push({ path: 'documentId', message: 'A document id is required' });
  }
  if (command.workspaceId.trim().length === 0) {
    issues.push({ path: 'workspaceId', message: 'A workspace is required' });
  }
  if (command.contentType.trim().length === 0) {
    issues.push({ path: 'contentType', message: 'A content type is required' });
  }
  if (command.content.byteLength === 0) {
    issues.push({ path: 'content', message: 'The new version is empty' });
  } else if (command.content.byteLength > DOCUMENT_CONTENT_MAX_BYTES) {
    issues.push({ path: 'content', message: 'The new version exceeds the 5 MiB upload limit' });
  }
  if (issues.length > 0) {
    throw new ValidationError('Invalid document version upload', issues);
  }
}
