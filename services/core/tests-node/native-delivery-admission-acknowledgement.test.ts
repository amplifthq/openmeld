import { describe, expect, it, vi } from "vitest";
import { installPostgresWriteFailure } from "../../../tooling/postgresql/test-harness";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import type { CoreBindings } from "../src/lib/bindings";
import { acknowledgeRemoteAgentAdmission } from "../src/remote-agent/application/native-delivery-admission-acknowledgement";
import {
  listRemoteAgentNativeDeliveriesMissingAcceptedProbe,
  markRemoteAgentNativeDeliveryAck,
  persistRemoteAgentWorkerSubmitRequest,
  readRemoteAgentNativeDeliveryBySubmissionId,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

describe("native execution admission acknowledgement", () => {
  it.each([
    "start-before-response",
    "response-before-start",
  ])("persists one exact admission for %s", async (order) => {
    const harness = await createPostgresHarness();

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
      const send = vi.fn(async () => undefined);
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
        OPENMELD_DAEMON_DISPATCH_QUEUE: { send },
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
      if (order === "start-before-response") {
        const removeFailure = await installPostgresWriteFailure({
          harness,
          table: "openMeldRemoteAgent_native_delivery_ledger",
          operation: "UPDATE",
          condition: "NEW.status = 'accepted'",
          message: "ACK storage unavailable",
        });
        await expect(
          acknowledgeRemoteAgentAdmission(env, callback)
        ).rejects.toThrow("ACK storage unavailable");
        expect(send).not.toHaveBeenCalled();
        await removeFailure();
      }
      send.mockRejectedValueOnce(new Error("Queue temporarily unavailable"));
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
        acceptedProbeNextDueAtMs: null,
      });
      expect(
        await listRemoteAgentNativeDeliveriesMissingAcceptedProbe({
          db: harness.db,
          nowMs: Date.now(),
        })
      ).toMatchObject([{ idempotencyKey: request.idempotencyKey }]);
      await markRemoteAgentNativeDeliveryAck(ack);
      await expect(
        acknowledgeRemoteAgentAdmission(env, callback)
      ).resolves.toMatchObject({ status: "accepted" });
      expect(
        await readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: request.dispatchId,
        })
      ).toMatchObject({ acceptedProbeNextDueAtMs: expect.any(Number) });
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
      // A terminal write during a failed probe must not resurrect admission.
      await harness.query({
        text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET accepted_probe_next_due_at_ms = NULL',
      });
      send.mockImplementationOnce(async () => {
        await harness.query({
          text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET status = \'failed\'',
        });
        return Promise.reject(
          new Error("Queue failed after terminal transition")
        );
      });
      await expect(
        acknowledgeRemoteAgentAdmission(env, callback)
      ).resolves.toMatchObject({
        status: "rejected",
      });
      await harness.query({
        text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET status = \'failed\'',
      });
      await expect(
        acknowledgeRemoteAgentAdmission(env, callback)
      ).resolves.toMatchObject({ status: "rejected" });
    } finally {
      await harness.close();
    }
  });
});
