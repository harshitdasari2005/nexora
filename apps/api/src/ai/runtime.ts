/**
 * @nexora/app-api — AI Runtime composition.
 *
 * The application-side composition root of the Enterprise AI Runtime (AIR.md
 * §1): registers the workspaces capability surface (discovery manifests +
 * the executable ListWorkspacesTool), the Groq model provider, the narration
 * prompt, and wires the orchestrator. The runtime itself stays generic and
 * provider-independent — this module is where the platform registers what
 * the AI can do (SAD.md §10 capability registry).
 */

import {
  CapabilityDiscovery,
  ConversationManager,
  EnterpriseAIOrchestrator,
  ExecutableToolRegistry,
  InMemoryApprovalEngine,
  InMemoryConversationStore,
  ProviderRegistry,
  PromptRegistry,
  RuntimeRegistry,
  SequentialPlanner,
  SkillIndex,
  ToolExecutor,
  createTemplate,
  registryEntries,
  type ApprovalEngine,
  type ConversationStore,
} from '@nexora/ai-runtime';
import type {
  AgentIdentity,
  AgentManifest,
  AgentSkill,
  CapabilityDeclaration,
  ToolContract,
} from '@nexora/contracts/ai';
import { GroqAdapter } from '@nexora/ai-runtime/adapters';
import type { EventPublisher } from '@nexora/shared/events';
import type {
  WorkflowInstanceRepository,
  WorkflowStepExecutionRepository,
} from '@nexora/module-workflow';
import {
  StartWorkflowHandler,
  WorkflowApplicationService,
  WorkflowDefinitionRegistry,
  WorkflowRuntime,
  createProjectAndAssignWorkflowDefinition,
  hireAndAssignEmployeeWorkflowDefinition,
} from '@nexora/module-workflow';
import type {
  CreateWorkspaceHandler,
  ListMyWorkspacesHandler,
} from '@nexora/application-workspaces';
import type {
  AssignEmployeeToProjectHandler,
  CreateProjectHandler,
  FindProjectByNameHandler,
} from '@nexora/application-projects';
import type { CreateEmployeeHandler, FindEmployeeByNameHandler } from '@nexora/application-hr';
import type { RetrieveKnowledgeHandler } from '@nexora/application-knowledge';
import type {
  CreateCalendarEventHandler,
  ListCalendarEventsHandler,
} from '@nexora/application-calendar';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type {
  ListActivityHandler,
  ListNotificationsHandler,
  UnreadNotificationsCountHandler,
} from '@nexora/module-notifications';

import type { ApiConfig } from '../config.js';
import { KnowledgeFallbackMatcher } from './knowledge-fallback.js';
import { extractIntentParameters } from './parameters.js';
import {
  createWorkflowProposalDetector,
  defaultWorkflowPlannerSpecs,
  HIRE_WORKFLOW_TOOL_ID,
  WORKFLOW_SKILL_ID,
  WORKFLOW_TOOL_ID,
} from './workflow-planner.js';
import { WorkflowToolStepExecutor } from './workflow-executor.js';
import { AssignEmployeeToProjectTool } from './tools/assign-employee-tool.js';
import { CreateProjectAndAssignWorkflowTool } from './tools/create-project-and-assign-tool.js';
import { CreateCalendarEventTool } from './tools/create-calendar-event-tool.js';
import { CreateEmployeeTool } from './tools/create-employee-tool.js';
import { CreateProjectTool } from './tools/create-project-tool.js';
import { HireAndAssignWorkflowTool } from './tools/hire-and-assign-tool.js';
import { CreateWorkspaceTool } from './tools/create-workspace-tool.js';
import { FindEmployeeTool } from './tools/find-employee-tool.js';
import { FindProjectTool } from './tools/find-project-tool.js';
import { ListWorkspacesTool } from './tools/list-workspaces-tool.js';
import { SearchKnowledgeTool } from './tools/search-knowledge-tool.js';
import { WhatNeedsAttentionTool } from './tools/what-needs-attention-tool.js';

/** The workspaces agent identity (the owning bounded context). */
export const WORKSPACES_AGENT: AgentIdentity = {
  id: 'agt_workspaces',
  name: 'workspaces',
  displayName: 'Workspaces Agent',
};

/** The skill that implements the list-workspaces capability. */
export const WORKSPACES_LIST_SKILL: AgentSkill = {
  id: 'workspaces.list',
  description: 'Lists the workspaces available to the current user',
  toolIds: ['workspaces.list_workspaces'],
  autonomyTier: 'supervised',
  requiresApproval: false,
};

/** The skill that implements the create-workspace capability (write). */
export const WORKSPACES_CREATE_SKILL: AgentSkill = {
  id: 'workspaces.create',
  description: 'Creates a new workspace in the current organization',
  toolIds: ['workspaces.create_workspace'],
  autonomyTier: 'supervised',
  requiresApproval: true,
};

/** The capability the AI discovers for workspace-intent utterances. */
export const WORKSPACES_LIST_CAPABILITY: CapabilityDeclaration = {
  id: 'workspaces.list_workspaces',
  name: 'List Workspaces',
  description: 'Lists the workspaces available to the current user in the current organization',
  skillId: 'workspaces.list',
  sideEffectClass: 'read_only',
};

/** The canonical tool contract for the ListWorkspacesTool. */
export const WORKSPACES_LIST_TOOL: ToolContract = {
  id: 'workspaces.list_workspaces',
  description: 'Lists the workspaces available to the current user',
  sideEffectClass: 'read_only',
  idempotent: true,
  timeoutMs: 10_000,
  // Empty input schema with additionalProperties rejected: the model can
  // request the action but can never define identity, tenant, or scope.
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

/** The capability the AI discovers for create-workspace intent (write). */
export const WORKSPACES_CREATE_CAPABILITY: CapabilityDeclaration = {
  id: 'workspaces.create_workspace',
  name: 'Create Workspace',
  description: 'Creates a new workspace in the current organization',
  skillId: 'workspaces.create',
  sideEffectClass: 'consequential',
};

/** The canonical tool contract for the CreateWorkspaceTool. */
export const WORKSPACES_CREATE_TOOL: ToolContract = {
  id: 'workspaces.create_workspace',
  description: 'Creates a new workspace in the current organization',
  sideEffectClass: 'consequential',
  idempotent: false,
  timeoutMs: 15_000,
  // ONLY the user-controlled name; identity/tenant/scope are never input.
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', minLength: 1, maxLength: 80 } },
    required: ['name'],
    additionalProperties: false,
  },
};

/** The projects agent identity (the owning bounded context). */
export const PROJECTS_AGENT: AgentIdentity = {
  id: 'agt_projects',
  name: 'projects',
  displayName: 'Projects Agent',
};

/** The HR agent identity (the owning bounded context). */
export const HR_AGENT: AgentIdentity = {
  id: 'agt_hr',
  name: 'hr',
  displayName: 'HR Agent',
};

/** The workflow agent identity (the orchestrating bounded context). */
export const WORKFLOW_AGENT: AgentIdentity = {
  id: 'agt_workflow',
  name: 'workflow',
  displayName: 'Workflow Agent',
};

/** The knowledge agent identity (the owning bounded context). */
export const KNOWLEDGE_AGENT: AgentIdentity = {
  id: 'agt_knowledge',
  name: 'knowledge',
  displayName: 'Knowledge Agent',
};

/** The notifications agent identity (the owning bounded context). */
export const NOTIFICATIONS_AGENT: AgentIdentity = {
  id: 'agt_notifications',
  name: 'notifications',
  displayName: 'Notifications Agent',
};

/** The calendar agent identity (the owning bounded context). */
export const CALENDAR_AGENT: AgentIdentity = {
  id: 'agt_calendar',
  name: 'calendar',
  displayName: 'Calendar Agent',
};

/** The skill that runs the deterministic business workflows (one plan unit). */
export const WORKFLOW_RUN_SKILL: AgentSkill = {
  id: WORKFLOW_SKILL_ID,
  description:
    'Runs a deterministic workflow that creates a project and assigns an employee, or hires an employee and assigns them to a project',
  toolIds: [WORKFLOW_TOOL_ID, HIRE_WORKFLOW_TOOL_ID],
  autonomyTier: 'supervised',
  requiresApproval: true,
};

/**
 * The canonical tool contract of the workflow-orchestrating tool. The
 * workflow capability is deliberately NOT registered as a token-matched
 * capability: workflow intents are planned by the workflow planner (a
 * deterministic detector), never by token overlap — individual capabilities
 * keep matching exactly as before.
 */
export const WORKFLOW_TOOL_CONTRACT: ToolContract = {
  id: WORKFLOW_TOOL_ID,
  description: 'Creates a new project and assigns an employee to it in the current organization',
  sideEffectClass: 'consequential',
  idempotent: false,
  timeoutMs: 30_000,
  inputSchema: {
    type: 'object',
    properties: {
      projectName: { type: 'string', minLength: 1, maxLength: 80 },
      employeeName: { type: 'string', minLength: 1, maxLength: 120 },
    },
    required: ['projectName', 'employeeName'],
    additionalProperties: false,
  },
};

/**
 * The canonical tool contract of the flagship hire-and-assign workflow
 * tool. Like the create-and-assign contract, the hire workflow is planned by
 * the deterministic workflow planner — never by token overlap.
 */
export const HIRE_WORKFLOW_TOOL_CONTRACT: ToolContract = {
  id: HIRE_WORKFLOW_TOOL_ID,
  description:
    'Hires a new employee and assigns them to an existing project in the current organization',
  sideEffectClass: 'consequential',
  idempotent: false,
  timeoutMs: 30_000,
  inputSchema: {
    type: 'object',
    properties: {
      employeeName: { type: 'string', minLength: 1, maxLength: 120 },
      projectName: { type: 'string', minLength: 1, maxLength: 80 },
    },
    required: ['employeeName', 'projectName'],
    additionalProperties: false,
  },
};

/** The skill that implements the find-employee capability (read). */
export const HR_FIND_SKILL: AgentSkill = {
  id: 'hr.find',
  description: 'Finds an employee by name in the current organization',
  toolIds: ['hr.find_employee'],
  autonomyTier: 'supervised',
  requiresApproval: false,
};

/** The skill that implements the create/hire-employee capability (write). */
export const HR_CREATE_SKILL: AgentSkill = {
  id: 'hr.create',
  description: 'Hires (creates) a new employee in the current organization',
  toolIds: ['hr.create_employee'],
  autonomyTier: 'supervised',
  requiresApproval: true,
};

/** The capability the AI discovers for employee resolution. */
export const HR_FIND_CAPABILITY: CapabilityDeclaration = {
  id: 'hr.find_employee',
  name: 'Find Employee',
  description: 'Finds an employee by name in the current organization',
  skillId: 'hr.find',
  sideEffectClass: 'read_only',
};

/** The canonical tool contract for the FindEmployeeTool. */
export const HR_FIND_TOOL: ToolContract = {
  id: 'hr.find_employee',
  description: 'Finds an employee by name in the current organization',
  sideEffectClass: 'read_only',
  idempotent: true,
  timeoutMs: 10_000,
  // ONLY the user-controlled name; identity/tenant/scope are never input.
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', minLength: 1, maxLength: 120 } },
    required: ['name'],
    additionalProperties: false,
  },
};

/** The capability the AI discovers for hire-employee intent (write). */
export const HR_CREATE_CAPABILITY: CapabilityDeclaration = {
  id: 'hr.create_employee',
  name: 'Hire Employee',
  description: 'Hires (creates) a new employee in the current organization',
  skillId: 'hr.create',
  sideEffectClass: 'consequential',
};

/** The canonical tool contract for the CreateEmployeeTool. */
export const HR_CREATE_TOOL: ToolContract = {
  id: 'hr.create_employee',
  description: 'Hires (creates) a new employee in the current organization',
  sideEffectClass: 'consequential',
  idempotent: false,
  timeoutMs: 15_000,
  // ONLY the user-controlled name; identity/tenant/scope are never input.
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', minLength: 1, maxLength: 120 } },
    required: ['name'],
    additionalProperties: false,
  },
};

/** The skill that implements the knowledge-search capability (read). */
export const KNOWLEDGE_SEARCH_SKILL: AgentSkill = {
  id: 'knowledge.search',
  description:
    'Searches the documents and published knowledge base articles available to the user in the current workspace',
  toolIds: ['knowledge.search'],
  autonomyTier: 'supervised',
  requiresApproval: false,
};

/** The capability the AI discovers for knowledge questions (BR-7 retrieval). */
export const KNOWLEDGE_SEARCH_CAPABILITY: CapabilityDeclaration = {
  id: 'knowledge.search',
  name: 'Search Workspace Knowledge',
  description:
    'Searches the documents and published knowledge base articles available to the user in the current workspace and returns grounded references with citations',
  skillId: 'knowledge.search',
  sideEffectClass: 'read_only',
};

/** The canonical tool contract for the SearchKnowledgeTool. */
export const KNOWLEDGE_SEARCH_TOOL: ToolContract = {
  id: 'knowledge.search',
  description:
    'Searches the documents and published knowledge base articles available to the user in the current workspace and returns grounded references with citations',
  sideEffectClass: 'read_only',
  idempotent: true,
  timeoutMs: 15_000,
  // ONLY the user-controlled question; identity/tenant/workspace/scope are
  // never input — they come from the trusted execution context.
  inputSchema: {
    type: 'object',
    properties: { question: { type: 'string', minLength: 1, maxLength: 1000 } },
    required: ['question'],
    additionalProperties: false,
  },
};

/** The skill that implements the what-needs-attention capability (read). */
export const NOTIFICATIONS_ATTENTION_SKILL: AgentSkill = {
  id: 'notifications.attention',
  description: 'Lists the notifications and activity that need the current user attention',
  toolIds: ['notifications.what_needs_attention'],
  autonomyTier: 'supervised',
  requiresApproval: false,
};

/**
 * The capability the AI discovers for attention/notification intents.
 *
 * The name deliberately contains NO generic stop words (and/or/items/…):
 * the deterministic token matcher uses the name's noun tokens as evidence
 * and would otherwise hijack unrelated questions ("What is the deadline…"
 * contains "and") — the entity nouns `attention` / `notifications` are the
 * only discriminating signals.
 */
export const NOTIFICATIONS_ATTENTION_CAPABILITY: CapabilityDeclaration = {
  id: 'notifications.what_needs_attention',
  name: 'Check Attention Notifications',
  description:
    'Lists the notifications and recent activity that need the current user attention in the current workspace',
  skillId: 'notifications.attention',
  sideEffectClass: 'read_only',
};

/** The canonical tool contract for the WhatNeedsAttentionTool. */
export const NOTIFICATIONS_ATTENTION_TOOL: ToolContract = {
  id: 'notifications.what_needs_attention',
  description:
    'Lists the notifications and recent activity that need the current user attention in the current workspace',
  sideEffectClass: 'read_only',
  idempotent: true,
  timeoutMs: 10_000,
  // Empty input schema with additionalProperties rejected: the model can ask
  // the question but can never define identity, tenant, or scope.
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

/** The skill that implements the create-calendar-event capability (write). */
export const CALENDAR_CREATE_SKILL: AgentSkill = {
  id: 'calendar.create',
  description: 'Creates a calendar event in the current workspace',
  toolIds: ['calendar.create_event'],
  autonomyTier: 'supervised',
  requiresApproval: true,
};

/** The capability the AI discovers for calendar-event intents (write). */
export const CALENDAR_CREATE_CAPABILITY: CapabilityDeclaration = {
  id: 'calendar.create_event',
  name: 'Create Calendar Event',
  description: 'Creates a calendar event in the current workspace',
  skillId: 'calendar.create',
  sideEffectClass: 'consequential',
};

/** The canonical tool contract for the CreateCalendarEventTool. */
export const CALENDAR_CREATE_TOOL: ToolContract = {
  id: 'calendar.create_event',
  description: 'Creates a calendar event in the current workspace',
  sideEffectClass: 'consequential',
  idempotent: false,
  timeoutMs: 15_000,
  // ONLY user-controlled business values; identity/tenant/workspace are
  // never input — they come from the trusted execution context.
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 120 },
      startsAt: { type: 'string', minLength: 1 },
      endsAt: { type: 'string', minLength: 1 },
    },
    required: ['title', 'startsAt', 'endsAt'],
    additionalProperties: false,
  },
};

/** The skill that implements the create-project capability (write). */
export const PROJECTS_CREATE_SKILL: AgentSkill = {
  id: 'projects.create',
  description: 'Creates a new project in the current organization',
  toolIds: ['projects.create_project'],
  autonomyTier: 'supervised',
  requiresApproval: true,
};

/** The skill that implements the find-project capability (read). */
export const PROJECTS_FIND_SKILL: AgentSkill = {
  id: 'projects.find',
  description: 'Finds a project by name in the current organization',
  toolIds: ['projects.find_project'],
  autonomyTier: 'supervised',
  requiresApproval: false,
};

/** The skill that implements the assign-employee capability (cross-domain write). */
export const PROJECTS_ASSIGN_SKILL: AgentSkill = {
  id: 'projects.assign',
  description: 'Assigns an employee to a project in the current organization',
  toolIds: ['projects.assign_employee'],
  autonomyTier: 'supervised',
  requiresApproval: true,
};

/** The capability the AI discovers for project resolution. */
export const PROJECTS_FIND_CAPABILITY: CapabilityDeclaration = {
  id: 'projects.find_project',
  name: 'Find Project',
  description: 'Finds a project by name in the current organization',
  skillId: 'projects.find',
  sideEffectClass: 'read_only',
};

/** The canonical tool contract for the FindProjectTool. */
export const PROJECTS_FIND_TOOL: ToolContract = {
  id: 'projects.find_project',
  description: 'Finds a project by name in the current organization',
  sideEffectClass: 'read_only',
  idempotent: true,
  timeoutMs: 10_000,
  // ONLY the user-controlled name; identity/tenant/scope are never input.
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', minLength: 1, maxLength: 80 } },
    required: ['name'],
    additionalProperties: false,
  },
};

/**
 * The capability the AI discovers for assign-employee intent (the first
 * cross-domain write — HR employee + Projects project).
 */
export const PROJECTS_ASSIGN_CAPABILITY: CapabilityDeclaration = {
  id: 'projects.assign_employee',
  name: 'Assign Employee to Project',
  description: 'Assigns an employee to a project in the current organization',
  skillId: 'projects.assign',
  sideEffectClass: 'consequential',
};

/** The canonical tool contract for the AssignEmployeeToProjectTool. */
export const PROJECTS_ASSIGN_TOOL: ToolContract = {
  id: 'projects.assign_employee',
  description: 'Assigns an employee to a project in the current organization',
  sideEffectClass: 'consequential',
  idempotent: false,
  timeoutMs: 15_000,
  // ONLY the user-controlled names; identity/tenant/scope are never input.
  inputSchema: {
    type: 'object',
    properties: {
      employeeName: { type: 'string', minLength: 1, maxLength: 120 },
      projectName: { type: 'string', minLength: 1, maxLength: 80 },
    },
    required: ['employeeName', 'projectName'],
    additionalProperties: false,
  },
};

/** The capability the AI discovers for create-project intent (write). */
export const PROJECTS_CREATE_CAPABILITY: CapabilityDeclaration = {
  id: 'projects.create_project',
  name: 'Create Project',
  description: 'Creates a new project in the current organization',
  skillId: 'projects.create',
  sideEffectClass: 'consequential',
};

/** The canonical tool contract for the CreateProjectTool. */
export const PROJECTS_CREATE_TOOL: ToolContract = {
  id: 'projects.create_project',
  description: 'Creates a new project in the current organization',
  sideEffectClass: 'consequential',
  idempotent: false,
  timeoutMs: 15_000,
  // ONLY user-controlled business fields (name + optional description);
  // identity/tenant/scope are never input.
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 80 },
      description: { type: 'string', maxLength: 2000 },
    },
    required: ['name'],
    additionalProperties: false,
  },
};

/** The narration prompt id used by the orchestrator. */
export const NARRATION_PROMPT_ID = 'ai.narration.summary';

/** Dependencies required to build the AI runtime. */
export interface AiRuntimeDependencies {
  /** API configuration (Groq key + model). */
  config: ApiConfig;
  /** The membership-scoped workspaces handler the read tool delegates to. */
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** The application-layer create-workspace handler the write tool delegates to. */
  createWorkspace: CreateWorkspaceHandler;
  /** The application-layer create-project handler the write tool delegates to. */
  createProject: CreateProjectHandler;
  /** The tenant-scoped project resolution handler (read tool). */
  findProjectByName: FindProjectByNameHandler;
  /** The tenant-scoped employee resolution handler (HR read tool). */
  findEmployeeByName: FindEmployeeByNameHandler;
  /** The application-layer assignment handler (cross-domain write tool). */
  assignEmployeeToProject: AssignEmployeeToProjectHandler;
  /** The application-layer create-employee handler (HR write tool). */
  createEmployee: CreateEmployeeHandler;
  /** The application-layer create-calendar-event handler (Calendar write tool). */
  createCalendarEvent: CreateCalendarEventHandler;
  /** The workspace-scoped calendar read-back handler (Calendar write tool verification). */
  listCalendarEvents: ListCalendarEventsHandler;
  /** The permission-filtered knowledge retrieval handler (Knowledge read tool). */
  retrieveKnowledge: RetrieveKnowledgeHandler;
  /** Resolves organization memberships (the write tools' authorization rule). */
  listOrganizations: ListOrganizationsHandler;
  /** The recipient-scoped notification inbox handler (attention tool). */
  listNotifications: ListNotificationsHandler;
  /** The unread notification count handler (attention tool). */
  unreadNotifications: UnreadNotificationsCountHandler;
  /** The workspace-scoped activity handler (attention tool). */
  listActivity: ListActivityHandler;
  /** Workflow instance persistence (workflow vertical slice). */
  workflowInstances: WorkflowInstanceRepository;
  /** Workflow step-journal persistence. */
  workflowStepExecutions: WorkflowStepExecutionRepository;
  /** Publishes workflow events to the canonical event stream. */
  publisher: EventPublisher;
  /** Durable conversation store; defaults to in-memory (tests/local). */
  store?: ConversationStore;
}

/** The composed AI runtime surface exposed to routes. */
export interface AiRuntime {
  /** The Enterprise AI Orchestrator (the only entry point for chat). */
  orchestrator: EnterpriseAIOrchestrator;
  /** The conversation manager (persists user + assistant turns). */
  conversations: ConversationManager;
  /** The capability registry (discovery read-model). */
  registry: RuntimeRegistry;
  /** The executable tool registry. */
  tools: ExecutableToolRegistry;
  /** The conversation store backing the manager. */
  store: ConversationStore;
  /** The server-side approval engine (decisions are never client-controlled). */
  approvals: ApprovalEngine;
  /** The workflow application service (the workflow vertical slice surface). */
  workflows: WorkflowApplicationService;
}

/**
 * Builds the AI runtime: registers the workspaces capability surface and
 * composes the orchestrator. Registering is additive — future apps register
 * their own capabilities into the same registry without platform changes.
 */
export function buildAiRuntime(dependencies: AiRuntimeDependencies): AiRuntime {
  const { config } = dependencies;
  const registry = new RuntimeRegistry();
  const skills = new SkillIndex();
  const tools = new ExecutableToolRegistry();

  // Capability surface (workspaces — the first registered app capability).
  registry.register(
    registryEntries.agent({
      agent: WORKSPACES_AGENT,
      manifest: workspaceAgentManifest(),
      health: 'healthy',
      owner: 'workspaces',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: WORKSPACES_LIST_TOOL,
      owner: 'workspaces',
      version: '1.0.0',
      ownedByAgents: [WORKSPACES_AGENT.id],
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: WORKSPACES_CREATE_TOOL,
      owner: 'workspaces',
      version: '1.0.0',
      ownedByAgents: [WORKSPACES_AGENT.id],
    }),
  );
  registry.register(
    registryEntries.capability({
      capability: WORKSPACES_LIST_CAPABILITY,
      owner: 'workspaces',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.capability({
      capability: WORKSPACES_CREATE_CAPABILITY,
      owner: 'workspaces',
      version: '1.0.0',
    }),
  );
  skills.index(WORKSPACES_LIST_SKILL, WORKSPACES_AGENT.id, 'workspaces');
  skills.index(WORKSPACES_CREATE_SKILL, WORKSPACES_AGENT.id, 'workspaces');

  // Capability surface (projects — the first business app in the runtime).
  registry.register(
    registryEntries.agent({
      agent: PROJECTS_AGENT,
      manifest: projectsAgentManifest(),
      health: 'healthy',
      owner: 'projects',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: PROJECTS_CREATE_TOOL,
      owner: 'projects',
      version: '1.0.0',
      ownedByAgents: [PROJECTS_AGENT.id],
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: PROJECTS_FIND_TOOL,
      owner: 'projects',
      version: '1.0.0',
      ownedByAgents: [PROJECTS_AGENT.id],
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: PROJECTS_ASSIGN_TOOL,
      owner: 'projects',
      version: '1.0.0',
      ownedByAgents: [PROJECTS_AGENT.id],
    }),
  );
  registry.register(
    registryEntries.capability({
      capability: PROJECTS_CREATE_CAPABILITY,
      owner: 'projects',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.capability({
      capability: PROJECTS_FIND_CAPABILITY,
      owner: 'projects',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.capability({
      capability: PROJECTS_ASSIGN_CAPABILITY,
      owner: 'projects',
      version: '1.0.0',
    }),
  );
  skills.index(PROJECTS_CREATE_SKILL, PROJECTS_AGENT.id, 'projects');
  skills.index(PROJECTS_FIND_SKILL, PROJECTS_AGENT.id, 'projects');
  skills.index(PROJECTS_ASSIGN_SKILL, PROJECTS_AGENT.id, 'projects');

  // Capability surface (knowledge — permission-filtered workspace search).
  registry.register(
    registryEntries.agent({
      agent: KNOWLEDGE_AGENT,
      manifest: knowledgeAgentManifest(),
      health: 'healthy',
      owner: 'knowledge',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: KNOWLEDGE_SEARCH_TOOL,
      owner: 'knowledge',
      version: '1.0.0',
      ownedByAgents: [KNOWLEDGE_AGENT.id],
    }),
  );
  registry.register(
    registryEntries.capability({
      capability: KNOWLEDGE_SEARCH_CAPABILITY,
      owner: 'knowledge',
      version: '1.0.0',
    }),
  );
  skills.index(KNOWLEDGE_SEARCH_SKILL, KNOWLEDGE_AGENT.id, 'knowledge');

  // Capability surface (hr — the employee read capability + hire write).
  registry.register(
    registryEntries.agent({
      agent: HR_AGENT,
      manifest: hrAgentManifest(),
      health: 'healthy',
      owner: 'hr',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: HR_FIND_TOOL,
      owner: 'hr',
      version: '1.0.0',
      ownedByAgents: [HR_AGENT.id],
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: HR_CREATE_TOOL,
      owner: 'hr',
      version: '1.0.0',
      ownedByAgents: [HR_AGENT.id],
    }),
  );
  registry.register(
    registryEntries.capability({
      capability: HR_FIND_CAPABILITY,
      owner: 'hr',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.capability({
      capability: HR_CREATE_CAPABILITY,
      owner: 'hr',
      version: '1.0.0',
    }),
  );
  skills.index(HR_FIND_SKILL, HR_AGENT.id, 'hr');
  skills.index(HR_CREATE_SKILL, HR_AGENT.id, 'hr');

  // Capability surface (notifications — the attention read capability).
  registry.register(
    registryEntries.agent({
      agent: NOTIFICATIONS_AGENT,
      manifest: notificationsAgentManifest(),
      health: 'healthy',
      owner: 'notifications',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: NOTIFICATIONS_ATTENTION_TOOL,
      owner: 'notifications',
      version: '1.0.0',
      ownedByAgents: [NOTIFICATIONS_AGENT.id],
    }),
  );
  registry.register(
    registryEntries.capability({
      capability: NOTIFICATIONS_ATTENTION_CAPABILITY,
      owner: 'notifications',
      version: '1.0.0',
    }),
  );
  skills.index(NOTIFICATIONS_ATTENTION_SKILL, NOTIFICATIONS_AGENT.id, 'notifications');

  // Capability surface (calendar — the workspace-scoped event write).
  registry.register(
    registryEntries.agent({
      agent: CALENDAR_AGENT,
      manifest: calendarAgentManifest(),
      health: 'healthy',
      owner: 'calendar',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: CALENDAR_CREATE_TOOL,
      owner: 'calendar',
      version: '1.0.0',
      ownedByAgents: [CALENDAR_AGENT.id],
    }),
  );
  registry.register(
    registryEntries.capability({
      capability: CALENDAR_CREATE_CAPABILITY,
      owner: 'calendar',
      version: '1.0.0',
    }),
  );
  skills.index(CALENDAR_CREATE_SKILL, CALENDAR_AGENT.id, 'calendar');

  // Workflow surface: the workflow agent + tool contract are visible in the
  // registry (discovery read-model), but the workflow CAPABILITY is not a
  // token-matched entry — workflow intents are planned by the deterministic
  // workflow planner, never by token overlap (no phantom steps).
  registry.register(
    registryEntries.agent({
      agent: WORKFLOW_AGENT,
      manifest: workflowAgentManifest(),
      health: 'healthy',
      owner: 'workflow',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: WORKFLOW_TOOL_CONTRACT,
      owner: 'workflow',
      version: '1.0.0',
      ownedByAgents: [WORKFLOW_AGENT.id],
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: HIRE_WORKFLOW_TOOL_CONTRACT,
      owner: 'workflow',
      version: '1.0.0',
      ownedByAgents: [WORKFLOW_AGENT.id],
    }),
  );
  skills.index(WORKFLOW_RUN_SKILL, WORKFLOW_AGENT.id, 'workflow');

  // Executable tools (the only execution path). Identity flows from the
  // trusted execution context, never the model. The write tools delegate to
  // the application layer and are gated by the approval engine.
  tools.register(new ListWorkspacesTool(dependencies.listMyWorkspaces));
  tools.register(
    new CreateWorkspaceTool({
      createWorkspace: dependencies.createWorkspace,
      listOrganizations: dependencies.listOrganizations,
    }),
  );
  tools.register(
    new CreateProjectTool({
      createProject: dependencies.createProject,
      listOrganizations: dependencies.listOrganizations,
      // S24 Phase 4: read-back verification against persisted state.
      findProjectByName: dependencies.findProjectByName,
    }),
  );
  tools.register(new FindProjectTool(dependencies.findProjectByName));
  tools.register(new FindEmployeeTool(dependencies.findEmployeeByName));
  tools.register(new SearchKnowledgeTool(dependencies.retrieveKnowledge));
  tools.register(
    new WhatNeedsAttentionTool({
      listNotifications: dependencies.listNotifications,
      unreadCount: dependencies.unreadNotifications,
      listActivity: dependencies.listActivity,
    }),
  );
  tools.register(
    new CreateEmployeeTool({
      createEmployee: dependencies.createEmployee,
      listOrganizations: dependencies.listOrganizations,
    }),
  );
  tools.register(
    new AssignEmployeeToProjectTool({
      assignEmployeeToProject: dependencies.assignEmployeeToProject,
      findEmployeeByName: dependencies.findEmployeeByName,
      findProjectByName: dependencies.findProjectByName,
      listOrganizations: dependencies.listOrganizations,
    }),
  );
  tools.register(
    new CreateCalendarEventTool({
      createCalendarEvent: dependencies.createCalendarEvent,
      listOrganizations: dependencies.listOrganizations,
      listMyWorkspaces: dependencies.listMyWorkspaces,
      // S24 Phase 4: read-back verification against persisted state.
      listCalendarEvents: dependencies.listCalendarEvents,
    }),
  );

  // Server-side approval state: gated (write) actions execute ONLY after a
  // granted decision. The caller can never approve by modifying the prompt,
  // tool arguments, or request body (AIR.md §12; docs/APPROVAL.md). The same
  // engine gates workflow step approval points — one approval system.
  const approvals = new InMemoryApprovalEngine();

  // Workflow runtime: the journaled engine executes workflow steps through
  // the SAME ToolExecutor pipeline as AI tool calls (one execution path).
  // The workflow module stays free of Projects/HR logic — it orchestrates
  // capabilities by id through this adapter.
  const executor = new ToolExecutor({ tools });
  const workflowExecutor = new WorkflowToolStepExecutor(executor, tools);
  const workflowDefinitions = new WorkflowDefinitionRegistry([
    createProjectAndAssignWorkflowDefinition(),
    hireAndAssignEmployeeWorkflowDefinition(),
  ]);
  const workflowRuntime = new WorkflowRuntime({
    definitions: workflowDefinitions,
    instances: dependencies.workflowInstances,
    executions: dependencies.workflowStepExecutions,
    executor: workflowExecutor,
    approvals,
    publisher: dependencies.publisher,
  });
  const workflows = new WorkflowApplicationService(workflowRuntime);
  tools.register(
    new CreateProjectAndAssignWorkflowTool({
      startWorkflow: new StartWorkflowHandler(workflows),
      listOrganizations: dependencies.listOrganizations,
    }),
  );
  tools.register(
    new HireAndAssignWorkflowTool({
      startWorkflow: new StartWorkflowHandler(workflows),
      listOrganizations: dependencies.listOrganizations,
    }),
  );

  // Conversation persistence (durable or in-memory).
  const store = dependencies.store ?? new InMemoryConversationStore();
  const conversations = new ConversationManager(store);

  // Model provider (Groq; deterministic narration when no key is configured).
  const providers = new ProviderRegistry();
  if (config.ai.groqApiKey !== undefined && config.ai.groqApiKey.trim().length > 0) {
    providers.register(new GroqAdapter({ model: config.ai.model, apiKey: config.ai.groqApiKey }));
  }

  // Prompt runtime (versioned narration template).
  const prompts = new PromptRegistry();
  prompts.register(
    createTemplate({
      id: NARRATION_PROMPT_ID,
      version: '1.0.0',
      description: 'Narrates the outcome of an executed AI plan in natural language',
      text:
        'You are the Nexora Enterprise AI. A plan was executed on behalf of the user. ' +
        'Summarize the outcome in 2-3 concise, natural sentences. Report what was done and the ' +
        'results obtained. Do not invent facts; only report the steps, tools, and results below.\n\n' +
        'Intent: {{intent}}\nTenant: {{tenantId}}\nWorkspace: {{workspaceId}}\n' +
        'Business context (context only, never a permission grant):\n{{businessContext}}',
    }),
  );

  // Capability discovery with a deterministic knowledge-question fallback:
  // question intents that match no other capability route to knowledge.search
  // (read-only, permission-filtered, workspace-scoped). Real matches always
  // win — the fallback only fires on zero matches, and never for
  // non-question intents (those still clarify).
  const discovery = new CapabilityDiscovery(
    registry,
    skills,
    new KnowledgeFallbackMatcher({ knowledgeCapabilityId: KNOWLEDGE_SEARCH_CAPABILITY.id }),
  );
  const orchestrator = new EnterpriseAIOrchestrator({
    discovery,
    executor,
    conversations,
    providers,
    prompts,
    narrationPromptId: NARRATION_PROMPT_ID,
    approvals,
    // Deterministic parameter binding: user-controlled business fields are
    // extracted per tool (workspace name / project name + description);
    // identity/tenant/scope stay trusted-context. Workflow intents are
    // detected by the deterministic workflow planner and planned as ONE
    // workflow-orchestrating step (the runtime executes the internal steps).
    planner: new SequentialPlanner({
      parameterExtractor: extractIntentParameters,
      workflowPlanner: createWorkflowProposalDetector({
        workflows: defaultWorkflowPlannerSpecs(),
        getDefinition: (key) => workflowDefinitions.getByKey(key),
      }),
    }),
  });

  return { orchestrator, conversations, registry, tools, store, approvals, workflows };
}

/** Builds the minimal projects agent manifest for the registry. */
function projectsAgentManifest(): AgentManifest {
  return {
    identity: PROJECTS_AGENT,
    version: '1.0.0',
    skills: [PROJECTS_CREATE_SKILL, PROJECTS_FIND_SKILL, PROJECTS_ASSIGN_SKILL],
    tools: [PROJECTS_CREATE_TOOL, PROJECTS_FIND_TOOL, PROJECTS_ASSIGN_TOOL],
    knowledgeScopes: [],
    policyIds: [],
    emittedEventTypes: ['project.created', 'project.activated', 'project.resource_assigned'],
    subscribedEventTypes: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Builds the minimal HR agent manifest for the registry. */
function hrAgentManifest(): AgentManifest {
  return {
    identity: HR_AGENT,
    version: '1.0.0',
    skills: [HR_FIND_SKILL, HR_CREATE_SKILL],
    tools: [HR_FIND_TOOL, HR_CREATE_TOOL],
    knowledgeScopes: [],
    policyIds: [],
    emittedEventTypes: ['employee.created', 'employee.activated'],
    subscribedEventTypes: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Builds the minimal calendar agent manifest for the registry. */
function calendarAgentManifest(): AgentManifest {
  return {
    identity: CALENDAR_AGENT,
    version: '1.0.0',
    skills: [CALENDAR_CREATE_SKILL],
    tools: [CALENDAR_CREATE_TOOL],
    knowledgeScopes: [],
    policyIds: [],
    emittedEventTypes: [
      'calendar.event.created',
      'calendar.event.updated',
      'calendar.event.cancelled',
    ],
    subscribedEventTypes: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Builds the minimal knowledge agent manifest for the registry. */
function knowledgeAgentManifest(): AgentManifest {
  return {
    identity: KNOWLEDGE_AGENT,
    version: '1.0.0',
    skills: [KNOWLEDGE_SEARCH_SKILL],
    tools: [KNOWLEDGE_SEARCH_TOOL],
    knowledgeScopes: [],
    policyIds: [],
    emittedEventTypes: [
      'knowledge.indexed',
      'knowledge.removed',
      'knowledge.article.created',
      'knowledge.article.updated',
      'knowledge.article.published',
      'knowledge.article.archived',
      'knowledge.category.created',
      'knowledge.category.archived',
    ],
    subscribedEventTypes: ['document.available'],
    updatedAt: new Date().toISOString(),
  };
}

/** Builds the minimal workspaces agent manifest for the registry. */
function workspaceAgentManifest(): AgentManifest {
  return {
    identity: WORKSPACES_AGENT,
    version: '1.0.0',
    skills: [WORKSPACES_LIST_SKILL, WORKSPACES_CREATE_SKILL],
    tools: [WORKSPACES_LIST_TOOL, WORKSPACES_CREATE_TOOL],
    knowledgeScopes: [],
    policyIds: [],
    emittedEventTypes: [],
    subscribedEventTypes: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Builds the minimal notifications agent manifest for the registry. */
function notificationsAgentManifest(): AgentManifest {
  return {
    identity: NOTIFICATIONS_AGENT,
    version: '1.0.0',
    skills: [NOTIFICATIONS_ATTENTION_SKILL],
    tools: [NOTIFICATIONS_ATTENTION_TOOL],
    knowledgeScopes: [],
    policyIds: [],
    emittedEventTypes: ['notification.created', 'notification.read'],
    subscribedEventTypes: [
      'project.created',
      'employee.created',
      'workflow.completed',
      'workflow.failed',
      'workflow.waiting_for_approval',
      'document.available',
      'document.processing_failed',
      'knowledge.indexed',
    ],
    updatedAt: new Date().toISOString(),
  };
}

/** Builds the minimal workflow agent manifest for the registry. */
function workflowAgentManifest(): AgentManifest {
  return {
    identity: WORKFLOW_AGENT,
    version: '1.0.0',
    skills: [WORKFLOW_RUN_SKILL],
    tools: [WORKFLOW_TOOL_CONTRACT, HIRE_WORKFLOW_TOOL_CONTRACT],
    knowledgeScopes: [],
    policyIds: [],
    emittedEventTypes: [
      'workflow.created',
      'workflow.started',
      'workflow.step.started',
      'workflow.step.completed',
      'workflow.step.failed',
      'workflow.waiting_for_approval',
      'workflow.completed',
      'workflow.failed',
      'workflow.cancelled',
    ],
    subscribedEventTypes: [],
    updatedAt: new Date().toISOString(),
  };
}
