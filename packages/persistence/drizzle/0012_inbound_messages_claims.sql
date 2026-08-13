CREATE TABLE IF NOT EXISTS "inbound_messages" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"message_id" varchar(254) NOT NULL,
	"action" varchar(64) NOT NULL,
	"target_id" varchar(128) NOT NULL,
	"handled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_messages_tenant_idx" ON "inbound_messages" USING btree ("tenant_id","handled_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_messages_message_unique" ON "inbound_messages" USING btree ("tenant_id","message_id");