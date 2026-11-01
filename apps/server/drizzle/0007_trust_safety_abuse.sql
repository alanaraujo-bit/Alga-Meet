ALTER TABLE "quarantined_files" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "quarantined_files" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "quarantined_files" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "false_reports" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "reports_reporter_created_idx" ON "reports" USING btree ("reporter_id","created_at");