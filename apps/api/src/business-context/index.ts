/**
 * apps/api — business context.
 *
 * The trusted seam between membership and the S24 Phase 1/2/3 layers:
 * `MembershipBusinessRoleResolver` derives the user's business role from
 * trusted membership (shared by the Command Center and the AI Runtime), and
 * `buildAIBusinessContext` resolves domain + capability affinity for AI
 * interactions. All values are derived server-side; nothing here is
 * client-suppliable.
 */

export * from './business-role-resolver.js';
export * from './ai-business-context.js';
