CREATE TABLE IF NOT EXISTS "workspace_invites" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"seat" varchar(32) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"label" varchar(120) NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by" varchar(64),
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_invites_token_unique" ON "workspace_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invites_org_idx" ON "workspace_invites" USING btree ("organization_id","created_at");