CREATE TABLE IF NOT EXISTS "activity_items" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64),
	"type" varchar(128) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"actor_id" varchar(64),
	"source_event_id" varchar(128) NOT NULL,
	"correlation_id" varchar(128) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_preferences" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"categories" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"recipient_id" varchar(64) NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64),
	"type" varchar(128) NOT NULL,
	"category" varchar(32) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"priority" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'unread' NOT NULL,
	"action" jsonb,
	"source_event_id" varchar(128) NOT NULL,
	"correlation_id" varchar(128) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_items_workspace_idx" ON "activity_items" USING btree ("tenant_id","workspace_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activity_items_source_unique" ON "activity_items" USING btree ("tenant_id","source_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_prefs_user_tenant_unique" ON "notification_preferences" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_recipient_idx" ON "notifications" USING btree ("tenant_id","recipient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_source_recipient_unique" ON "notifications" USING btree ("tenant_id","source_event_id","recipient_id");