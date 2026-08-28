CREATE TABLE IF NOT EXISTS "budgets" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"allocated_minor_units" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" varchar(32) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expenses" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"budget_id" varchar(64) NOT NULL,
	"submitted_by" varchar(64) NOT NULL,
	"description" varchar(120) NOT NULL,
	"amount_minor_units" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(32) NOT NULL,
	"decided_by" varchar(64),
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budgets_org_idx" ON "budgets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budgets_workspace_idx" ON "budgets" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_org_idx" ON "expenses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_workspace_idx" ON "expenses" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_budget_idx" ON "expenses" USING btree ("budget_id","status");