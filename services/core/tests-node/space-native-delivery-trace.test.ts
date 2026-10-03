import { spaceDispatchTraceResponseSchema } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { attachCenterAgentTurnRuntimeEvidence } from "../src/remote-agent/application/center-agent-turn-diagnostics";
import { upsertRemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { readSpaceDispatchTrace } from "../src/space/infrastructure/d1/space-dispatch-read-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("native-only Space dispatch trace", () => {
  it("reads a continuation from its native ledger without creating a workstation dispatch", async () => {
    const harness = createHarness();
    try {
      await stage(harness.db);
      const response = await read(harness.db, 6);
      expect(response).toMatchObject({
        trace: null,
        nativeDeliveryTrace: {
          bindingId: "binding_1",
          destination: { spaceId: "space_1", targetProfileId: "profile_1" },
          turn: {
            dispatchId: "continuation_1",
            status: "completed",
            publicationState: null,
          },
          finalVisibleOutcome: { delivered: false },
        },
        correlation: {
          targetProfileId: "profile_1",
          bindingId: "binding_1",
          latestAttemptId: null,
        },
      });
      expect(spaceDispatchTraceResponseSchema.safeParse(response).success).toBe(
        true
      );
      expect(JSON.stringify(response)).not.toContain("workerSubmitRequest");
      expect(JSON.stringify(response)).not.toContain("private prompt");
      for (const version of [2, 3, 4, 5] as const) {
        const legacy = await read(harness.db, version);
        expect(legacy.trace).toBeNull();
        expect(legacy).not.toHaveProperty("nativeDeliveryTrace");
        expect(legacy.correlation.targetProfileId).toBeNull();
      }
    } finally {
      harness.close();
    }
  });

  it("keeps durable facts when frozen runtime identity is missing", async () => {
    const harness = createHarness();
    try {
      await stage(harness.db);
      const response = await readSpaceDispatchTrace({
        db: harness.db,
        dispatchId: "continuation_1",
        spaceId: "space_1",
        responseContractVersion: 6,
        readReplySignalTrace: () => null,
        readNativeDeliveryTurnDiagnostic: async (delivery) => {
          const [turn] = await attachCenterAgentTurnRuntimeEvidence({
            deliveries: [delivery],
            remoteAgentWorker: undefined,
          });
          if (!turn) {
            throw new Error("expected native turn");
          }
          return turn;
        },
      });
      expect(response).toMatchObject({
        nativeDeliveryTrace: {
          turn: { status: "completed", runtimeEvidenceStatus: "unavailable" },
        },
      });
      expect(spaceDispatchTraceResponseSchema.safeParse(response).success).toBe(
        true
      );
    } finally {
      harness.close();
    }
  });

  it("refuses another Space, a non-Space conversation, and ambiguous identity", async () => {
    const harness = createHarness();
    const visibleReader = vi.fn(() => ({
      finalVisibleMessage: null,
      finalVisibleMessageLinkage: null,
    }));
    try {
      await stage(harness.db);
      const wrongSpace = await readSpaceDispatchTrace({
        db: harness.db,
        dispatchId: "continuation_1",
        spaceId: "space_other",
        responseContractVersion: 6,
        readReplySignalTrace: () => null,
        readFinalVisibleMessageTrace: visibleReader,
      });
      expect(wrongSpace).not.toHaveProperty("nativeDeliveryTrace");
      expect(visibleReader).not.toHaveBeenCalled();
      await harness.db
        .prepare(
          "UPDATE openMeldRemoteAgent_native_delivery_ledger SET conversation_kind = 'slack', slack_team_id = 'T1', slack_channel_id = 'D1', slack_thread_ts = '1.1'"
        )
        .run();
      expect(await read(harness.db, 6)).not.toHaveProperty(
        "nativeDeliveryTrace"
      );
      await harness.db
        .prepare(
          "UPDATE openMeldRemoteAgent_native_delivery_ledger SET conversation_kind = 'space'"
        )
        .run();
      await stage(harness.db, "delivery_2");
      await expect(read(harness.db, 6)).rejects.toThrow(
        "execution_identity_ambiguous"
      );
    } finally {
      harness.close();
    }
  });
});

function createHarness() {
  const harness = createSqliteD1Harness();
  applyDrizzleMigrationForTable(harness, "openMeldDaemon_dispatch_ledger");
  applyDrizzleMigrationForTable(
    harness,
    "openMeldRemoteAgent_native_delivery_ledger"
  );
  return harness;
}

function stage(db: D1Database, deliveryId = "delivery_1") {
  return upsertRemoteAgentNativeDeliveryRecord({
    db,
    deliveryId,
    dispatchId: "continuation_1",
    attemptId: null,
    idempotencyKey: deliveryId,
    nowMs: 1000,
    organizationId: "org_1",
    spaceId: "space_1",
    profileId: "profile_1",
    bindingId: "binding_1",
    triggerMessageId: "trigger_1",
    triggerText: "private prompt",
    conversationKind: "space",
    status: "completed",
  });
}

function read(db: D1Database, responseContractVersion: 2 | 3 | 4 | 5 | 6) {
  return readSpaceDispatchTrace({
    db,
    dispatchId: "continuation_1",
    spaceId: "space_1",
    responseContractVersion,
    readReplySignalTrace: () => null,
  });
}
