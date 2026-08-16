CREATE TABLE IF NOT EXISTS "agent_executions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64),
	"agent_id" varchar(64) NOT NULL,
	"role_id" varchar(128) NOT NULL,
	"domain_id" varchar(64) NOT NULL,
	"proposal_id" varchar(128),
	"proposal_action" text,
	"status" varchar(32) NOT NULL,
	"run_id" varchar(64),
	"reason" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_executions_tenant_idx" ON "agent_executions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_executions_tenant_user_idx" ON "agent_executions" USING btree ("tenant_id","user_id","created_at");