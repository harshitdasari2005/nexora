/**
 * @nexora/app-web — Safety checks page.
 *
 * The assistant is put through a fixed set of hard situations (asked for
 * another organization's data, told to skip an approval, fed instructions
 * hidden in a document). This page shows the last run as it was: what was
 * checked, how many passed, and real examples. With no run on record it
 * says so instead of showing numbers.
 */

import { useCallback, useEffect, useState } from 'react';
import { Card, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { Fact, Page, PageHeader, Section } from '../components/Page.js';
import { api, ApiError } from '../lib/api.js';
import { useShellScope } from '../lib/useShellScope.js';

/** One claim and the scenarios that test it. */
export interface ProofClaim {
  key: string;
  title: string;
  about: string;
  total: number;
  passed: number;
  examples: readonly string[];
}

/** The last run of the safety checks. */
export interface ProofSummary {
  ranAt: string;
  datasetVersion: string;
  total: number;
  passed: number;
  failed: number;
  claimsChecked: number;
  unsupportedClaims: number;
  gates: readonly { description: string; passed: boolean }[];
  claims: readonly ProofClaim[];
}

export type ProofResponse = { available: false } | { available: true; summary: ProofSummary };

const muted = { fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' } as const;

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'an unknown time'
    : date.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

/** The safety checks page. */
export function ProofPage(): JSX.Element {
  const { dashboard, loading, error, reload } = useShellScope();
  const [state, setState] = useState<{ data: ProofResponse | null; error: string | null }>({
    data: null,
    error: null,
  });
  const load = useCallback(() => {
    api<ProofResponse>('/proof').then(
      (data) => setState({ data, error: null }),
      (caught: unknown) =>
        setState({
          data: null,
          error: caught instanceof ApiError ? caught.message : 'Could not read the safety checks.',
        }),
    );
  }, []);
  useEffect(load, [load]);

  if (loading && dashboard === null) return <LoadingScreen />;
  if (error !== null) return <ErrorState message={error.message} onRetry={reload} />;
  if (dashboard === null) return <LoadingScreen />;
  if (dashboard.organization === null || dashboard.workspace === null) {
    return <ErrorState message="Create an organization and a workspace first." />;
  }

  return (
    <AppShell
      user={dashboard.user}
      organizationName={dashboard.organization.name}
      workspaceName={dashboard.workspace.name}
      organizationId={dashboard.organization.id}
      workspaceId={dashboard.workspace.id}
    >
      {state.error !== null ? (
        <ErrorState message={state.error} onRetry={load} />
      ) : state.data === null ? (
        <Page>
          <PageHeader title="Safety checks" />
          <Card padding={5}>
            <p style={{ color: 'var(--nexora-textSecondary)' }}>Reading the last run…</p>
          </Card>
        </Page>
      ) : (
        <ProofView data={state.data} />
      )}
    </AppShell>
  );
}

/** The pure page content (exported for tests). */
export function ProofView({ data }: { data: ProofResponse }): JSX.Element {
  if (!data.available) {
    return (
      <Page>
        <PageHeader
          title="Safety checks"
          lede="The assistant is tested against a fixed set of hard situations. No run is on record on this machine yet."
        />
        <Card padding={5}>
          <p style={muted}>
            Run <code>pnpm eval:run</code> in <code>apps/api</code> and reload this page. It takes
            about half a minute and needs no internet.
          </p>
        </Card>
      </Page>
    );
  }
  const { summary } = data;
  const allPassed = summary.failed === 0 && summary.passed === summary.total;

  return (
    <Page>
      <PageHeader
        title="Safety checks"
        lede="Before the assistant is trusted with an office, it is put through situations where it is asked to do the wrong thing. This is the last run, as it was."
      />

      <Card padding={6}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="nexora-proof-figure">
              {summary.passed} of {summary.total}
            </div>
            <div style={{ fontSize: typography.sizes.md }}>
              {allPassed
                ? 'situations handled correctly.'
                : `situations handled correctly; ${summary.failed} failed.`}
            </div>
          </div>
          <div className="nexora-facts">
            <Fact label="Last run">{when(summary.ranAt)}</Fact>
            <Fact label="Statements checked against the records">
              {summary.claimsChecked}, of which {summary.unsupportedClaims} unsupported
            </Fact>
            <Fact label="Scenario set">Version {summary.datasetVersion}</Fact>
          </div>
        </div>
      </Card>

      <Section title="What was checked" count={summary.claims.length}>
        <div className="nexora-people-grid">
          {summary.claims.map((claim) => (
            <Card key={claim.key} padding={5}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="nexora-figure">
                  {claim.passed} of {claim.total}
                </div>
                <h3 className="nexora-section-title">{claim.title}</h3>
                {claim.about === '' ? null : <p style={muted}>{claim.about}</p>}
                {claim.examples.length === 0 ? null : (
                  <ul className="nexora-proof-examples">
                    {claim.examples.map((example) => (
                      <li key={example}>{example}</li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {summary.gates.length === 0 ? null : (
        <Section title="The bars it has to clear">
          <Card padding={0}>
            <div className="nexora-rows">
              {summary.gates.map((gate) => (
                <div key={gate.description} className="nexora-desk-row">
                  <span className="nexora-check" data-done={gate.passed} aria-hidden="true">
                    {gate.passed ? '✓' : ''}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>{gate.description}</span>
                  <span style={{ fontWeight: typography.weights.semibold }}>
                    {gate.passed ? 'Cleared' : 'Not cleared'}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      )}

      <p style={muted}>
        The checks run the real application with a scripted model, so they test the rules around the
        assistant rather than one model’s mood on one day. Anyone can run them again with{' '}
        <code>pnpm eval:run</code>.
      </p>
    </Page>
  );
}
