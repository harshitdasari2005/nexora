CREATE TABLE IF NOT EXISTS "knowledge_articles" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"category_id" varchar(64),
	"status" varchar(32) NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"author" varchar(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_categories" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "kind" varchar(16) DEFAULT 'document' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_articles_tenant_idx" ON "knowledge_articles" USING btree ("tenant_id","workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_articles_category_idx" ON "knowledge_articles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_categories_tenant_idx" ON "knowledge_categories" USING btree ("tenant_id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_categories_scope_name_unique" ON "knowledge_categories" USING btree ("tenant_id","workspace_id","name");