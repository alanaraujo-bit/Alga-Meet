CREATE TABLE "space_bans" (
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"moderator_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_bans_space_id_user_id_pk" PRIMARY KEY("space_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "server_mute" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "server_deaf" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "space_bans" ADD CONSTRAINT "space_bans_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_bans" ADD CONSTRAINT "space_bans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_bans" ADD CONSTRAINT "space_bans_moderator_id_users_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- CHANGE_NICKNAME (1 << 18) joined the @everyone defaults; existing spaces get it too.
UPDATE "roles" SET "permissions" = "permissions" | 262144 WHERE "id" = "space_id";
