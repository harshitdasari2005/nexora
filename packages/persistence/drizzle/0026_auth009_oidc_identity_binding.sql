-- AUTH-009: bind an account to its external OIDC identity (issuer + subject).
-- Both columns are NULLABLE and existing rows are left exactly as they are: real
-- issuer/subject values cannot be derived from stored data, so nothing is invented
-- or backfilled. An existing user is bound at its next successful OIDC login. The
-- partial unique index allows any number of unbound (NULL) users and forbids two
-- accounts bound to the same identity. Sessions are untouched.
ALTER TABLE "users" ADD COLUMN "oidc_issuer" varchar(512);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "oidc_subject" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_oidc_identity_unique" ON "users" USING btree ("oidc_issuer","oidc_subject") WHERE "users"."oidc_issuer" IS NOT NULL AND "users"."oidc_subject" IS NOT NULL;