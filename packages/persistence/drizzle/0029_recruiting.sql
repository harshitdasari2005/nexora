CREATE TABLE IF NOT EXISTS "candidates" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"opening_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"email" varchar(254) NOT NULL,
	"phone" varchar(40),
	"source" varchar(32) NOT NULL,
	"resume_notes" text,
	"stage" varchar(32) NOT NULL,
	"feedback" jsonb NOT NULL,
	"offer" jsonb,
	"closed_reason" varchar(500),
	"employee_id" varchar(64),
	"history" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_openings" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"requisition_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"hiring_manager_id" varchar(64) NOT NULL,
	"opened_by" varchar(64) NOT NULL,
	"title" varchar(120) NOT NULL,
	"department" varchar(80) NOT NULL,
	"headcount" integer NOT NULL,
	"employment_type" varchar(32) NOT NULL,
	"salary_min_minor_units" bigint NOT NULL,
	"salary_max_minor_units" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"description" text NOT NULL,
	"status" varchar(32) NOT NULL,
	"offers_out" integer DEFAULT 0 NOT NULL,
	"hired_count" integer DEFAULT 0 NOT NULL,
	"closed_reason" varchar(500),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "email" varchar(254);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "job_title" varchar(120);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "department" varchar(80);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "employment_type" varchar(32);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "start_date" varchar(10);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "requisition_id" varchar(64);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_opening_idx" ON "candidates" USING btree ("organization_id","opening_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_openings_org_idx" ON "job_openings" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_openings_requisition_unique" ON "job_openings" USING btree ("organization_id","requisition_id");