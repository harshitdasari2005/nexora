/**
 * @nexora/app-web — form validation.
 *
 * Pure client-side validators for the onboarding wizards. The server
 * remains authoritative (the API re-validates); these only give instant
 * feedback (FRONTEND.md §8 security UX, §10 forms).
 */

/** A field-scoped validation issue. */
export interface FormIssue {
  /** Field name. */
  field: string;
  /** Human-readable message. */
  message: string;
}

/** The shape of both onboarding forms. */
export interface FormValues {
  name: string;
  slug: string;
  type: string;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** Sluggifies a name for auto-suggestion. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Validates an organization/workspace form. */
export function validateOnboardingForm(values: FormValues): FormIssue[] {
  const issues: FormIssue[] = [];

  if (values.name.trim().length === 0) {
    issues.push({ field: 'name', message: 'Name is required' });
  } else if (values.name.trim().length > 80) {
    issues.push({ field: 'name', message: 'Name must be at most 80 characters' });
  }

  const slug = values.slug.trim().toLowerCase();
  if (slug.length === 0) {
    issues.push({ field: 'slug', message: 'Slug is required' });
  } else if (!SLUG_PATTERN.test(slug)) {
    issues.push({
      field: 'slug',
      message: 'Use lowercase letters, digits, and hyphens (2–63 characters)',
    });
  }

  if (values.type.length === 0) {
    issues.push({ field: 'type', message: 'Select a type' });
  }

  return issues;
}
