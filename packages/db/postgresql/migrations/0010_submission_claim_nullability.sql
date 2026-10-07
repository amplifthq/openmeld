ALTER TABLE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" DROP CONSTRAINT "native_delivery_worker_submit_claim_shape";--> statement-breakpoint
ALTER TABLE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" ADD CONSTRAINT "native_delivery_worker_submit_claim_shape" CHECK ((
      ("worker_submit_claim_id" IS NULL AND "worker_submit_claim_expires_at_ms" IS NULL)
      OR ("worker_submit_claim_id" IS NOT NULL AND "worker_submit_claim_expires_at_ms" IS NOT NULL
        AND length(trim("worker_submit_claim_id")) > 0 AND "worker_submit_claim_expires_at_ms" > 0)
    ));