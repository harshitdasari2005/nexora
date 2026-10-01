CREATE TABLE IF NOT EXISTS "policy_settings" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"policy_id" varchar(96) NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "policy" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "policy_settings_version_unique" ON "policy_settings" USING btree ("organization_id","policy_id","version");