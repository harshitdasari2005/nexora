CREATE TABLE IF NOT EXISTS "remediation_plan_steps" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"plan_id" varchar(64) NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"sequence" integer NOT NULL,
	"action" varchar(240) NOT NULL,
	"capability_id" varchar(128) NOT NULL,
	"description" text NOT NULL,
	"rationale" text NOT NULL,
	"dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approval_requirement" varchar(16) NOT NULL,
	"required_approver_role_id" varchar(128),
	"verification_requirement" text NOT NULL,
	"status" varchar(32) NOT NULL,
	"result" jsonb,
	"evidence" jsonb,
	"approval_id" varchar(64),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "remediation_plans" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"problem_id" varchar(64) NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64),
	"agent_id" varchar(64) NOT NULL,
	"role_id" varchar(128) NOT NULL,
	"title" varchar(200) NOT NULL,
	"objective" text NOT NULL,
	"status" varchar(32) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"replan_count" integer DEFAULT 0 NOT NULL,
	"grounded_solution_id" varchar(128),
	"reason" text,
	"outcome" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "plan_id" varchar(64);--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "step_id" varchar(64);--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "problem_id" varchar(64);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remediation_steps_plan_idx" ON "remediation_plan_steps" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remediation_steps_tenant_idx" ON "remediation_plan_steps" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remediation_plans_tenant_idx" ON "remediation_plans" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remediation_plans_tenant_problem_idx" ON "remediation_plans" USING btree ("tenant_id","problem_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remediation_plans_tenant_workspace_idx" ON "remediation_plans" USING btree ("tenant_id","workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_executions_plan_idx" ON "agent_executions" USING btree ("tenant_id","plan_id");