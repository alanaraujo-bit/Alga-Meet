CREATE TABLE "release_notes" (
	"version" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "release_reactions" (
	"version" text NOT NULL,
	"item_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"value" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_reactions_version_item_id_user_id_pk" PRIMARY KEY("version","item_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "release_notes" ADD CONSTRAINT "release_notes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_reactions" ADD CONSTRAINT "release_reactions_version_release_notes_version_fk" FOREIGN KEY ("version") REFERENCES "public"."release_notes"("version") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "release_reactions" ADD CONSTRAINT "release_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_reactions_user_idx" ON "release_reactions" USING btree ("user_id");