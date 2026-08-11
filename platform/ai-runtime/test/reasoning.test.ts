/**
 * @nexora/ai-runtime — reasoning tests.
 */

import { describe, expect, it } from 'vitest';

import { buildExplanationRecord } from '../src/reasoning/index.js';

describe('buildExplanationRecord', () => {
  it('assembles the canonical explanation record', () => {
    const record = buildExplanationRecord({
      intent: 'hire sarah',
      reasoning: ['matched hr.hire_employee'],
      knowledgeUsed: [{ itemId: 'kb_1', snippet: 'offer template' }],
      policiesApplied: ['hr.policy.offer'],
      capabilitiesUsed: ['hr.hire_employee'],
      agentsUsed: ['agt_hr'],
      toolsUsed: ['tool_hire_employee'],
      approvals: [{ id: 'apr_1', status: 'granted' }],
      finalDecision: 'executed',
      confidence: 0.9,
    });
    expect(record.intent).toBe('hire sarah');
    expect(record.reasoning).toContain('matched hr.hire_employee');
    expect(record.knowledgeUsed[0]?.itemId).toBe('kb_1');
    expect(record.approvals[0]?.status).toBe('granted');
    expect(record.confidence).toBe(0.9);
  });

  it('defaults confidence to undefined when omitted', () => {
    const record = buildExplanationRecord({
      intent: 'x',
      reasoning: [],
      knowledgeUsed: [],
      policiesApplied: [],
      capabilitiesUsed: [],
      agentsUsed: [],
      toolsUsed: [],
      approvals: [],
      finalDecision: 'none',
    });
    expect(record.confidence).toBeUndefined();
  });
});
