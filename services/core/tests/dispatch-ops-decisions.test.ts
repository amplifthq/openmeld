import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "../test-support/worker-env";

beforeEach(async () => {
  await getPostgresDatabase(env).query(
    'DELETE FROM "openmeld"."openMeldDaemon_ops_decisions"'
  );
});

import {
  listRecentOpenMeldDaemonOpsDecisions,
  writeOpenMeldDaemonOpsDecision,
} from "../src/dispatch/infrastructure/postgresql/dispatch-ledger-postgresql";

const createPostgresOpsDecisionDb = () => ({ db: getPostgresDatabase(env) });

describe("dispatch ops decisions store", () => {
  it("writes ops decision row with payload json", async () => {
    const { db } = createPostgresOpsDecisionDb();

    await writeOpenMeldDaemonOpsDecision({
      db,
      decisionCode: "dispatch.window.risk",
      decisionPayload: {
        queueLagMs: 123,
        dispatchId: "dispatch-1",
      },
      decidedBy: "core.dispatch_queue.risk",
      decidedAtMs: 1000,
      expectedRecoveryCriteria: "queue lag recovers",
      source: "dispatch_queue_consumer",
      correlationId: "dispatch-1",
    });

    const rows = await listRecentOpenMeldDaemonOpsDecisions({
      db,
      limit: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        decisionCode: "dispatch.window.risk",
        decidedBy: "core.dispatch_queue.risk",
        source: "dispatch_queue_consumer",
        correlationId: "dispatch-1",
      })
    );
    expect(JSON.parse(rows[0]?.decisionPayloadJson ?? "null")).toEqual({
      queueLagMs: 123,
      dispatchId: "dispatch-1",
    });
  });

  it("stores stale lease audit payload with traceable identifiers", async () => {
    const { db } = createPostgresOpsDecisionDb();

    await writeOpenMeldDaemonOpsDecision({
      db,
      decisionCode: "core.dispatch_queue.stale_lease",
      decisionPayload: {
        dispatchId: "dispatch-stale-1",
        profileId: "agent-1",
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 7,
        reasonCode: "stale_lease_result_rejected",
        retryCount: 3,
      },
      decidedBy: "core.dispatch_queue.stale_lease_audit",
      decidedAtMs: 2000,
      source: "dispatch_queue_consumer",
      correlationId: "dispatch-stale-1",
    });

    const rows = await listRecentOpenMeldDaemonOpsDecisions({
      db,
      limit: 10,
    });

    const payload = JSON.parse(rows[0]?.decisionPayloadJson ?? "{}");
    expect(payload).toEqual(
      expect.objectContaining({
        dispatchId: "dispatch-stale-1",
        profileId: "agent-1",
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 7,
        reasonCode: "stale_lease_result_rejected",
        retryCount: 3,
      })
    );
  });

  it("filters recent decisions by decisionCode and correlationId", async () => {
    const { db } = createPostgresOpsDecisionDb();

    await writeOpenMeldDaemonOpsDecision({
      db,
      decisionCode: "controller.binding.lookup_failed",
      decisionPayload: { bindingSource: "auth_rpc" },
      decidedBy: "core.dispatch_queue.preflight",
      decidedAtMs: 3000,
      source: "dispatch_queue_consumer",
      correlationId: "dispatch-2",
    });
    await writeOpenMeldDaemonOpsDecision({
      db,
      decisionCode: "controller.binding.lookup_failed",
      decisionPayload: { bindingSource: "auth_rpc" },
      decidedBy: "core.dispatch_queue.preflight",
      decidedAtMs: 2000,
      source: "dispatch_queue_consumer",
      correlationId: "dispatch-3",
    });
    await writeOpenMeldDaemonOpsDecision({
      db,
      decisionCode: "dispatch.window.risk",
      decisionPayload: { queueLagMs: 999 },
      decidedBy: "core.dispatch_queue.risk",
      decidedAtMs: 1000,
      source: "dispatch_queue_consumer",
      correlationId: "dispatch-4",
    });

    const lookupOnly = await listRecentOpenMeldDaemonOpsDecisions({
      db,
      limit: 10,
      decisionCode: "controller.binding.lookup_failed",
    });
    expect(lookupOnly).toHaveLength(2);
    expect(lookupOnly[0]?.decidedAtMs).toBeGreaterThan(
      lookupOnly[1]?.decidedAtMs ?? 0
    );

    const byCorrelation = await listRecentOpenMeldDaemonOpsDecisions({
      db,
      limit: 10,
      decisionCode: "controller.binding.lookup_failed",
      correlationId: "dispatch-3",
    });
    expect(byCorrelation).toHaveLength(1);
    expect(byCorrelation[0]).toEqual(
      expect.objectContaining({
        decisionCode: "controller.binding.lookup_failed",
        correlationId: "dispatch-3",
      })
    );
  });
});
