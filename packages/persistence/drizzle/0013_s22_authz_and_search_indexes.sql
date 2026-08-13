DROP INDEX IF EXISTS "knowledge_sources_tenant_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_membership_user_idx" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ws_membership_user_idx" ON "workspace_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_sources_tenant_idx" ON "knowledge_sources" USING btree ("tenant_id","workspace_id","indexed_at" desc);