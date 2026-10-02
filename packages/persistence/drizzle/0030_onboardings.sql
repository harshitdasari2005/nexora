CREATE TABLE IF NOT EXISTS "onboardings" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"employee_id" varchar(64) NOT NULL,
	"employee_name" varchar(160) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"hiring_manager_id" varchar(64) NOT NULL,
	"project_id" varchar(64),
	"started_by" varchar(64) NOT NULL,
	"status" varchar(32) NOT NULL,
	"items" jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboardings_org_idx" ON "onboardings" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onboardings_employee_unique" ON "onboardings" USING btree ("organization_id","employee_id");