CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sim_id" uuid NOT NULL,
	"balance_millimes" bigint NOT NULL,
	"command_id" uuid,
	"discrepancy_millimes" bigint,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sim_id" uuid NOT NULL,
	"sms_id" uuid,
	"amount_millimes" bigint NOT NULL,
	"sender_msisdn" text NOT NULL,
	"tx_id" uuid,
	"status" text NOT NULL,
	"balance_verified" boolean DEFAULT false NOT NULL,
	"note" text,
	"resolved_by" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"sim_id" uuid NOT NULL,
	"type" text NOT NULL,
	"ussd_code" text NOT NULL,
	"purpose" text NOT NULL,
	"tx_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_response" text,
	"error" text,
	"parsed_balance_millimes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text,
	"pairing_code" text,
	"pairing_expires_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_ip" text,
	"battery_pct" integer,
	"charging" boolean,
	"model" text,
	"android_version" text,
	"app_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"rate_bps" integer NOT NULL,
	"transfer_ussd_template" text NOT NULL,
	"balance_ussd_code" text NOT NULL,
	"credit_sms_regex" text NOT NULL,
	"credit_sms_unit" text DEFAULT 'millimes' NOT NULL,
	"credit_sms_senders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"balance_regex" text NOT NULL,
	"balance_unit" text DEFAULT 'auto' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_methods" (
	"code" text PRIMARY KEY NOT NULL,
	"name" jsonb NOT NULL,
	"fee_millimes" bigint DEFAULT 0 NOT NULL,
	"fields" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"method_code" text NOT NULL,
	"details" jsonb NOT NULL,
	"gross_millimes" bigint NOT NULL,
	"fee_millimes" bigint NOT NULL,
	"net_millimes" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reference" text,
	"note" text,
	"proof_path" text,
	"proof_mime" text,
	"paid_at" timestamp with time zone,
	"paid_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_tx_id_unique" UNIQUE("tx_id")
);
--> statement-breakpoint
CREATE TABLE "rate_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_code" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"set_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_payout_details" (
	"user_id" text NOT NULL,
	"method_code" text NOT NULL,
	"details" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_payout_details_user_id_method_code_pk" PRIMARY KEY("user_id","method_code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"slot_index" integer NOT NULL,
	"subscription_id" integer NOT NULL,
	"carrier_name" text,
	"operator_code" text,
	"msisdn" text,
	"status" text DEFAULT 'unconfigured' NOT NULL,
	"balance_millimes" bigint,
	"balance_checked_at" timestamp with time zone,
	"held_by_tx_id" uuid,
	"cooldown_until" timestamp with time zone,
	"last_assigned_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"sim_id" uuid,
	"dedupe_key" text NOT NULL,
	"from_address" text NOT NULL,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone,
	"device_received_at" timestamp with time zone,
	"classification" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_messages_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "transaction_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"user_id" text NOT NULL,
	"operator_code" text NOT NULL,
	"declared_millimes" bigint NOT NULL,
	"sender_msisdn" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"payout_method_code" text NOT NULL,
	"payout_details" jsonb NOT NULL,
	"payout_fee_millimes" bigint NOT NULL,
	"status" text NOT NULL,
	"sim_id" uuid,
	"assigned_msisdn" text,
	"baseline_balance_millimes" bigint,
	"baseline_at" timestamp with time zone,
	"sms_received_millimes" bigint DEFAULT 0 NOT NULL,
	"confirmed_millimes" bigint DEFAULT 0 NOT NULL,
	"final_millimes" bigint,
	"payout_gross_millimes" bigint,
	"payout_net_millimes" bigint,
	"partial_choice" text,
	"verify_attempts" integer DEFAULT 0 NOT NULL,
	"unexplained_since" timestamp with time zone,
	"review_reason" text,
	"assign_attempts" integer DEFAULT 0 NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp with time zone,
	"image" text,
	"role" text DEFAULT 'seller' NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_command_id_device_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."device_commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_sms_id_sms_messages_id_fk" FOREIGN KEY ("sms_id") REFERENCES "public"."sms_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_tx_id_transactions_id_fk" FOREIGN KEY ("tx_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_method_code_payout_methods_code_fk" FOREIGN KEY ("method_code") REFERENCES "public"."payout_methods"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_history" ADD CONSTRAINT "rate_history_operator_code_operators_code_fk" FOREIGN KEY ("operator_code") REFERENCES "public"."operators"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_history" ADD CONSTRAINT "rate_history_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_payout_details" ADD CONSTRAINT "saved_payout_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_payout_details" ADD CONSTRAINT "saved_payout_details_method_code_payout_methods_code_fk" FOREIGN KEY ("method_code") REFERENCES "public"."payout_methods"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sims" ADD CONSTRAINT "sims_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sims" ADD CONSTRAINT "sims_operator_code_operators_code_fk" FOREIGN KEY ("operator_code") REFERENCES "public"."operators"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_events" ADD CONSTRAINT "transaction_events_tx_id_transactions_id_fk" FOREIGN KEY ("tx_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_operator_code_operators_code_fk" FOREIGN KEY ("operator_code") REFERENCES "public"."operators"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payout_method_code_payout_methods_code_fk" FOREIGN KEY ("payout_method_code") REFERENCES "public"."payout_methods"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_snapshots_sim_idx" ON "balance_snapshots" USING btree ("sim_id","taken_at");--> statement-breakpoint
CREATE INDEX "credits_sim_idx" ON "credits" USING btree ("sim_id","received_at");--> statement-breakpoint
CREATE INDEX "credits_tx_idx" ON "credits" USING btree ("tx_id");--> statement-breakpoint
CREATE INDEX "device_commands_device_status_idx" ON "device_commands" USING btree ("device_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sims_device_slot_idx" ON "sims" USING btree ("device_id","slot_index");--> statement-breakpoint
CREATE UNIQUE INDEX "sims_msisdn_idx" ON "sims" USING btree ("msisdn");--> statement-breakpoint
CREATE UNIQUE INDEX "sims_held_by_idx" ON "sims" USING btree ("held_by_tx_id");--> statement-breakpoint
CREATE INDEX "sms_messages_sim_idx" ON "sms_messages" USING btree ("sim_id","created_at");--> statement-breakpoint
CREATE INDEX "transaction_events_tx_idx" ON "transaction_events" USING btree ("tx_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_user_idx" ON "transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status","operator_code","queued_at");