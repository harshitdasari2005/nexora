/**
 * @nexora/app-web — OrganizationWizard.
 *
 * Step 1 of onboarding (FRONTEND.md §5): create the organization. On success
 * the flow continues to the workspace wizard with the new organization id.
 */

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Field, Input, Select, Stack, typography } from '@nexora/design-system';

import { api, ApiError } from '../../lib/api.js';
import { slugify, validateOnboardingForm } from '../../lib/validation.js';
import type { OrganizationDto } from '../../lib/types.js';
import { OnboardingFrame } from './frame.js';

const ORGANIZATION_TYPES = [
  'enterprise',
  'smb',
  'startup',
  'non_profit',
  'government',
  'other',
] as const;

/** The organization setup wizard. */
export function OrganizationWizard(): JSX.Element {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState('startup');
  const [description, setDescription] = useState('');
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const updateName = (value: string): void => {
    setName(value);
    if (slug === '' || slug === slugify(name)) {
      setSlug(slugify(value));
    }
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const validation = validateOnboardingForm({ name, slug, type });
    setIssues(validation);
    if (validation.length > 0) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await api<{ organization: OrganizationDto }>('/organizations', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim().toLowerCase(),
          type,
          description: description.trim() === '' ? undefined : description.trim(),
        }),
      });
      navigate(
        `/onboarding/workspace?organizationId=${encodeURIComponent(created.organization.id)}`,
      );
    } catch (error) {
      setSubmitError(
        error instanceof ApiError ? error.message : 'Could not create the organization.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const issueFor = (field: string): string | undefined =>
    issues.find((issue) => issue.field === field)?.message;

  return (
    <OnboardingFrame step={1}>
      <Card padding={8} elevationLevel="md">
        <form onSubmit={(event) => void handleSubmit(event)}>
          <Stack gap={5} stretch>
            <Stack gap={1}>
              <h1 style={{ fontSize: typography.sizes.xl, fontWeight: typography.weights.bold }}>
                Create your organization
              </h1>
              <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
                Your organization is the workspace of your whole company. You can add members and
                apps after onboarding.
              </p>
            </Stack>

            <Field label="Organization name" required error={issueFor('name')}>
              <Input
                value={name}
                onChange={(event) => updateName(event.target.value)}
                placeholder="Acme Inc."
                invalid={issueFor('name') !== undefined}
              />
            </Field>

            <Field
              label="Slug"
              required
              hint="Used in URLs and identifiers."
              error={issueFor('slug')}
            >
              <Input
                value={slug}
                onChange={(event) => setSlug(slugify(event.target.value))}
                placeholder="acme"
                invalid={issueFor('slug') !== undefined}
              />
            </Field>

            <Field label="Organization type" required error={issueFor('type')}>
              <Select
                value={type}
                onChange={(event) => setType(event.target.value)}
                invalid={issueFor('type') !== undefined}
              >
                {ORGANIZATION_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {option.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Description (optional)">
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What does your organization do?"
              />
            </Field>

            {submitError !== null ? (
              <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
                {submitError}
              </p>
            ) : null}

            <Button type="submit" size="lg" fullWidth loading={submitting}>
              Continue
            </Button>
          </Stack>
        </form>
      </Card>
    </OnboardingFrame>
  );
}
