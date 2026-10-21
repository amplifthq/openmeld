import { describe, expect, it } from "vitest";
import {
  type DispatchQueueWaitContext,
  handleDispatchQueueBatch,
} from "../src/dispatch/application/dispatch-queue-service";
import type { CoreBindings } from "../src/lib/bindings";
import { env } from "../test-support/worker-env";

describe("PostgreSQL dispatch queue", () => {
  it("processes an empty batch through the native binding", async () => {
    const outcome = await handleDispatchQueueBatch({
      batch: {
        messages: [],
        queue: "isolated",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        ackAll() {
          /* Required fixture callback; no asynchronous work is scheduled. */
        },
        retryAll() {
          /* Required fixture callback; no asynchronous work is scheduled. */
        },
      },
      ctx: {
        waitUntil() {
          /* Required fixture callback; no asynchronous work is scheduled. */
        },
      } as DispatchQueueWaitContext,
      env: {
        OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
        OPENMELD_SPACES: env.OPENMELD_SPACES,
      } as CoreBindings,
    });
    expect(outcome.status).toBe("processed");
  });
});
