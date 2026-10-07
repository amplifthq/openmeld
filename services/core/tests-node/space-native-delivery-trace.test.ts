import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { spaceDispatchTraceResponseSchema } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { attachCenterAgentTurnRuntimeEvidence } from "../src/remote-agent/application/center-agent-turn-diagnostics";
import { upsertRemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { readSpaceDispatchTrace } from "../src/space/infrastructure/postgresql/space-dispatch-read-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("native-only Space dispatch trace", () => {
  it("reads a continuation from its native ledger without creating a workstation dispatch", async () => {
    const harness = await createHarness();
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
      await harness.close();
    }
  });

  it("keeps durable facts when frozen runtime identity is missing", async () => {
    const harness = await createHarness();
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
      await harness.close();
    }
  });

  it("refuses another Space, a non-Space conversation, and ambiguous identity", async () => {
    const harness = await createHarness();
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
      await harness.db.query(
        `UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET conversation_kind = 'slack', slack_team_id = 'T1', slack_channel_id = 'D1', slack_thread_ts = '1.1'`
      );
      expect(await read(harness.db, 6)).not.toHaveProperty(
        "nativeDeliveryTrace"
      );
      await harness.db.query(
        `UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET conversation_kind = 'space'`
      );
      await stage(harness.db, "delivery_2");
      await expect(read(harness.db, 6)).rejects.toThrow(
        "execution_identity_ambiguous"
      );
    } finally {
      await harness.close();
    }
  });
});

function createHarness() {
  return createPostgresHarness();
}

function stage(db: PostgresDatabase, deliveryId = "delivery_1") {
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

function read(
  db: PostgresDatabase,
  responseContractVersion: 2 | 3 | 4 | 5 | 6
) {
  return readSpaceDispatchTrace({
    db,
    dispatchId: "continuation_1",
    spaceId: "space_1",
    responseContractVersion,
    readReplySignalTrace: () => null,
  });
}
