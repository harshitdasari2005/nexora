CREATE TABLE IF NOT EXISTS "documents" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"uploader_id" varchar(64) NOT NULL,
	"title" varchar(200) NOT NULL,
	"content_type" varchar(64) NOT NULL,
	"content_ref" varchar(256) NOT NULL,
	"status" varchar(32) NOT NULL,
	"failure_reason" text,
	"content_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_sources" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"document_id" varchar(64) NOT NULL,
	"title" varchar(200) NOT NULL,
	"text" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"indexed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_instances" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"definition_id" varchar(64) NOT NULL,
	"definition_key" varchar(128) NOT NULL,
	"definition_version" integer DEFAULT 1 NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64),
	"correlation_id" varchar(128) NOT NULL,
	"status" varchar(32) NOT NULL,
	"input" jsonb NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"current_step_id" varchar(64),
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_step_executions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(64) NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"step_id" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"capability_id" varchar(128) NOT NULL,
	"tool_id" varchar(128) NOT NULL,
	"status" varchar(32) NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"execution_key" varchar(256) NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"approval_id" varchar(64),
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_org_idx" ON "documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_workspace_idx" ON "documents" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_sources_tenant_idx" ON "knowledge_sources" USING btree ("tenant_id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_sources_document_unique" ON "knowledge_sources" USING btree ("tenant_id","workspace_id","document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_instances_tenant_idx" ON "workflow_instances" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_step_exec_workflow_idx" ON "workflow_step_executions" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_step_exec_tenant_idx" ON "workflow_step_executions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_step_exec_key_unique" ON "workflow_step_executions" USING btree ("execution_key");