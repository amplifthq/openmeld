import { describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import type { CoreBindings } from "../src/lib/bindings";
import { acknowledgeRemoteAgentAdmission } from "../src/remote-agent/application/native-delivery-admission-acknowledgement";
import {
  markRemoteAgentNativeDeliveryAck,
  persistRemoteAgentWorkerSubmitRequest,
  readRemoteAgentNativeDeliveryBySubmissionId,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("native execution admission acknowledgement", () => {
  it.each([
    "start-before-response",
    "response-before-start",
  ])("persists one exact admission for %s", async (order) => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldRemoteAgent_native_delivery_ledger"
    );
    const request = createSubmitTurnRequest({ spaceId: "a".repeat(64) });
    try {
      await upsertRemoteAgentNativeDeliveryRecord({
        db: harness.db,
        nowMs: 1000,
        organizationId: request.organizationId,
        spaceId: request.spaceId,
        profileId: request.agentProfileId,
        bindingId: request.bindingId,
        triggerMessageId: request.triggerMessageId,
        dispatchId: request.dispatchId,
        attemptId: "attempt",
        idempotencyKey: request.idempotencyKey,
        status: "submitted",
      });
      await persistRemoteAgentWorkerSubmitRequest({
        db: harness.db,
        nowMs: 1000,
        idempotencyKey: request.idempotencyKey,
        workerSubmitRequest: request,
      });
      const ack = {
        db: harness.db,
        nowMs: 2000,
        idempotencyKey: request.idempotencyKey,
        submissionId: request.dispatchId,
        workerRequestId: request.dispatchId,
        accepted: true,
      };
      if (order === "response-before-start") {
        await markRemoteAgentNativeDeliveryAck(ack);
      } else {
        expect(
          await readRemoteAgentNativeDeliveryBySubmissionId({
            db: harness.db,
            submissionId: request.dispatchId,
          })
        ).toBeNull();
      }
      let stopRequested = true;
      const env = {
        OPENMELD_DB: harness.db,
        OPENMELD_DAEMON_DISPATCH_QUEUE: { send: vi.fn(async () => undefined) },
        OPENMELD_SPACES: {
          idFromString: (id: string) => id,
          get: () => ({
            rpcReadWakeStopIntent: async () => ({
              status: stopRequested ? "requested" : "not_requested",
            }),
          }),
        },
      } as unknown as CoreBindings;
      const callback = {
        submissionId: request.dispatchId,
        idempotencyKey: request.idempotencyKey,
        organizationId: request.organizationId,
        spaceId: request.spaceId,
        agentProfileId: request.agentProfileId,
        bindingId: request.bindingId,
        triggerMessageId: request.triggerMessageId,
        dispatchId: request.dispatchId,
      };
      await expect(
        acknowledgeRemoteAgentAdmission(env, callback)
      ).resolves.toMatchObject({
        status: "rejected",
        reasonCode: "remote_agent.execution_cancelled",
      });
      if (order === "start-before-response") {
        expect(
          await readRemoteAgentNativeDeliveryBySubmissionId({
            db: harness.db,
            submissionId: request.dispatchId,
          })
        ).toBeNull();
      }
      stopRequested = false;
      await expect(
        acknowledgeRemoteAgentAdmission(env, callback)
      ).resolves.toMatchObject({ status: "accepted" });
      expect(
        await readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: request.dispatchId,
        })
      ).toMatchObject({
        status: "accepted",
        idempotencyKey: request.idempotencyKey,
      });
      await markRemoteAgentNativeDeliveryAck(ack);
      await expect(
        acknowledgeRemoteAgentAdmission(env, callback)
      ).resolves.toMatchObject({ status: "accepted" });
      await expect(
        acknowledgeRemoteAgentAdmission(env, {
          ...callback,
          spaceId: "other-space",
        })
      ).resolves.toMatchObject({ status: "rejected" });
      await expect(
        acknowledgeRemoteAgentAdmission(env, {
          ...callback,
          submissionId: "other-submission",
        })
      ).resolves.toMatchObject({ status: "rejected" });
      harness.run({
        sql: "UPDATE openMeldRemoteAgent_native_delivery_ledger SET status = 'failed'",
      });
      await expect(
        acknowledgeRemoteAgentAdmission(env, callback)
      ).resolves.toMatchObject({ status: "rejected" });
    } finally {
      harness.close();
    }
  });
});
