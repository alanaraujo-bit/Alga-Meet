CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer
);
--> statement-breakpoint
CREATE TABLE "storage_deletions" (
	"key" text PRIMARY KEY NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_message_id_idx" ON "attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "storage_deletions_not_before_idx" ON "storage_deletions" USING btree ("not_before");--> statement-breakpoint
-- Hand-written (drizzle-kit does not manage triggers): every attachment row removed, by DELETE or by cascade from its
-- message, channel or space, queues its object for Files.sweep. Keeps storage in step with every delete path.
CREATE FUNCTION "attachments_queue_object_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO "storage_deletions" ("key") VALUES (OLD."storage_key")
		ON CONFLICT ("key") DO UPDATE SET "not_before" = now();
	RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "attachments_after_delete" AFTER DELETE ON "attachments"
	FOR EACH ROW EXECUTE FUNCTION "attachments_queue_object_delete"();
--> statement-breakpoint
-- M9: avatar/icon URLs now must point to our own storage. Nothing stored before this migration does (there was no
-- upload), so external URLs (possible tracking pixels) are cleared.
UPDATE "users" SET "avatar_url" = NULL WHERE "avatar_url" IS NOT NULL;
--> statement-breakpoint
UPDATE "spaces" SET "icon_url" = NULL WHERE "icon_url" IS NOT NULL;
