/**
 * Approval request builder tests.
 */

import { describe, expect, it } from 'vitest';

import { ApprovalRequestBuilder } from '../src/approval/index.js';

describe('ApprovalRequestBuilder', () => {
  it('builds a pending approval request with defaults', () => {
    const request = new ApprovalRequestBuilder('wfi_1', 'Approve leave').build();
    expect(request.sourceId).toBe('wfi_1');
    expect(request.summary).toBe('Approve leave');
    expect(request.status).toBe('pending');
    expect(request.approverRoles).toEqual([]);
    expect(request.delegatable).toBe(false);
    expect(request.timeoutMs).toBe(86_400_000);
  });

  it('builds with roles, context, and timeout', () => {
    const request = new ApprovalRequestBuilder('wfi_1', 'Approve leave')
      .requiringRole('hr.approver')
      .requiringRole('hr.director')
      .withContext({ employeeId: 'emp_1' })
      .withTimeout(3_600_000)
      .build();
    expect(request.approverRoles).toEqual(['hr.approver', 'hr.director']);
    expect(request.context).toEqual({ employeeId: 'emp_1' });
    expect(request.timeoutMs).toBe(3_600_000);
  });

  it('marks requests as delegatable', () => {
    const request = new ApprovalRequestBuilder('wfi_1', 'Approve').delegatable().build();
    expect(request.delegatable).toBe(true);
  });

  it('builds matching approval metadata', () => {
    const builder = new ApprovalRequestBuilder('wfi_1', 'Approve').requiringRole('hr.approver');
    const metadata = builder.metadata();
    expect(metadata.required).toBe(true);
    expect(metadata.approverRoles).toEqual(['hr.approver']);
    expect(metadata.delegatable).toBe(false);
  });

  it('chains fluently', () => {
    const request = new ApprovalRequestBuilder('wfi_1', 'Approve')
      .requiringRole('r1')
      .withContext({ a: 1 })
      .withTimeout(1000)
      .delegatable()
      .build();
    expect(request.approverRoles).toEqual(['r1']);
    expect(request.context).toEqual({ a: 1 });
    expect(request.timeoutMs).toBe(1000);
    expect(request.delegatable).toBe(true);
  });
});
