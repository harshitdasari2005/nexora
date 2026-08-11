/**
 * Context tests: execution context validation and the typed context bag.
 */

import { describe, expect, it } from 'vitest';

import { validateExecutionContext } from '../src/contexts/index.js';
import { fakeExecutionContext } from '../src/testing/index.js';

describe('validateExecutionContext', () => {
  it('accepts a valid execution context', () => {
    const issues = validateExecutionContext(fakeExecutionContext());
    expect(issues).toHaveLength(0);
  });

  it('rejects a missing tenant id', () => {
    const issues = validateExecutionContext(fakeExecutionContext({ tenantId: '' }));
    expect(issues.map((issue) => issue.path)).toContain('tenantId');
  });

  it('rejects a missing execution id', () => {
    const issues = validateExecutionContext(fakeExecutionContext({ executionId: '' }));
    expect(issues.map((issue) => issue.path)).toContain('executionId');
  });

  it('rejects a missing agent id', () => {
    const issues = validateExecutionContext(fakeExecutionContext({ agentId: '' }));
    expect(issues.map((issue) => issue.path)).toContain('agentId');
  });

  it('rejects an unparseable startedAt', () => {
    const issues = validateExecutionContext(fakeExecutionContext({ startedAt: 'not-a-date' }));
    expect(issues.map((issue) => issue.path)).toContain('startedAt');
  });

  it('collects multiple issues at once', () => {
    const issues = validateExecutionContext(
      fakeExecutionContext({ tenantId: '', startedAt: 'bad' }),
    );
    expect(issues).toHaveLength(2);
  });

  it('accepts workspace-scoped contexts', () => {
    const issues = validateExecutionContext(fakeExecutionContext({ workspaceId: 'ws_1' }));
    expect(issues).toHaveLength(0);
  });
});
