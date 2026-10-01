CREATE TABLE IF NOT EXISTS "lineage_records" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64),
	"run_id" varchar(96) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"seq" integer NOT NULL,
	"actor_id" varchar(64),
	"agent_id" varchar(64),
	"delegation_id" varchar(64),
	"approval_id" varchar(64),
	"invocation_id" varchar(64),
	"subject_type" varchar(48),
	"subject_id" varchar(200),
	"fingerprint" varchar(64),
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lineage_tenant_run_idx" ON "lineage_records" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lineage_tenant_approval_idx" ON "lineage_records" USING btree ("tenant_id","approval_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lineage_tenant_workspace_time_idx" ON "lineage_records" USING btree ("tenant_id","workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lineage_tenant_subject_idx" ON "lineage_records" USING btree ("tenant_id","kind","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lineage_tenant_invocation_idx" ON "lineage_records" USING btree ("tenant_id","invocation_id");