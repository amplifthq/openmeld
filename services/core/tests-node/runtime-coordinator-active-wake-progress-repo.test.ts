import { RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION } from "@openmeld/schemas";
import type {
  RuntimeCoordinatorExecutionRecord,
  RuntimeCoordinatorExecutionStatus,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { listActiveRemoteAgentNativeDeliveryWakeProgressEvidenceBySpace } from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  listActiveRuntimeCoordinatorExecutionProjectionsBySpace,
  listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace,
  readRuntimeCoordinatorExecutionProjectionById,
  writeRuntimeCoordinatorExecutionEventFromParts,
  writeRuntimeCoordinatorExecutionProjection,
} from "../src/runtime-transport/infrastructure/d1/runtime-coordinator-execution-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("RuntimeCoordinator active Wake progress projection repo", () => {
  it("lists active native delivery evidence without a RuntimeCoordinator execution", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldRemoteAgent_native_delivery_ledger"
    );
    try {
      for (const row of [
        {
          deliveryId: "delivery-accepted",
          dispatchId: "dispatch-accepted",
          routineRunId: null,
          spaceId: "space-1",
          status: "accepted",
          acceptedAtMs: 100,
          callbackReceivedAtMs: null,
          finalPublicationState: null,
          updatedAtMs: 110,
        },
        {
          deliveryId: "delivery-retry-observed",
          dispatchId: "dispatch-retry-observed",
          routineRunId: null,
          spaceId: "space-1",
          status: "retry_observed",
          acceptedAtMs: 105,
          callbackReceivedAtMs: 115,
          finalPublicationState: "outcome_unknown",
          updatedAtMs: 120,
        },
        {
          deliveryId: "delivery-publishing",
          dispatchId: "dispatch-publishing",
          routineRunId: null,
          spaceId: "space-1",
          status: "accepted",
          acceptedAtMs: 110,
          callbackReceivedAtMs: 125,
          finalPublicationState: null,
          updatedAtMs: 130,
        },
        {
          deliveryId: "delivery-submitted",
          dispatchId: "dispatch-submitted",
          routineRunId: null,
          spaceId: "space-1",
          status: "submitted",
          acceptedAtMs: null,
          callbackReceivedAtMs: null,
          finalPublicationState: null,
          updatedAtMs: 140,
        },
        {
          deliveryId: "delivery-routine",
          dispatchId: "dispatch-routine",
          routineRunId: "routine-run-1",
          spaceId: "space-1",
          status: "accepted",
          acceptedAtMs: 145,
          callbackReceivedAtMs: null,
          finalPublicationState: null,
          updatedAtMs: 150,
        },
      ] as const) {
        harness.run({
          params: [
            row.deliveryId,
            row.spaceId,
            `client-${row.deliveryId}`,
            row.dispatchId,
            `idempotency-${row.deliveryId}`,
            row.status,
            row.routineRunId,
            row.acceptedAtMs,
            row.callbackReceivedAtMs,
            row.finalPublicationState,
            row.updatedAtMs,
            row.updatedAtMs,
          ],
          sql: `
            INSERT INTO openMeldRemoteAgent_native_delivery_ledger (
              delivery_id,
              organization_id,
              conversation_kind,
              space_id,
              profile_id,
              binding_id,
              trigger_message_id,
              source_client_message_id,
              dispatch_id,
              idempotency_key,
              status,
              on_behalf_of_profile_id,
              routine_run_id,
              accepted_at_ms,
              callback_received_at_ms,
              final_publication_state,
              created_at_ms,
              updated_at_ms
            )
            VALUES (?, 'org-1', 'space', ?, 'agt_target_native', 'binding-1', 'signal-1', ?, ?, ?, ?, 'human-source-1', ?, ?, ?, ?, ?, ?)
          `,
        });
      }

      await expect(
        listActiveRemoteAgentNativeDeliveryWakeProgressEvidenceBySpace({
          db: harness.db,
          sourceProfileId: "human-source-other",
          spaceId: "space-1",
        })
      ).resolves.toEqual([]);
      await expect(
        listActiveRemoteAgentNativeDeliveryWakeProgressEvidenceBySpace({
          db: harness.db,
          sourceProfileId: "human-source-1",
          spaceId: "space-1",
          targetProfileId: "agt_target_native",
        })
      ).resolves.toEqual([
        {
          clientMessageId: "client-delivery-publishing",
          dispatchId: "dispatch-publishing",
          failureReasonCode: null,
          phase: "publishing",
          sourceSignalId: "signal-1",
          startedAtMs: 110,
          targetProfileId: "agt_target_native",
          updatedAtMs: 130,
        },
        {
          clientMessageId: "client-delivery-retry-observed",
          dispatchId: "dispatch-retry-observed",
          failureReasonCode:
            "remote_agent.callback_publication_outcome_unknown",
          phase: "publication_unknown",
          sourceSignalId: "signal-1",
          startedAtMs: 105,
          targetProfileId: "agt_target_native",
          updatedAtMs: 120,
        },
        {
          clientMessageId: "client-delivery-accepted",
          dispatchId: "dispatch-accepted",
          failureReasonCode: null,
          phase: "running",
          sourceSignalId: "signal-1",
          startedAtMs: 100,
          targetProfileId: "agt_target_native",
          updatedAtMs: 110,
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("joins the latest dispatch attempt into active Wake progress selectors", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_coordinator_executions"
    );
    applyDrizzleMigrationForTable(harness, "openMeldDaemon_dispatch_ledger");
    applyDrizzleMigrationForTable(harness, "openMeldDaemon_dispatch_attempts");
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_coordinator_execution_events"
    );
    try {
      await writeExecution(harness.db, {
        dispatchId: "dispatch-native-delivery",
        runtimeCoordinatorExecutionId: "rce-native-delivery",
        sourceClientMessageId: "client-native-delivery",
        status: "created",
        targetProfileId: "agt_target_native",
        updatedAtMs: 100,
      });
      harness.run({
        params: [
          "idem-native-delivery",
          "dispatch-native-delivery",
          "space-1",
          "signal-native-delivery",
          "client-native-delivery",
          "agt_target_native",
          "dispatching",
          90,
          110,
          1,
          "attempt-native-delivery",
        ],
        sql: `
					INSERT INTO openMeldDaemon_dispatch_ledger (
						idempotency_key,
						dispatch_id,
						space_id,
						source_event_id,
						source_client_message_id,
						target_profile_id,
						status,
						first_seen_at_ms,
						last_attempt_at_ms,
						attempt_count,
						latest_attempt_id
					)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`,
      });
      harness.run({
        params: [
          "attempt-native-delivery",
          "dispatch-native-delivery",
          "idem-native-delivery",
          1,
          "waiting_result",
          "agt_target_native",
          90,
          100,
        ],
        sql: `
					INSERT INTO openMeldDaemon_dispatch_attempts (
						attempt_id,
						dispatch_id,
						idempotency_key,
						attempt_no,
						status,
						target_profile_id,
						created_at_ms,
						started_at_ms
					)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				`,
      });
      await writeRuntimeCoordinatorExecutionEventFromParts({
        db: harness.db,
        eventType: "lifecycle_accepted_local",
        idempotencyKey: "occupancy:occupied",
        observedAtMs: 120,
        payload: {
          agentControllerConversationOccupancy: {
            agentControllerConversationId: "conversation-private",
            contractVersion: 1,
            state: "occupied",
          },
        },
        runtimeCoordinatorExecutionId: "rce-native-delivery",
        statusAfter: "accepted_local",
      });

      await expect(
        listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace({
          db: harness.db,
          sourceDispatchIds: [],
          sourceProfileId: "human-source-other",
          spaceId: "space-1",
        })
      ).resolves.toEqual([]);
      await expect(
        listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace({
          db: harness.db,
          sourceDispatchIds: ["dispatch-native-delivery"],
          sourceProfileId: "human-source-1",
          spaceId: "space-1",
        })
      ).resolves.toEqual([
        expect.objectContaining({
          dispatchId: "dispatch-native-delivery",
          latestDispatchAttemptStatus: "waiting_result",
          sourceEventId: "signal-native-delivery",
          status: "created",
          waitReasonCode: "runtime.agent_controller_conversation.occupied",
        }),
      ]);

      harness.run({
        params: ["human-source-1", "dispatch-native-delivery"],
        sql: `
          UPDATE openMeldDaemon_dispatch_ledger
          SET source_profile_id = ?
          WHERE dispatch_id = ?
        `,
      });
      await expect(
        listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace({
          db: harness.db,
          sourceProfileId: "human-source-1",
          spaceId: "space-1",
        })
      ).resolves.toEqual([
        expect.objectContaining({ dispatchId: "dispatch-native-delivery" }),
      ]);

      await writeRuntimeCoordinatorExecutionEventFromParts({
        db: harness.db,
        eventType: "lifecycle_running",
        idempotencyKey: "occupancy:available",
        observedAtMs: 130,
        payload: {
          agentControllerConversationOccupancy: {
            agentControllerConversationId: "conversation-private",
            contractVersion: 1,
            state: "available",
          },
        },
        runtimeCoordinatorExecutionId: "rce-native-delivery",
        statusAfter: "running",
      });

      await expect(
        listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace({
          db: harness.db,
          spaceId: "space-1",
        })
      ).resolves.toEqual([
        expect.objectContaining({
          waitReasonCode: null,
        }),
      ]);
    } finally {
      harness.close();
    }
  });

  it("lists only active executions for one Space in newest-first order", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_coordinator_executions"
    );
    try {
      await writeExecution(harness.db, {
        dispatchId: "dispatch-running-old",
        runtimeCoordinatorExecutionId: "rce-running-old",
        sourceClientMessageId: "client-running-old",
        status: "running",
        targetProfileId: "agt_target_a",
        updatedAtMs: 100,
      });
      await writeExecution(harness.db, {
        dispatchId: "dispatch-created-new",
        runtimeCoordinatorExecutionId: "rce-created-new",
        sourceClientMessageId: "client-created-new",
        status: "created",
        targetProfileId: "agt_target_b",
        updatedAtMs: 300,
      });
      await writeExecution(harness.db, {
        dispatchId: "dispatch-stop-requested",
        runtimeCoordinatorExecutionId: "rce-stop-requested",
        sourceClientMessageId: "client-stop-requested",
        status: "cancellation_requested",
        targetProfileId: "agt_target_b",
        updatedAtMs: 350,
      });
      await writeExecution(harness.db, {
        dispatchId: "dispatch-replied",
        runtimeCoordinatorExecutionId: "rce-replied",
        sourceClientMessageId: "client-replied",
        status: "reply_published",
        targetProfileId: "agt_target_a",
        updatedAtMs: 400,
      });
      await writeExecution(harness.db, {
        dispatchId: "dispatch-cancelled",
        runtimeCoordinatorExecutionId: "rce-cancelled",
        sourceClientMessageId: "client-cancelled",
        status: "cancelled",
        targetProfileId: "agt_target_a",
        updatedAtMs: 450,
      });
      await writeExecution(harness.db, {
        dispatchId: "dispatch-other-space",
        runtimeCoordinatorExecutionId: "rce-other-space",
        sourceClientMessageId: "client-other-space",
        spaceId: "space-other",
        status: "running",
        targetProfileId: "agt_target_a",
        updatedAtMs: 500,
      });

      await expect(
        listActiveRuntimeCoordinatorExecutionProjectionsBySpace({
          db: harness.db,
          spaceId: "space-1",
        })
      ).resolves.toMatchObject([
        {
          runtimeCoordinatorExecutionId: "rce-stop-requested",
          sourceClientMessageId: "client-stop-requested",
          status: "cancellation_requested",
          targetProfileId: "agt_target_b",
        },
        {
          runtimeCoordinatorExecutionId: "rce-created-new",
          sourceClientMessageId: "client-created-new",
          status: "created",
          targetProfileId: "agt_target_b",
        },
        {
          runtimeCoordinatorExecutionId: "rce-running-old",
          sourceClientMessageId: "client-running-old",
          status: "running",
          targetProfileId: "agt_target_a",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("allows running executions to enter cancellation_requested without treating the request as terminal", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_coordinator_executions"
    );
    try {
      await writeExecution(harness.db, {
        dispatchId: "dispatch-stop-requested",
        runtimeCoordinatorExecutionId: "rce-stop-requested",
        sourceClientMessageId: "client-stop-requested",
        status: "running",
        targetProfileId: "agt_target_a",
        updatedAtMs: 100,
      });

      await expect(
        writeRuntimeCoordinatorExecutionProjection({
          db: harness.db,
          record: buildExecution({
            dispatchId: "dispatch-stop-requested",
            runtimeCoordinatorExecutionId: "rce-stop-requested",
            sourceClientMessageId: "client-stop-requested",
            status: "cancellation_requested",
            targetProfileId: "agt_target_a",
            updatedAtMs: 110,
          }),
        })
      ).resolves.toBe("updated");

      await expect(
        readRuntimeCoordinatorExecutionProjectionById({
          db: harness.db,
          runtimeCoordinatorExecutionId: "rce-stop-requested",
        })
      ).resolves.toMatchObject({
        status: "cancellation_requested",
        terminalOutcome: null,
      });
    } finally {
      harness.close();
    }
  });

  it("locks cancelled terminal projections against later non-terminal writes", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_coordinator_executions"
    );
    try {
      await writeExecution(harness.db, {
        dispatchId: "dispatch-cancelled",
        runtimeCoordinatorExecutionId: "rce-cancelled",
        sourceClientMessageId: "client-cancelled",
        status: "cancelled",
        targetProfileId: "agt_target_a",
        updatedAtMs: 100,
      });

      await expect(
        writeRuntimeCoordinatorExecutionProjection({
          db: harness.db,
          record: buildExecution({
            dispatchId: "dispatch-cancelled",
            runtimeCoordinatorExecutionId: "rce-cancelled",
            sourceClientMessageId: "client-cancelled",
            status: "running",
            targetProfileId: "agt_target_a",
            updatedAtMs: 110,
          }),
        })
      ).resolves.toBe("skipped_stale");

      await expect(
        readRuntimeCoordinatorExecutionProjectionById({
          db: harness.db,
          runtimeCoordinatorExecutionId: "rce-cancelled",
        })
      ).resolves.toMatchObject({
        status: "cancelled",
        terminalOutcome: {
          kind: "cancelled",
          reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
        },
      });
    } finally {
      harness.close();
    }
  });

  it("filters active executions by target profile", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_coordinator_executions"
    );
    try {
      await writeExecution(harness.db, {
        dispatchId: "dispatch-target-a",
        runtimeCoordinatorExecutionId: "rce-target-a",
        sourceClientMessageId: "client-target-a",
        status: "running",
        targetProfileId: "agt_target_a",
        updatedAtMs: 100,
      });
      await writeExecution(harness.db, {
        dispatchId: "dispatch-target-b",
        runtimeCoordinatorExecutionId: "rce-target-b",
        sourceClientMessageId: "client-target-b",
        status: "failed_retryable",
        targetProfileId: "agt_target_b",
        updatedAtMs: 200,
      });

      const records =
        await listActiveRuntimeCoordinatorExecutionProjectionsBySpace({
          db: harness.db,
          spaceId: "space-1",
          targetProfileId: "agt_target_b",
        });

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        runtimeCoordinatorExecutionId: "rce-target-b",
        sourceClientMessageId: "client-target-b",
        status: "failed_retryable",
        targetProfileId: "agt_target_b",
      });
    } finally {
      harness.close();
    }
  });
});

async function writeExecution(
  db: D1Database,
  input: {
    dispatchId: string;
    runtimeCoordinatorExecutionId: string;
    sourceClientMessageId: string;
    spaceId?: string;
    status: RuntimeCoordinatorExecutionStatus;
    targetProfileId: string;
    updatedAtMs: number;
  }
): Promise<void> {
  await writeRuntimeCoordinatorExecutionProjection({
    db,
    record: buildExecution(input),
  });
}

function buildExecution(input: {
  dispatchId: string;
  runtimeCoordinatorExecutionId: string;
  sourceClientMessageId: string;
  spaceId?: string;
  status: RuntimeCoordinatorExecutionStatus;
  targetProfileId: string;
  updatedAtMs: number;
}): RuntimeCoordinatorExecutionRecord {
  return {
    agentControllerRef: "builtin:codex",
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority",
      value: "runtime-1",
    },
    bindingId: "binding-1",
    createdAtMs: input.updatedAtMs - 10,
    dispatchId: input.dispatchId,
    legacyPointers: {
      attemptId: null,
      claimLeaseId: null,
      connectionGeneration: null,
      daemonSessionId: null,
      leaseEpoch: null,
    },
    modelVersion: RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    sourceClientMessageId: input.sourceClientMessageId,
    spaceId: input.spaceId ?? "space-1",
    status: input.status,
    targetProfileId: input.targetProfileId,
    terminalOutcome: buildTerminalOutcomeForTest(input),
    updatedAtMs: input.updatedAtMs,
  };
}

function buildTerminalOutcomeForTest(input: {
  status: RuntimeCoordinatorExecutionStatus;
  updatedAtMs: number;
}): RuntimeCoordinatorExecutionRecord["terminalOutcome"] {
  if (input.status === "reply_published") {
    return {
      kind: "reply_published",
      observedAtMs: input.updatedAtMs,
      reasonCode: null,
    };
  }
  if (input.status === "cancelled") {
    return {
      kind: "cancelled",
      observedAtMs: input.updatedAtMs,
      reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
    };
  }
  return null;
}
