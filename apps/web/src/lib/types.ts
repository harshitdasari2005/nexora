/**
 * @nexora/app-web — client DTO types.
 *
 * The API response shapes consumed by the SPA (mirrors the application-layer
 * DTOs; API_CONTRACTS.md).
 */

/** A user as seen by the client. */
export interface UserDto {
  id: string;
  email: string;
  username: string;
  displayName: string;
  status: string;
  createdAt: string;
}

/** An organization as seen by the client. */
export interface OrganizationDto {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  createdAt: string;
}

/** A workspace as seen by the client. */
export interface WorkspaceDto {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  createdAt: string;
}

/** The `/me` response. */
export interface MeResponse {
  user: UserDto;
  organizations: OrganizationDto[];
}

/** An employee as seen by the client (HR vertical slice). */
export interface EmployeeDto {
  id: string;
  organizationId: string;
  name: string;
  status: string;
  createdAt: string;
}

/** A document as seen by the client (Documents + Knowledge vertical slice). */
export interface DocumentDto {
  id: string;
  organizationId: string;
  workspaceId: string;
  uploaderId: string;
  title: string;
  contentType: string;
  status: string;
  failureReason?: string;
  contentVersion: number;
  createdAt: string;
}

/** A project as seen by the client. */
export interface ProjectDto {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  status: string;
  createdAt: string;
}

/** The `/dashboard` response. */
export interface DashboardResponse {
  user: UserDto;
  organization: OrganizationDto | null;
  workspace: WorkspaceDto | null;
  installedApps: never[];
  recentActivity: never[];
}

/** A workflow instance as seen by the client (read-only execution view). */
export interface WorkflowInstanceDto {
  id: string;
  definitionId: string;
  definitionKey: string;
  tenantId: string;
  userId: string;
  workspaceId?: string;
  correlationId: string;
  status: string;
  currentStepId?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

/** A workflow step execution (the journal). */
export interface WorkflowStepExecutionDto {
  id: string;
  workflowId: string;
  tenantId: string;
  stepId: string;
  name: string;
  capabilityId: string;
  toolId: string;
  status: string;
  attempt: number;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  approvalId?: string;
  startedAt: string;
  finishedAt?: string;
}

/** A full workflow execution record (detail view). */
export interface WorkflowExecutionRecordDto {
  instance: WorkflowInstanceDto;
  steps: readonly WorkflowStepExecutionDto[];
}

/** A notification as seen by the client (Notification vertical slice). */
export interface NotificationDto {
  id: string;
  type: string;
  category: string;
  title: string;
  body: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'unread' | 'read';
  action?: { kind: 'approval' | 'navigate'; href: string; label: string };
  createdAt: string;
  readAt?: string;
}

/** An activity feed item as seen by the client (read model). */
export interface ActivityItemDto {
  id: string;
  type: string;
  title: string;
  body: string;
  actorId?: string;
  occurredAt: string;
}

/** The notification preferences as seen by the client. */
export interface NotificationPreferencesDto {
  categories: Record<string, boolean>;
  updatedAt: string;
}
