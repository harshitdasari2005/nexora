CREATE TABLE IF NOT EXISTS "agent_delegations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"agent_id" varchar(64) NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"granted_by_user_id" varchar(64) NOT NULL,
	"capability_id" varchar(128) NOT NULL,
	"resource_scope" jsonb,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" varchar(64),
	"revoke_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"definition_id" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"owner_user_id" varchar(64) NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"status_changed_by" varchar(64),
	"status_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "agent_identity_id" varchar(64);--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "delegation_ids" jsonb;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "approval_id" varchar(64);--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "agent_id" varchar(64);--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "delegation_id" varchar(64);--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "origin" varchar(32);--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "agent_id" varchar(64);--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "delegation_id" varchar(64);--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "approval_id" varchar(64);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_delegations_agent_idx" ON "agent_delegations" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_delegations_workspace_idx" ON "agent_delegations" USING btree ("organization_id","workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_workspace_idx" ON "agents" USING btree ("organization_id","workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_owner_idx" ON "agents" USING btree ("organization_id","owner_user_id");