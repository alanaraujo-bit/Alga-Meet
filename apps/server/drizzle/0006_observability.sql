CREATE TABLE "call_quality_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"user_hash" text NOT NULL,
	"session_duration_s" integer NOT NULL,
	"join_ms" integer,
	"reconnects" integer NOT NULL,
	"reconnect_failed" boolean NOT NULL,
	"rtt_avg_ms" real,
	"rtt_p95_ms" real,
	"jitter_ms" real,
	"packet_loss_pct" real,
	"concealment_pct" real,
	"audio_codec" text,
	"video_codec" text,
	"encoder_hardware" boolean,
	"stream_fps" text,
	"stream_resolution" text,
	"os" text NOT NULL,
	"os_version" text NOT NULL,
	"app_version" text NOT NULL,
	"cpu_vendor" text NOT NULL,
	"gpu_vendor" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cosmetics" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telemetry_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telemetry_opt_in_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "call_quality_reports_day_idx" ON "call_quality_reports" USING btree ("day");