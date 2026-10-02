/**
 * @nexora/app-api — reads the facts the Guided Demo story is derived from.
 *
 * Every fact comes from the records the real screens write (hiring requests,
 * job openings, candidates, onboardings, project assignments) of the ONE demo
 * organization. The reader takes no target from the caller.
 */

import {
  toCandidateDto,
  toHiringRequisitionDto,
  toJobOpeningDto,
  toOnboardingDto,
  type HiringRequisitionApplicationService,
  type OnboardingApplicationService,
  type RecruitingApplicationService,
} from '@nexora/application-hr';
import type { ProjectRepository, ResourceAssignmentRepository } from '@nexora/domain-projects';

import type { StoryFacts } from './story.js';
import type { DemoPersonaKey } from './world.js';

/** What the story reader needs. */
export interface StoryReaderDependencies {
  requisitions: HiringRequisitionApplicationService;
  recruiting: RecruitingApplicationService;
  onboarding: OnboardingApplicationService;
  projects: ProjectRepository;
  resourceAssignments: ResourceAssignmentRepository;
  /** The demo persona a user id belongs to (undefined for anyone else). */
  personaOfUser: (userId: string) => DemoPersonaKey | undefined;
}

/** Reads the story's facts for the demo organization. */
export async function readStoryFacts(
  dependencies: StoryReaderDependencies,
  organizationId: string,
): Promise<StoryFacts> {
  const tenant = organizationId as never;
  const requisitions = (await dependencies.requisitions.list(tenant))
    .map(toHiringRequisitionDto)
    .filter((entry) => entry.status !== 'withdrawn')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const requisition = requisitions[0];
  if (requisition === undefined) return { candidates: [], assigned: false };

  const inRound = requisition.history.filter((entry) => entry.round === requisition.round);
  const returnedFrom = inRound.find((entry) => entry.action === 'rejected')?.stage;
  const raisedBy = dependencies.personaOfUser(requisition.requestedBy);
  const project =
    requisition.projectId === undefined
      ? undefined
      : await dependencies.projects.findById(requisition.projectId as never).catch(() => undefined);
  const projectInOrganization =
    project !== undefined && project.organizationId === requisition.organizationId
      ? project
      : undefined;

  const facts: StoryFacts = {
    requisition: {
      jobTitle: requisition.jobTitle,
      status: requisition.status,
      ...(raisedBy === undefined ? {} : { raisedBy }),
      executiveNotRequired: inRound.some((entry) => entry.action === 'executive_not_required'),
      executiveApproved: inRound.some(
        (entry) => entry.action === 'approved' && entry.stage === 'executive',
      ),
      ...(returnedFrom === undefined ? {} : { returnedFrom }),
      hasProject: projectInOrganization !== undefined,
    },
    candidates: [],
    assigned: false,
    ...(projectInOrganization === undefined
      ? {}
      : { projectName: projectInOrganization.name.value }),
  };

  const opening = (await dependencies.recruiting.listOpenings(tenant))
    .map(toJobOpeningDto)
    .find((entry) => entry.requisitionId === requisition.id);
  if (opening === undefined) return facts;

  const candidates = (await dependencies.recruiting.listCandidates(tenant, opening.id)).map(
    (candidate) => toCandidateDto(candidate, { includeCompensation: false }),
  );
  const hired = candidates.find(
    (candidate) => candidate.stage === 'hired' && candidate.employeeId !== undefined,
  );
  const withOpening: StoryFacts = {
    ...facts,
    opening: { status: opening.status },
    candidates: candidates.map((candidate) => ({
      name: candidate.name,
      stage: candidate.stage,
      feedbackCount: candidate.feedback.length,
    })),
  };
  if (hired?.employeeId === undefined) return withOpening;

  const onboarding = await dependencies.onboarding.findForEmployee(tenant, hired.employeeId);
  const onboardingDto = onboarding === undefined ? undefined : toOnboardingDto(onboarding);
  const assignment =
    projectInOrganization === undefined
      ? undefined
      : await dependencies.resourceAssignments.findByProjectAndEmployee(
          projectInOrganization.id,
          hired.employeeId,
        );
  return {
    ...withOpening,
    hire: { name: hired.name },
    ...(onboardingDto === undefined
      ? {}
      : {
          onboarding: {
            completed: onboardingDto.status === 'completed',
            items: onboardingDto.items.map((item) => ({
              owner: item.owner,
              title: item.title,
              done: item.done,
            })),
          },
        }),
    assigned: assignment !== undefined,
  };
}
