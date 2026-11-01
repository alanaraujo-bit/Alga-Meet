CREATE TABLE "activity_days" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"flags" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "activity_emails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"show_in_others_recap" boolean DEFAULT true NOT NULL,
	"metrics_opt_out" boolean DEFAULT false NOT NULL,
	"activity_email" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"emails_since_seen" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_reminders" (
	"event_id" uuid NOT NULL,
	"occurrence_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_reminders_event_id_occurrence_at_kind_pk" PRIMARY KEY("event_id","occurrence_at","kind")
);
--> statement-breakpoint
CREATE TABLE "event_rsvps" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"email_reminder" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rsvps_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"channel_id" uuid,
	"creator_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"template" text,
	"starts_local" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"weekly" boolean DEFAULT false NOT NULL,
	"cover" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"job" text NOT NULL,
	"period" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "job_runs_job_period_pk" PRIMARY KEY("job","period")
);
--> statement-breakpoint
CREATE TABLE "metric_cohorts" (
	"cohort_day" date NOT NULL,
	"metric" text NOT NULL,
	"size" integer,
	"value" integer,
	CONSTRAINT "metric_cohorts_cohort_day_metric_pk" PRIMARY KEY("cohort_day","metric")
);
--> statement-breakpoint
CREATE TABLE "metric_daily" (
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"value" integer,
	CONSTRAINT "metric_daily_day_metric_pk" PRIMARY KEY("day","metric")
);
--> statement-breakpoint
CREATE TABLE "space_streaks" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"weeks" integer DEFAULT 0 NOT NULL,
	"since_pause" integer DEFAULT 0 NOT NULL,
	"last_week" date
);
--> statement-breakpoint
CREATE TABLE "voice_notify_prefs" (
	"user_id" uuid NOT NULL,
	"scope_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"notify" boolean NOT NULL,
	CONSTRAINT "voice_notify_prefs_user_id_scope_id_pk" PRIMARY KEY("user_id","scope_id")
);
--> statement-breakpoint
CREATE TABLE "voice_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"space_id" uuid,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_weekly" (
	"user_id" uuid NOT NULL,
	"week" date NOT NULL,
	"channel_id" uuid NOT NULL,
	"space_id" uuid,
	"minutes" integer NOT NULL,
	"nights" integer NOT NULL,
	CONSTRAINT "voice_weekly_user_id_week_channel_id_pk" PRIMARY KEY("user_id","week","channel_id")
);
--> statement-breakpoint
CREATE TABLE "weekly_recaps" (
	"user_id" uuid NOT NULL,
	"week" date NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_recaps_user_id_week_pk" PRIMARY KEY("user_id","week")
);
--> statement-breakpoint
ALTER TABLE "consent_records" ADD COLUMN "purpose" text DEFAULT 'terms' NOT NULL;--> statement-breakpoint
ALTER TABLE "consent_records" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activity_days" ADD CONSTRAINT "activity_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_emails" ADD CONSTRAINT "activity_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_settings" ADD CONSTRAINT "activity_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reminders" ADD CONSTRAINT "event_reminders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_streaks" ADD CONSTRAINT "space_streaks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_notify_prefs" ADD CONSTRAINT "voice_notify_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_weekly" ADD CONSTRAINT "voice_weekly_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_recaps" ADD CONSTRAINT "weekly_recaps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_days_day_idx" ON "activity_days" USING btree ("day");--> statement-breakpoint
CREATE INDEX "activity_emails_user_sent_idx" ON "activity_emails" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE INDEX "event_reminders_sent_at_idx" ON "event_reminders" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "event_rsvps_user_id_idx" ON "event_rsvps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_space_id_idx" ON "events" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "events_starts_at_idx" ON "events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "voice_sessions_joined_at_idx" ON "voice_sessions" USING btree ("joined_at");--> statement-breakpoint
CREATE INDEX "voice_sessions_user_left_idx" ON "voice_sessions" USING btree ("user_id","left_at");--> statement-breakpoint
CREATE INDEX "voice_sessions_channel_idx" ON "voice_sessions" USING btree ("channel_id","joined_at");--> statement-breakpoint
CREATE INDEX "voice_weekly_week_idx" ON "voice_weekly" USING btree ("week");--> statement-breakpoint
CREATE INDEX "weekly_recaps_week_idx" ON "weekly_recaps" USING btree ("week");--> statement-breakpoint
-- CREATE_EVENTS (1 << 20) for @everyone of existing spaces: the "Grupo de amigos" default (packages/shared/src/permissions.ts).
UPDATE "roles" SET "permissions" = "permissions" | 1048576 WHERE "id" = "space_id";
