CREATE TABLE "world_rooms" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"access" text DEFAULT 'call' NOT NULL,
	"shell" text DEFAULT 'loft' NOT NULL,
	"finish" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "world_avatar" jsonb;--> statement-breakpoint
ALTER TABLE "world_rooms" ADD CONSTRAINT "world_rooms_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;