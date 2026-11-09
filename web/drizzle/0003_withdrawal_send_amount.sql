ALTER TABLE "withdrawals" ADD COLUMN "send_millimes" bigint;--> statement-breakpoint
UPDATE "withdrawals" SET "send_millimes" = "net_millimes";--> statement-breakpoint
UPDATE "withdrawals" w SET "send_millimes" = w."gross_millimes" FROM "payout_methods" m WHERE m."code" = w."method_code" AND m."fee_bps" > 0 AND w."status" = 'pending';--> statement-breakpoint
ALTER TABLE "withdrawals" ALTER COLUMN "send_millimes" SET NOT NULL;
