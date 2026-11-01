CREATE TABLE "gifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid,
	"product_id" text NOT NULL,
	"sender_id" uuid,
	"recipient_id" uuid,
	"message" text,
	"deliver_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_upgrade_contributions" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" uuid,
	"days" integer NOT NULL,
	"show_on_wall" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
	"user_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlists_user_id_product_id_pk" PRIMARY KEY("user_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "items" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "upgrade_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "upgrade_tone" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "upgrade_invite_code" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "kind" text DEFAULT 'renewing' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "granted_by" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_payment_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "refund_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plus_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wishlist_visible" boolean;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_upgrade_contributions" ADD CONSTRAINT "space_upgrade_contributions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_upgrade_contributions" ADD CONSTRAINT "space_upgrade_contributions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_upgrade_contributions" ADD CONSTRAINT "space_upgrade_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gifts_order_id_key" ON "gifts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "gifts_sender_id_idx" ON "gifts" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "gifts_recipient_id_idx" ON "gifts" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "gifts_status_deliver_at_idx" ON "gifts" USING btree ("status","deliver_at");--> statement-breakpoint
CREATE INDEX "space_upgrade_contributions_space_id_idx" ON "space_upgrade_contributions" USING btree ("space_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_subscription_id_idx" ON "orders" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_upgrade_invite_code_key" ON "spaces" USING btree ("upgrade_invite_code");--> statement-breakpoint
CREATE INDEX "spaces_upgrade_ends_at_idx" ON "spaces" USING btree ("upgrade_ends_at");--> statement-breakpoint
CREATE INDEX "subscriptions_order_id_idx" ON "subscriptions" USING btree ("order_id");--> statement-breakpoint
-- Catalog v1 orders were all single cosmetics; subscriptions created before 0011 started when they were created.
UPDATE "orders" SET "items" = jsonb_build_array("product_id");--> statement-breakpoint
UPDATE "subscriptions" SET "started_at" = "created_at" WHERE "status" <> 'pending';