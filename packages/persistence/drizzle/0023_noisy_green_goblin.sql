ALTER TABLE "approval_requests" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "required_approver_role_id" varchar(96);--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "separation_of_duties" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "policy_settings" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "policy_settings" ADD COLUMN "reason" varchar(500);--> statement-breakpoint
ALTER TABLE "policy_settings" ADD COLUMN "config_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "policy_settings" ADD COLUMN "change_type" varchar(24) DEFAULT 'version' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_expiry_idx" ON "approval_requests" USING btree ("tenant_id","status","expires_at");