CREATE TABLE IF NOT EXISTS "hiring_requisitions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"requested_by" varchar(64) NOT NULL,
	"job_title" varchar(120) NOT NULL,
	"department" varchar(80) NOT NULL,
	"project_id" varchar(64),
	"headcount" integer NOT NULL,
	"employment_type" varchar(32) NOT NULL,
	"salary_min_minor_units" bigint NOT NULL,
	"salary_max_minor_units" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"justification" text NOT NULL,
	"urgency" varchar(16) NOT NULL,
	"target_start_date" varchar(10),
	"status" varchar(32) NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"history" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hiring_requisitions_org_idx" ON "hiring_requisitions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hiring_requisitions_requester_idx" ON "hiring_requisitions" USING btree ("organization_id","requested_by");