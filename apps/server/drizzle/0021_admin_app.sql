CREATE TABLE "admin_devices" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"kinds" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_push_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"amount_cents" integer,
	"currency" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_devices" ADD CONSTRAINT "admin_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_devices" ADD CONSTRAINT "admin_devices_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_events" ADD CONSTRAINT "admin_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_devices_user_idx" ON "admin_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_events_created_idx" ON "admin_events" USING btree ("created_at");