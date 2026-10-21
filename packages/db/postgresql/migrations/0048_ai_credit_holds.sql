ALTER TABLE "openmeld"."ai_usage_records" ADD COLUMN "funding_source" text;--> statement-breakpoint
ALTER TABLE "openmeld"."ai_usage_records" ADD COLUMN "credit_hold_nano_usd" bigint;--> statement-breakpoint
ALTER TABLE "openmeld"."ai_usage_records" ADD COLUMN "credit_hold_admitted_at_ms" bigint;--> statement-breakpoint
ALTER TABLE "openmeld"."ai_usage_records" ADD CONSTRAINT "ai_usage_records_credit_hold_check" CHECK (("credit_hold_nano_usd" is null and "credit_hold_admitted_at_ms" is null)
        or ("credit_hold_nano_usd" > 0 and "credit_hold_admitted_at_ms" is not null));