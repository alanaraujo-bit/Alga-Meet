CREATE TABLE "space_sounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"storage_key" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"gain_db" real DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "space_sounds" ADD CONSTRAINT "space_sounds_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_sounds" ADD CONSTRAINT "space_sounds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_sounds_space_id_idx" ON "space_sounds" USING btree ("space_id");--> statement-breakpoint
-- Hand-written (drizzle-kit does not manage triggers): every sound row removed, by DELETE or by cascade from its
-- space, queues its object for Files.sweep (same as attachments, 0002).
CREATE FUNCTION "space_sounds_queue_object_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO "storage_deletions" ("key") VALUES (OLD."storage_key")
		ON CONFLICT ("key") DO UPDATE SET "not_before" = now();
	RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "space_sounds_after_delete" AFTER DELETE ON "space_sounds"
	FOR EACH ROW EXECUTE FUNCTION "space_sounds_queue_object_delete"();
--> statement-breakpoint
-- USE_SOUNDBOARD (1 << 21) for @everyone of existing spaces (packages/shared/src/permissions.ts).
UPDATE "roles" SET "permissions" = "permissions" | 2097152 WHERE "id" = "space_id";
