CREATE TABLE IF NOT EXISTS "calendar_events" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"title" varchar(120) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" varchar(32) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_org_idx" ON "calendar_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_workspace_idx" ON "calendar_events" USING btree ("workspace_id","starts_at");