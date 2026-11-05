ALTER TABLE "messages" ADD COLUMN "nonce" text;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_channel_author_nonce_uq" ON "messages" USING btree ("channel_id","author_id","nonce");