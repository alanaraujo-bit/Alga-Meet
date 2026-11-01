CREATE TABLE "device_keys" (
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"signature_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_keys_user_id_device_id_pk" PRIMARY KEY("user_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "key_packages" (
	"ref" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"key_package" text NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_packages" ADD CONSTRAINT "key_packages_user_id_device_id_device_keys_user_id_device_id_fk" FOREIGN KEY ("user_id","device_id") REFERENCES "public"."device_keys"("user_id","device_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_keys_session_id_key" ON "device_keys" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "key_packages_device_idx" ON "key_packages" USING btree ("user_id","device_id","created_at");