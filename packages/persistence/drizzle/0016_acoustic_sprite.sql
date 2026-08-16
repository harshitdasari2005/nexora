CREATE TABLE IF NOT EXISTS "business_problems" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"correlation_id" varchar(256) NOT NULL,
	"signal_id" varchar(64) NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64),
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"severity" varchar(16) NOT NULL,
	"status" varchar(32) NOT NULL,
	"affected_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_problems_tenant_idx" ON "business_problems" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_problems_tenant_workspace_idx" ON "business_problems" USING btree ("tenant_id","workspace_id","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_problems_correlation_unique" ON "business_problems" USING btree ("tenant_id","correlation_id");