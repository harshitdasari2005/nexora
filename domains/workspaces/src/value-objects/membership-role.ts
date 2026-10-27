/**
 * @nexora/domain-workspaces — MembershipRole value object.
 *
 * The role a user holds within a {@link Workspace} (PSD.md WS-R6: Workspace
 * Admin delegation; §10 roles). Lives in the value-object layer so entities,
 * events, and policies can all reference it without a type-level cycle
 * between the membership entity and the events module.
 */

/**
 * Workspace membership roles (PSD.md §10 roles).
 *
 * `executive` is an organization executive's seat in a department workspace:
 * oversight membership. It gives the holder standing in the workspace (they
 * can see it and raise requests in it) while keeping their own executive
 * business role — it never turns them into that department's head. It is not
 * a management tier of the workspace (`isOwner` stays false).
 */
export const MEMBERSHIP_ROLES = ['owner', 'admin', 'member', 'executive'] as const;

/** Single membership role literal. */
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
