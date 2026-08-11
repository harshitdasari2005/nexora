DROP INDEX IF EXISTS "roles_name_unique";--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "tenant_id" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roles_name_tenant_unique" ON "roles" USING btree ("tenant_id","name");