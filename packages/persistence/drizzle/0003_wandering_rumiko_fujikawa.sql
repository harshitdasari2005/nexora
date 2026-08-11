CREATE TABLE IF NOT EXISTS "conversations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64),
	"turns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_tenant_user_idx" ON "conversations" USING btree ("tenant_id","user_id");