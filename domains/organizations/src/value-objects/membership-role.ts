/**
 * @nexora/domain-organizations — MembershipRole value object.
 *
 * The role a user holds within an {@link Organization} (PSD.md §4 WS-R2, §10
 * roles). Lives in the value-object layer so entities, events, and policies
 * can all reference it without a type-level cycle between the membership
 * entity and the events module.
 */

/** Membership roles (PSD.md §10 roles; permission levels). */
export const MEMBERSHIP_ROLES = ['owner', 'admin', 'member'] as const;

/** Single membership role literal. */
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
