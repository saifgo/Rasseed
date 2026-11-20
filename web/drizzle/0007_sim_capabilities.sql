ALTER TABLE "sims" ADD COLUMN "can_accept_credit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sims" ADD COLUMN "can_send_credit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sims" ADD COLUMN "can_send_data" boolean DEFAULT true NOT NULL;