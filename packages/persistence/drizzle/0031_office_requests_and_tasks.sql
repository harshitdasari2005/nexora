CREATE TABLE IF NOT EXISTS "office_requests" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"requested_by" varchar(64) NOT NULL,
	"type" varchar(32) NOT NULL,
	"details" jsonb NOT NULL,
	"stages" jsonb NOT NULL,
	"stage_index" integer DEFAULT 0 NOT NULL,
	"status" varchar(32) NOT NULL,
	"history" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_tasks" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" text,
	"priority" varchar(16) NOT NULL,
	"due_date" varchar(10),
	"assignee_id" varchar(64) NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"status" varchar(32) NOT NULL,
	"history" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "office_requests_org_idx" ON "office_requests" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "office_requests_requester_idx" ON "office_requests" USING btree ("organization_id","requested_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_org_idx" ON "project_tasks" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_assignee_idx" ON "project_tasks" USING btree ("organization_id","assignee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_project_idx" ON "project_tasks" USING btree ("organization_id","project_id");