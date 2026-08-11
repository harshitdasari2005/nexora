/**
 * @nexora/module-calendar — Calendar domain core.
 *
 * The Calendar bounded context (DOMAIN_MODEL.md §4.5 / APP-10): the
 * CalendarEntry aggregate with its lifecycle, value objects, domain events,
 * repository interface, domain service, and policies. Pure business domain —
 * no persistence, no APIs, no infrastructure. The application layer composes
 * these with infrastructure implementations.
 *
 * For this vertical slice, Calendar contributes the minimum event capability:
 * calendar entries with organization (tenant) + workspace scope, a title, a
 * validated time window, and a scheduled → cancelled lifecycle. The
 * availability/meeting-coordination aggregates (AvailabilityWindow,
 * MeetingRequest) are later sprints.
 */

export * from './errors/index.js';
export * from './value-objects/index.js';
export * from './events/index.js';
export * from './entities/index.js';
export * from './policies/index.js';
export * from './repositories/index.js';
export * from './services/index.js';
