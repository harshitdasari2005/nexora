/**
 * @nexora/app-web — WorkspaceWizard.
 *
 * Step 2 of onboarding (FRONTEND.md §5): create the first workspace inside
 * the organization created in step 1.
 */

import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Field, Input, Select, Stack, typography } from '@nexora/design-system';

import { api, ApiError } from '../../lib/api.js';
import { slugify, validateOnboardingForm } from '../../lib/validation.js';
import type { WorkspaceDto } from '../../lib/types.js';
import { OnboardingFrame } from './frame.js';

const WORKSPACE_TYPES = [
  'operations',
  'engineering',
  'hr',
  'finance',
  'sales',
  'marketing',
  'executive',
  'general',
] as const;

/** The workspace setup wizard. */
export function WorkspaceWizard(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const organizationId = searchParams.get('organizationId') ?? '';

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState('engineering');
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
    if (validation.length > 0 || organizationId.length === 0) {
      if (organizationId.length === 0) {
        setSubmitError('Missing organization context — please start from step 1.');
      }
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await api<{ workspace: WorkspaceDto }>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          name: name.trim(),
          slug: slug.trim().toLowerCase(),
          type,
        }),
      });
      navigate(
        `/app?organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(
          created.workspace.id,
        )}`,
      );
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Could not create the workspace.');
    } finally {
      setSubmitting(false);
    }
  };

  const issueFor = (field: string): string | undefined =>
    issues.find((issue) => issue.field === field)?.message;

  return (
    <OnboardingFrame step={2}>
      <Card padding={8} elevationLevel="md">
        <form onSubmit={(event) => void handleSubmit(event)}>
          <Stack gap={5} stretch>
            <Stack gap={1}>
              <h1 style={{ fontSize: typography.sizes.xl, fontWeight: typography.weights.bold }}>
                Create your first workspace
              </h1>
              <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
                Workspaces are where your teams work. Apps, agents, and knowledge attach to a
                workspace.
              </p>
            </Stack>

            <Field label="Workspace name" required error={issueFor('name')}>
              <Input
                value={name}
                onChange={(event) => updateName(event.target.value)}
                placeholder="Engineering"
                invalid={issueFor('name') !== undefined}
              />
            </Field>

            <Field
              label="Slug"
              required
              hint="Unique within your organization."
              error={issueFor('slug')}
            >
              <Input
                value={slug}
                onChange={(event) => setSlug(slugify(event.target.value))}
                placeholder="engineering"
                invalid={issueFor('slug') !== undefined}
              />
            </Field>

            <Field label="Workspace type" required error={issueFor('type')}>
              <Select
                value={type}
                onChange={(event) => setType(event.target.value)}
                invalid={issueFor('type') !== undefined}
              >
                {WORKSPACE_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {option.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>

            {submitError !== null ? (
              <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
                {submitError}
              </p>
            ) : null}

            <Button type="submit" size="lg" fullWidth loading={submitting}>
              Create workspace
            </Button>
          </Stack>
        </form>
      </Card>
    </OnboardingFrame>
  );
}
