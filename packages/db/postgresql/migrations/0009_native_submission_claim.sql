ALTER TABLE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" ADD COLUMN "worker_submit_claim_id" text;--> statement-breakpoint
ALTER TABLE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" ADD COLUMN "worker_submit_claim_expires_at_ms" bigint;--> statement-breakpoint
ALTER TABLE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" ADD CONSTRAINT "native_delivery_worker_submit_claim_shape" CHECK ((
      ("worker_submit_claim_id" IS NULL AND "worker_submit_claim_expires_at_ms" IS NULL)
      OR (length(trim("worker_submit_claim_id")) > 0 AND "worker_submit_claim_expires_at_ms" > 0)
    ));