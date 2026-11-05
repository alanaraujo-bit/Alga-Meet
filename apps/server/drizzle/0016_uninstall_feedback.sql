CREATE TABLE "uninstall_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"app_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
