/**
 * @nexora/ai-runtime — approval.
 *
 * The human-control gate for state-changing AI actions (AIR.md §12): the
 * approval lifecycle state machine and the {@link ApprovalEngine} port with
 * its in-memory implementation. The orchestrator consumes this seam when
 * options.approvals is injected.
 */

export * from './engine.js';
