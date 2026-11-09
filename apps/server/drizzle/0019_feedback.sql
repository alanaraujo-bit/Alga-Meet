CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"client" text,
	"context" jsonb NOT NULL,
	"log" text,
	"storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_user_created_idx" ON "feedback" USING btree ("user_id","created_at");--> statement-breakpoint
-- Hand-written (drizzle-kit does not manage triggers): a feedback row removed with its account queues its screenshot
-- object for Files.sweep (same as attachments, 0002, and sounds, 0013). Rows without a screenshot queue nothing.
CREATE FUNCTION "feedback_queue_object_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO "storage_deletions" ("key") VALUES (OLD."storage_key")
		ON CONFLICT ("key") DO UPDATE SET "not_before" = now();
	RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "feedback_after_delete" AFTER DELETE ON "feedback"
	FOR EACH ROW WHEN (OLD."storage_key" IS NOT NULL) EXECUTE FUNCTION "feedback_queue_object_delete"();