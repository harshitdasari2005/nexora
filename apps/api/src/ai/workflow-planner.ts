/**
 * @nexora/app-api — workflow planner detector.
 *
 * The deterministic bridge between the AI planner and the workflow module
 * (AIR.md §6.4): decides whether an intent is a workflow intent and, when it
 * is, produces a {@link WorkflowProposal} — the planner then emits ONE
 * workflow-orchestrating step instead of the individual capability steps.
 * The planner NEVER executes the workflow; the workflow runtime does.
 *
 * Matching is deterministic (template keywords + parameter extraction) and
 * the detector returns `undefined` for non-workflow intents, so
 * single-capability intents ("create a project", "assign Sarah to X", "find
 * an employee") plan exactly as before. Proposals are driven by a spec list,
 * each bound to a registered workflow definition — adding a template is
 * adding a spec, never new planner logic. Each proposal carries ONLY
 * user-controlled business values (`projectName` / `employeeName`) —
 * identity, tenant, and scope are resolved downstream from the trusted
 * execution context.
 */

import type { WorkflowProposal, WorkflowProposalDetector } from '@nexora/ai-runtime/planner';
import type { WorkflowDefinition } from '@nexora/contracts/workflow';
import {
  CREATE_PROJECT_AND_ASSIGN_WORKFLOW_KEY,
  HIRE_AND_ASSIGN_WORKFLOW_KEY,
} from '@nexora/module-workflow';

import {
  extractCreateProjectAndAssignParameters,
  extractHireAndAssignParameters,
} from './parameters.js';

/** The AI-surface ids of the create-project-and-assign workflow. */
export const WORKFLOW_CAPABILITY_ID = 'workflow.create_project_and_assign_employee';
export const WORKFLOW_SKILL_ID = 'workflow.run';
export const WORKFLOW_TOOL_ID = 'workflow.create_project_and_assign_employee';

/** The AI-surface ids of the hire-and-assign workflow (flagship HR slice). */
export const HIRE_WORKFLOW_CAPABILITY_ID = 'workflow.hire_and_assign_employee';
export const HIRE_WORKFLOW_TOOL_ID = 'workflow.hire_and_assign_employee';

/** One workflow template's planner spec (a deterministic detector entry). */
export interface WorkflowPlannerSpec {
  /** The workflow definition key this spec plans. */
  workflowKey: string;
  /** The capability id of the workflow-orchestrating tool. */
  capabilityId: string;
  /** The skill id backing the capability. */
  skillId: string;
  /** The tool id invoked to run the workflow. */
  toolId: string;
  /** Keyword predicates — ALL must match for this spec to fire. */
  keywords: readonly RegExp[];
  /** The deterministic parameter extractor for this workflow intent. */
  extract: (input: {
    intent: string;
    inputSchema: Record<string, unknown>;
  }) => Record<string, unknown>;
}

/** Options for {@link createWorkflowProposalDetector}. */
export interface WorkflowPlannerOptions {
  /** Resolves a workflow definition by key (for the display steps). */
  getDefinition: (key: string) => WorkflowDefinition | undefined;
  /** The ordered workflow specs (first match wins). */
  workflows: readonly WorkflowPlannerSpec[];
}

/**
 * Builds the workflow proposal detector: each spec fires ONLY when its
 * keywords match AND both business values extract — anything less falls
 * through to per-capability planning.
 */
export function createWorkflowProposalDetector(
  options: WorkflowPlannerOptions,
): WorkflowProposalDetector {
  return ({ intent }): WorkflowProposal | undefined => {
    for (const spec of options.workflows) {
      if (!spec.keywords.every((keyword) => keyword.test(intent))) {
        continue;
      }
      const params = spec.extract({ intent, inputSchema: {} });
      const values = Object.values(params);
      if (values.length === 0 || values.some((value) => typeof value !== 'string')) {
        continue;
      }
      const definition = options.getDefinition(spec.workflowKey);
      if (definition === undefined) {
        continue;
      }
      return {
        workflowKey: spec.workflowKey,
        capabilityId: spec.capabilityId,
        skillId: spec.skillId,
        toolId: spec.toolId,
        sideEffectClass: 'consequential',
        input: params,
        displaySteps: definition.steps.map((step) => ({
          id: step.id,
          name: step.name,
          capabilityId: step.capabilityId ?? '',
        })),
      };
    }
    return undefined;
  };
}

/** The shipped workflow specs (each bound to a registered definition). */
export function defaultWorkflowPlannerSpecs(): readonly WorkflowPlannerSpec[] {
  return [
    {
      workflowKey: CREATE_PROJECT_AND_ASSIGN_WORKFLOW_KEY,
      capabilityId: WORKFLOW_CAPABILITY_ID,
      skillId: WORKFLOW_SKILL_ID,
      toolId: WORKFLOW_TOOL_ID,
      keywords: [/\bcreate\b/i, /\bproject\b/i, /\bassign\b/i],
      extract: extractCreateProjectAndAssignParameters,
    },
    {
      workflowKey: HIRE_AND_ASSIGN_WORKFLOW_KEY,
      capabilityId: HIRE_WORKFLOW_CAPABILITY_ID,
      skillId: WORKFLOW_SKILL_ID,
      toolId: HIRE_WORKFLOW_TOOL_ID,
      keywords: [/\bhire\b/i, /\bassign\b/i, /\bproject\b/i],
      extract: extractHireAndAssignParameters,
    },
  ];
}
