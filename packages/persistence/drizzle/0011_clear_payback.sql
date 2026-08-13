CREATE TABLE IF NOT EXISTS "email_outbox" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64),
	"recipient_id" varchar(64) NOT NULL,
	"recipient_email" varchar(254) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"source_event_id" varchar(128) NOT NULL,
	"correlation_id" varchar(128) NOT NULL,
	"dispatched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"endpoint_id" varchar(64) NOT NULL,
	"event_id" varchar(128) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"status" varchar(16) NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status_code" integer,
	"error" text,
	"delivered_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"url" varchar(2048) NOT NULL,
	"secret" varchar(128) NOT NULL,
	"event_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_outbox_tenant_idx" ON "email_outbox" USING btree ("tenant_id","recipient_id","dispatched_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_outbox_source_event_unique" ON "email_outbox" USING btree ("tenant_id","source_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("organization_id","endpoint_id","delivered_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_endpoints_workspace_idx" ON "webhook_endpoints" USING btree ("organization_id","workspace_id");