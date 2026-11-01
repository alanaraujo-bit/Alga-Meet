CREATE TABLE "access_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"ip" text NOT NULL,
	"user_agent_sha256" text NOT NULL,
	"event" text NOT NULL,
	"day" date NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"reason" text NOT NULL,
	"until" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"report_id" uuid,
	"staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appeals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"staff_id" uuid,
	"staff_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"terms_version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_key" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deleted_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email_sha256" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarantined_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attachment_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text,
	"original_key" text NOT NULL,
	"evidence_key" text NOT NULL,
	"evidence_stored_at" timestamp with time zone,
	"copy_error" text,
	"report_id" uuid,
	"staff_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"authority_protocol" text,
	"receipt_confirmed_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_user_id" uuid,
	"space_id" uuid,
	"channel_id" uuid,
	"reason" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"priority" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"action" text,
	"staff_id" uuid,
	"staff_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff_audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"params" jsonb,
	"query" jsonb,
	"body" jsonb,
	"status" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_date_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "staff_role" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "restriction_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "legal_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_messages" text;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_action_id_account_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."account_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_logs_daily_key" ON "access_logs" USING btree ("user_id","day","ip","user_agent_sha256") WHERE "access_logs"."event" = 'session_use';--> statement-breakpoint
CREATE INDEX "access_logs_user_id_at_idx" ON "access_logs" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "access_logs_at_idx" ON "access_logs" USING btree ("at");--> statement-breakpoint
CREATE INDEX "account_actions_user_id_idx" ON "account_actions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appeals_action_id_key" ON "appeals" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "appeals_status_created_idx" ON "appeals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "consent_records_user_id_idx" ON "consent_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "data_exports_user_id_created_idx" ON "data_exports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "data_exports_status_idx" ON "data_exports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deleted_accounts_username_idx" ON "deleted_accounts" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "quarantined_files_attachment_id_key" ON "quarantined_files" USING btree ("attachment_id");--> statement-breakpoint
CREATE INDEX "reports_queue_idx" ON "reports" USING btree ("status","priority","created_at");--> statement-breakpoint
CREATE INDEX "reports_target_user_id_idx" ON "reports" USING btree ("target_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_open_dedupe_key" ON "reports" USING btree ("reporter_id","target_type","target_id") WHERE "reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "staff_audit_log_at_idx" ON "staff_audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "users_deletion_purge_after_idx" ON "users" USING btree ("deletion_purge_after") WHERE "users"."deletion_purge_after" is not null;--> statement-breakpoint
-- Hand-written: author of the messages that deleted accounts chose to keep ("Usuário removido", REMOVED_USER_ID in
-- packages/shared). Its username has a "-" and its e-mail is not an address, so no signup, login by e-mail or reset
-- can ever reach it; the password hash is of 32 random bytes nobody kept.
INSERT INTO "users" ("id", "email", "username", "display_name", "password_hash")
	VALUES ('00000000-0000-4000-8000-000000000000', 'deleted-user', 'deleted-user', 'Usuário removido',
		'$argon2id$v=19$m=19456,t=2,p=1$LonwpCGGyMcj7mM4Ufix1Q$dfBp9BiKyJndCrKug0Wf37xKTJTCpp5zQgd6UvfENng')
	ON CONFLICT DO NOTHING;
