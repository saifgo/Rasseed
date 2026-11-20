CREATE TABLE "data_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_code" text NOT NULL,
	"name" text NOT NULL,
	"price_millimes" bigint NOT NULL,
	"ussd_template" text NOT NULL,
	"ussd_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"device_name" text,
	"token_hash" text,
	"pairing_code" text,
	"pairing_expires_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_ip" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_terminals_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "listings" DROP CONSTRAINT "listings_seller_operator_key";--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "source" text DEFAULT 'transfers' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "resale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "package_id" uuid;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "package_name" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "ussd_template" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "ussd_steps" jsonb;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "pos_terminal_id" uuid;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "client_ref" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "funding" text DEFAULT 'balance' NOT NULL;--> statement-breakpoint
ALTER TABLE "data_packages" ADD CONSTRAINT "data_packages_operator_code_operators_code_fk" FOREIGN KEY ("operator_code") REFERENCES "public"."operators"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_packages_operator_idx" ON "data_packages" USING btree ("operator_code","sort_order");--> statement-breakpoint
CREATE INDEX "pos_terminals_user_idx" ON "pos_terminals" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "recharges" ADD CONSTRAINT "recharges_package_id_data_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."data_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recharges" ADD CONSTRAINT "recharges_pos_terminal_id_pos_terminals_id_fk" FOREIGN KEY ("pos_terminal_id") REFERENCES "public"."pos_terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recharges_buyer_client_ref_key" ON "recharges" USING btree ("buyer_id","client_ref");--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_operator_source_key" UNIQUE NULLS NOT DISTINCT("seller_id","operator_code","source");