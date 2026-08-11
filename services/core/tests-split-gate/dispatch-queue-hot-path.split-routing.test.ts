import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { DispatchQueueWaitContext } from "../src/dispatch/application/dispatch-queue-service";
import { handleDispatchQueueBatch } from "../src/dispatch/application/dispatch-queue-service";
import type { CoreBindings } from "../src/lib/bindings";

// Physical DB split routing gate (physical-db-split.md Stage B safety net).
//
// The per-batch hot-path storage-readiness probe used to validate a cross-domain
// table set (8 wake-evidence + 3 local-state tables) against the single dispatch
// handle. Against a split wake-evidence DB that probe would fail (the local-state
// tables are absent) and the batch would return "retry_scheduled" forever. The
// probe has been removed (deploy preflight owns migrate-before-deploy), so the
// hot path must now run unobstructed under the split schema.
describe("dispatch queue hot path is not blocked under split schema", () => {
  it("processes a batch with only OPENMELD_WAKE_EVIDENCE_DB bound (no OPENMELD_DB)", async () => {
    const outcome = await handleDispatchQueueBatch({
      batch: { messages: [] } as unknown as MessageBatch<unknown>,
      ctx: {} as DispatchQueueWaitContext,
      env: {
        OPENMELD_WAKE_EVIDENCE_DB: env.OPENMELD_WAKE_EVIDENCE_DB,
        OPENMELD_SPACES: env.OPENMELD_SPACES,
      } as unknown as CoreBindings,
    });

    expect(outcome.status).toBe("processed");
  });
});
