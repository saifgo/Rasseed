CREATE TABLE "credit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movement_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"bucket" text NOT NULL,
	"operator_code" text NOT NULL,
	"user_id" text,
	"order_id" uuid,
	"recharge_id" uuid,
	"tx_id" uuid,
	"amount_millimes" bigint NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" text,
	"operator_code" text NOT NULL,
	"price_bps" integer NOT NULL,
	"payment_info" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_seller_operator_key" UNIQUE NULLS NOT DISTINCT("seller_id","operator_code")
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"buyer_id" text NOT NULL,
	"seller_id" text,
	"listing_id" uuid,
	"operator_code" text NOT NULL,
	"price_bps" integer NOT NULL,
	"commission_bps" integer NOT NULL,
	"payment_info" text DEFAULT '' NOT NULL,
	"requested_millimes" bigint NOT NULL,
	"amount_millimes" bigint NOT NULL,
	"funded_millimes" bigint DEFAULT 0 NOT NULL,
	"excess_millimes" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"released_millimes" bigint,
	"commission_millimes" bigint,
	"cancelled_by" text,
	"cancel_reason" text,
	"buyer_bad_mark" boolean DEFAULT false NOT NULL,
	"leftover_millimes" bigint DEFAULT 0 NOT NULL,
	"leftover_choice" text,
	"dispute_reason" text,
	"disputed_by" text,
	"admin_note" text,
	"funded_at" timestamp with time zone,
	"proof_uploaded_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "recharges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"buyer_id" text NOT NULL,
	"operator_code" text NOT NULL,
	"msisdn" text NOT NULL,
	"amount_millimes" bigint NOT NULL,
	"status" text NOT NULL,
	"sim_id" uuid,
	"baseline_balance_millimes" bigint,
	"baseline_at" timestamp with time zone,
	"send_command_id" uuid,
	"send_ok" boolean,
	"send_response" text,
	"send_error" text,
	"after_balance_millimes" bigint,
	"verify_attempts" integer DEFAULT 0 NOT NULL,
	"review_reason" text,
	"resolved_by" text,
	"note" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recharges_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "seller_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_id" text NOT NULL,
	"seller_id" text,
	"stars" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_ratings_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "device_commands" ADD COLUMN "steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "device_commands" ADD COLUMN "recharge_id" uuid;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "recharge_ussd_template" text;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "recharge_ussd_steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sims" ADD COLUMN "held_by_recharge_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketplace_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_operator_code_operators_code_fk" FOREIGN KEY ("operator_code") REFERENCES "public"."operators"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_operator_code_operators_code_fk" FOREIGN KEY ("operator_code") REFERENCES "public"."operators"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_proofs" ADD CONSTRAINT "order_proofs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_proofs" ADD CONSTRAINT "order_proofs_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_operator_code_operators_code_fk" FOREIGN KEY ("operator_code") REFERENCES "public"."operators"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recharges" ADD CONSTRAINT "recharges_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recharges" ADD CONSTRAINT "recharges_operator_code_operators_code_fk" FOREIGN KEY ("operator_code") REFERENCES "public"."operators"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recharges" ADD CONSTRAINT "recharges_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recharges" ADD CONSTRAINT "recharges_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_ratings" ADD CONSTRAINT "seller_ratings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_ratings" ADD CONSTRAINT "seller_ratings_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_ratings" ADD CONSTRAINT "seller_ratings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_entries_owner_idx" ON "credit_entries" USING btree ("bucket","user_id","operator_code");--> statement-breakpoint
CREATE INDEX "credit_entries_order_idx" ON "credit_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "credit_entries_movement_idx" ON "credit_entries" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX "credit_entries_recharge_idx" ON "credit_entries" USING btree ("recharge_id");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_proofs_order_idx" ON "order_proofs" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_buyer_idx" ON "orders" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_seller_idx" ON "orders" USING btree ("seller_id","status","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "recharges_buyer_idx" ON "recharges" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "recharges_status_idx" ON "recharges" USING btree ("status","operator_code","created_at");--> statement-breakpoint
CREATE INDEX "seller_ratings_seller_idx" ON "seller_ratings" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sims_held_by_recharge_idx" ON "sims" USING btree ("held_by_recharge_id");--> statement-breakpoint
CREATE INDEX "transactions_order_idx" ON "transactions" USING btree ("order_id");