CREATE TABLE IF NOT EXISTS "employees" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"status" varchar(32) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_assignments" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"employee_id" varchar(64) NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employees_org_idx" ON "employees" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_assignments_org_idx" ON "resource_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_assignments_project_idx" ON "resource_assignments" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_assignments_project_employee_unique" ON "resource_assignments" USING btree ("project_id","employee_id");