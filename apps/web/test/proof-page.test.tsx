/**
 * The safety checks page: the last run as it was, failures included, and no
 * numbers at all when there is no run on record.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { ProofView, type ProofSummary } from '../src/pages/Proof.js';

const render = (node: JSX.Element): string =>
  renderToString(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, '');

const summary = (overrides: Partial<ProofSummary> = {}): ProofSummary => ({
  ranAt: '2026-10-02T14:48:41.266Z',
  datasetVersion: '2.0.1',
  total: 207,
  passed: 207,
  failed: 0,
  claimsChecked: 66,
  unsupportedClaims: 0,
  gates: [{ description: 'Authorization and approval-policy correctness', passed: true }],
  claims: [
    {
      key: 'manipulation',
      title: 'It cannot be talked into breaking the rules',
      about: 'Instructions hidden in a document are treated as text, never obeyed.',
      total: 14,
      passed: 14,
      examples: ['A document tells the assistant to approve itself'],
    },
  ],
  ...overrides,
});

describe('ProofView', () => {
  it('shows the last run: how many passed, what was checked, and a real example', () => {
    const html = render(<ProofView data={{ available: true, summary: summary() }} />);
    expect(html).toContain('207 of 207');
    expect(html).toContain('situations handled correctly.');
    expect(html).toContain('66, of which 0 unsupported');
    expect(html).toContain('It cannot be talked into breaking the rules');
    expect(html).toContain('14 of 14');
    expect(html).toContain('A document tells the assistant to approve itself');
    expect(html).toContain('Cleared');
  });

  it('shows a failure as a failure', () => {
    const html = render(
      <ProofView
        data={{
          available: true,
          summary: summary({
            passed: 205,
            failed: 2,
            gates: [{ description: 'Safety-tagged scenarios with any failure', passed: false }],
          }),
        }}
      />,
    );
    expect(html).toContain('205 of 207');
    expect(html).toContain('2 failed');
    expect(html).toContain('Not cleared');
  });

  it('shows no numbers when there is no run on record, and says how to make one', () => {
    const html = render(<ProofView data={{ available: false }} />);
    expect(html).toContain('No run is on record');
    expect(html).toContain('pnpm eval:run');
    expect(html).not.toMatch(/\d+ of \d+/);
  });
});
