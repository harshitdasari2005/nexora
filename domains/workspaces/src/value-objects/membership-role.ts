/**
 * @nexora/domain-workspaces — MembershipRole value object.
 *
 * The role a user holds within a {@link Workspace} (PSD.md WS-R6: Workspace
 * Admin delegation; §10 roles). Lives in the value-object layer so entities,
 * events, and policies can all reference it without a type-level cycle
 * between the membership entity and the events module.
 */

/** Workspace membership roles (PSD.md §10 roles). */
export const MEMBERSHIP_ROLES = ['owner', 'admin', 'member'] as const;

/** Single membership role literal. */
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
