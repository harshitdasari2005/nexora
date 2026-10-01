CREATE TABLE IF NOT EXISTS "runtime_runs" (
	"id" varchar(96) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64),
	"request_id" varchar(96),
	"correlation_id" varchar(96),
	"actor_id" varchar(64) NOT NULL,
	"agent_id" varchar(64),
	"delegation_id" varchar(64),
	"origin" varchar(24) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_ms" double precision NOT NULL,
	"status" varchar(16) NOT NULL,
	"failure_stage" varchar(24),
	"failure_code" varchar(48),
	"failure_class" varchar(24),
	"provider" varchar(48),
	"model" varchar(128),
	"model_execution" varchar(12),
	"verified" boolean,
	"tokens_available" boolean NOT NULL,
	"total_tokens" integer NOT NULL,
	"cost" double precision,
	"record" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_runs_tenant_time_idx" ON "runtime_runs" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_runs_tenant_workspace_time_idx" ON "runtime_runs" USING btree ("tenant_id","workspace_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_runs_tenant_status_idx" ON "runtime_runs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_runs_tenant_failure_stage_idx" ON "runtime_runs" USING btree ("tenant_id","failure_stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_runs_tenant_provider_model_idx" ON "runtime_runs" USING btree ("tenant_id","provider","model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_runs_tenant_agent_idx" ON "runtime_runs" USING btree ("tenant_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_runs_tenant_request_idx" ON "runtime_runs" USING btree ("tenant_id","request_id");