CREATE TABLE IF NOT EXISTS "document_templates" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"content_type" varchar(64) NOT NULL,
	"content_ref" varchar(256) NOT NULL,
	"status" varchar(32) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_versions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"document_id" varchar(64) NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"version" integer NOT NULL,
	"content_ref" varchar(256) NOT NULL,
	"content_type" varchar(64) NOT NULL,
	"restored_from_version" integer,
	"created_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_templates_org_idx" ON "document_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_templates_workspace_idx" ON "document_templates" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_versions_document_idx" ON "document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_versions_document_version_unique" ON "document_versions" USING btree ("document_id","version");