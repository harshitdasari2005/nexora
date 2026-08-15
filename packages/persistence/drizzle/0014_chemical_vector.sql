CREATE TABLE IF NOT EXISTS "approval_requests" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64),
	"conversation_id" varchar(64) NOT NULL,
	"run_id" varchar(64) NOT NULL,
	"step_id" varchar(64) NOT NULL,
	"tool_id" varchar(128) NOT NULL,
	"capability_id" varchar(128) NOT NULL,
	"side_effect_class" varchar(32) NOT NULL,
	"reason" text NOT NULL,
	"intent" text NOT NULL,
	"input" jsonb NOT NULL,
	"resume_key" varchar(128),
	"status" varchar(32) NOT NULL,
	"decision" varchar(16),
	"decision_reason" text,
	"decided_by" varchar(64),
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"result" jsonb,
	"error" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_tenant_idx" ON "approval_requests" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_conversation_idx" ON "approval_requests" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_user_idx" ON "approval_requests" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_requests_resume_key_unique" ON "approval_requests" USING btree ("tenant_id","resume_key");