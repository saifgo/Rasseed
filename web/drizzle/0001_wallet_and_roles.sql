CREATE TABLE "wallet_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_millimes" bigint NOT NULL,
	"tx_id" uuid,
	"withdrawal_id" uuid,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"user_id" text NOT NULL,
	"method_code" text NOT NULL,
	"details" jsonb NOT NULL,
	"gross_millimes" bigint NOT NULL,
	"fee_millimes" bigint NOT NULL,
	"net_millimes" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reference" text,
	"note" text,
	"reject_reason" text,
	"proof_path" text,
	"proof_mime" text,
	"paid_at" timestamp with time zone,
	"paid_by" text,
	"rejected_at" timestamp with time zone,
	"rejected_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawals_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "payout_method_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "payout_details" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "payout_fee_millimes" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_tx_id_transactions_id_fk" FOREIGN KEY ("tx_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_method_code_payout_methods_code_fk" FOREIGN KEY ("method_code") REFERENCES "public"."payout_methods"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_entries_user_idx" ON "wallet_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "withdrawals_user_idx" ON "withdrawals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "withdrawals_status_idx" ON "withdrawals" USING btree ("status","created_at");--> statement-breakpoint
-- Data: confirmed sales whose per-sale payout was never sent become balance credits (gross, the fee is now
-- charged per withdrawal). Paid payouts stay as history; their sales keep status 'paid'.
INSERT INTO "wallet_entries" ("user_id", "kind", "amount_millimes", "tx_id", "note", "created_at")
SELECT p."user_id", 'sale', p."gross_millimes", p."tx_id", 'Converted from pending payout', p."created_at"
FROM "payouts" p
WHERE p."status" = 'pending' AND p."gross_millimes" > 0;--> statement-breakpoint
UPDATE "transactions" t SET "payout_net_millimes" = t."payout_gross_millimes", "payout_fee_millimes" = 0, "payout_method_code" = NULL, "payout_details" = NULL
WHERE t."id" IN (SELECT "tx_id" FROM "payouts" WHERE "status" = 'pending');--> statement-breakpoint
DELETE FROM "payouts" WHERE "status" = 'pending';
