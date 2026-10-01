-- AUTH-004: never store raw session bearer tokens.
--
-- Sessions are looked up by the SHA-256 hex digest of the cookie token
-- (`token_hash`); the raw `token` column is removed. Every row written so far
-- holds a RAW, still-usable bearer token, so this migration intentionally
-- INVALIDATES all existing sessions (users must sign in again) and keeps no
-- compatibility path: raw tokens are never accepted again.
ALTER TABLE "sessions" ADD COLUMN "token_hash" varchar(64);--> statement-breakpoint
-- Existing sessions are ended: a leaked raw token from before this migration can no longer authenticate.
UPDATE "sessions"
   SET "status" = 'revoked',
       "ended_at" = COALESCE("ended_at", now())
 WHERE "status" = 'active';--> statement-breakpoint
-- Every row (now inactive) gets a digest of its old token so the column can be NOT NULL and unique;
-- the raw value is dropped below.
UPDATE "sessions" SET "token_hash" = encode(sha256(convert_to("token", 'UTF8')), 'hex');--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_token_unique";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "token";
