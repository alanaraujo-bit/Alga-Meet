CREATE TABLE "email_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "users_email_key";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
-- Hand-written: accounts created before e-mail verification existed keep logging in by e-mail and keep their limits.
-- Their addresses were never proven, but they were unique (the old users_email_key), so the new partial index holds.
UPDATE "users" SET "email_verified_at" = "created_at";--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_tokens_user_id_idx" ON "email_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_verified_email_key" ON "users" USING btree ("email") WHERE "users"."email_verified_at" is not null;--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");