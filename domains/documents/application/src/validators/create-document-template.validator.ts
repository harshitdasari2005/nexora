/**
 * @nexora/application-documents — CreateDocumentTemplate validator.
 *
 * Validates the user-controlled template fields BEFORE the application
 * service touches storage or the domain. Identity/tenant/workspace arrive
 * via the trusted context — the validator only checks business values and
 * content bounds.
 */

import { ValidationError } from '@nexora/shared/errors';
import type { FieldIssue } from '@nexora/shared/errors';

import type { CreateDocumentTemplateCommand } from '../commands/create-document-template.command.js';
import { DOCUMENT_CONTENT_MAX_BYTES } from './upload-document.validator.js';

/** The maximum template name length (mirrors the domain value object). */
export const DOCUMENT_TEMPLATE_NAME_MAX_LENGTH = 200;
/** The maximum template description length (mirrors the domain value object). */
export const DOCUMENT_TEMPLATE_DESCRIPTION_MAX_LENGTH = 2_000;

/** Validates a {@link CreateDocumentTemplateCommand}; throws {@link ValidationError}. */
export function validateCreateDocumentTemplate(command: CreateDocumentTemplateCommand): void {
  const issues: FieldIssue[] = [];
  const name = command.name.trim();
  if (name.length === 0) {
    issues.push({ path: 'name', message: 'A template name is required' });
  } else if (name.length > DOCUMENT_TEMPLATE_NAME_MAX_LENGTH) {
    issues.push({
      path: 'name',
      message: `Name must be at most ${DOCUMENT_TEMPLATE_NAME_MAX_LENGTH} characters`,
    });
  }
  if (
    command.description !== undefined &&
    command.description.length > DOCUMENT_TEMPLATE_DESCRIPTION_MAX_LENGTH
  ) {
    issues.push({
      path: 'description',
      message: `Description must be at most ${DOCUMENT_TEMPLATE_DESCRIPTION_MAX_LENGTH} characters`,
    });
  }
  if (command.workspaceId.trim().length === 0) {
    issues.push({ path: 'workspaceId', message: 'A workspace is required' });
  }
  if (command.contentType.trim().length === 0) {
    issues.push({ path: 'contentType', message: 'A content type is required' });
  }
  if (command.content.byteLength === 0) {
    issues.push({ path: 'content', message: 'The template content is empty' });
  } else if (command.content.byteLength > DOCUMENT_CONTENT_MAX_BYTES) {
    issues.push({ path: 'content', message: 'The template exceeds the 5 MiB upload limit' });
  }
  if (issues.length > 0) {
    throw new ValidationError('Invalid document template', issues);
  }
}
