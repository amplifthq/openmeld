import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION } from "@openmeld/schemas";
import type {
  RuntimeCoordinatorExecutionRecord,
  RuntimeCoordinatorExecutionStatus,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { listActiveRemoteAgentNativeDeliveryWakeProgressEvidenceBySpace } from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  listActiveRuntimeCoordinatorExecutionProjectionsBySpace,
  listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace,
  readRuntimeCoordinatorExecutionProjectionById,
  readRuntimeCoordinatorExecutionRunningAtMs,
  writeRuntimeCoordinatorExecutionEventFromParts,
  writeRuntimeCoordinatorExecutionProjection,
} from "../src/runtime-transport/infrastructure/postgresql/runtime-coordinator-execution-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("RuntimeCoordinator active Wake progress projection repo", () => {
  it("preserves running progress when a delivery acceptance write wins the same-row race", async () => {
    const harness = await createPostgresHarness();
    const identity = {
      dispatchId: "dispatch-race",
      runtimeCoordinatorExecutionId: "rce-race",
      sourceClientMessageId: "client-race",
      targetProfileId: "agt_target_a",
    };
    let locked = false;
    const writes: Promise<unknown>[] = [];
    try {
      await writeExecution(harness.db, {
        ...identity,
        status: "created",
        updatedAtMs: 100,
      });
      await harness.query("BEGIN");
      locked = true;
      await harness.query({
        text: 'SELECT 1 FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions" WHERE runtime_coordinator_execution_id=$1 FOR UPDATE',
        values: [identity.runtimeCoordinatorExecutionId],
      });
      for (const status of ["delivery_accepted", "running"] as const) {
        writes.push(
          writeRuntimeCoordinatorExecutionProjection({
            db: harness.db,
            record: buildExecution({ ...identity, status, updatedAtMs: 110 }),
          })
        );
        await vi.waitFor(async () => {
          await harness.query("SELECT pg_stat_clear_snapshot()");
          const result = await harness.query<{ count: string }>(
            "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename='openmeld_pg_runtime' AND wait_event_type='Lock'"
          );
          expect(Number(result.rows[0]?.count)).toBe(writes.length);
        });
      }
      await harness.query("COMMIT");
      locked = false;
      await Promise.all(writes);
      expect(
        await readRuntimeCoordinatorExecutionProjectionById({
          db: harness.db,
          runtimeCoordinatorExecutionId: identity.runtimeCoordinatorExecutionId,
        })
      ).toMatchObject({ status: "running", terminalOutcome: null });
    } finally {
      if (locked) {
        await harness.query("ROLLBACK");
      }
      await Promise.allSettled(writes);
      await harness.close();
    }
  });
  it("keeps working time separate from waiting, heartbeat replacement, and missing legacy evidence", async () => {
    const harness = await createPostgresHarness();
    try {
      await writeExecution(harness.db, {
        dispatchId: "dispatch-timing",
        runtimeCoordinatorExecutionId: "rce-timing",
        sourceClientMessageId: "client-timing",
        status: "running",
        targetProfileId: "agt_target",
        updatedAtMs: 100,
      });
      const readStart = () =>
        readRuntimeCoordinatorExecutionRunningAtMs({
          db: harness.db,
          runtimeCoordinatorExecutionId: "rce-timing",
        });
      expect(await readStart()).toBeNull();
      const timingIndex = await harness.queryFirst<{ indexdef: string }>({
        text: `SELECT indexdef FROM pg_indexes WHERE schemaname = 'openmeld'
          AND tablename = 'openMeldDaemon_runtime_coordinator_execution_events'
          AND indexdef LIKE '%runtime_coordinator_execution_id, event_type%'`,
      });
      expect(timingIndex?.indexdef).toContain(
        "runtime_coordinator_execution_id, event_type"
      );
      for (const observedAtMs of [4_260_000, 4_440_000]) {
        await writeRuntimeCoordinatorExecutionEventFromParts({
          db: harness.db,
          eventType: "lifecycle_running",
          idempotencyKey: "running:available",
          observedAtMs,
          payload: { runningAtMs: 4_260_000, lifecycleAtMs: observedAtMs },
          replaceCurrentState: true,
          runtimeCoordinatorExecutionId: "rce-timing",
          statusAfter: "running",
        });
        expect(await readStart()).toBe(4_260_000);
        const [item] =
          await listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace(
            {
              db: harness.db,
              spaceId: "space-1",
              includeTiming: true,
            }
          );
        expect(item?.runningAtMs).toBe(4_260_000);
      }
      const [withoutTiming] =
        await listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace(
          {
            db: harness.db,
            spaceId: "space-1",
          }
        );
      expect(withoutTiming?.runningAtMs).toBeNull();
    } finally {
      await harness.close();
    }
  });
  it("lists active native delivery evidence without a RuntimeCoordinator execution", async () => {
    const harness = await createPostgresHarness();

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
        await harness.query({
          values: [
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
          text: `
            INSERT INTO "openmeld"."openMeldRemoteAgent_native_delivery_ledger" (
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
            VALUES ($1, 'org-1', 'space', $2, 'agt_target_native', 'binding-1', 'signal-1', $3, $4, $5, $6, 'human-source-1', $7, $8, $9, $10, $11, $12)
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
      await harness.close();
    }
  });

  it("joins the latest dispatch attempt into active Wake progress selectors", async () => {
    const harness = await createPostgresHarness();

    try {
      await writeExecution(harness.db, {
        dispatchId: "dispatch-native-delivery",
        runtimeCoordinatorExecutionId: "rce-native-delivery",
        sourceClientMessageId: "client-native-delivery",
        status: "created",
        targetProfileId: "agt_target_native",
        updatedAtMs: 100,
      });
      await harness.query({
        values: [
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
        text: `
					INSERT INTO "openmeld"."openMeldDaemon_dispatch_ledger" (
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
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
				`,
      });
      await harness.query({
        values: [
          "attempt-native-delivery",
          "dispatch-native-delivery",
          "idem-native-delivery",
          1,
          "waiting_result",
          "agt_target_native",
          90,
          100,
        ],
        text: `
					INSERT INTO "openmeld"."openMeldDaemon_dispatch_attempts" (
						attempt_id,
						dispatch_id,
						idempotency_key,
						attempt_no,
						status,
						target_profile_id,
						created_at_ms,
						started_at_ms
					)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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

      await harness.query({
        values: ["human-source-1", "dispatch-native-delivery"],
        text: `
          UPDATE "openmeld"."openMeldDaemon_dispatch_ledger"
          SET source_profile_id = $1
          WHERE dispatch_id = $2
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
      await harness.close();
    }
  });

  it("reports an accepted execution as locally queued until the Service starts it", async () => {
    const harness = await createPostgresHarness();
    try {
      await writeExecution(harness.db, {
        dispatchId: "dispatch-local-queue",
        runtimeCoordinatorExecutionId: "rce-local-queue",
        sourceClientMessageId: "client-local-queue",
        status: "accepted_local",
        targetProfileId: "agt_target",
        updatedAtMs: 100,
      });
      const readLocallyQueued = async () =>
        (
          await listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace(
            { db: harness.db, spaceId: "space-1" }
          )
        )[0]?.locallyQueued;
      await writeRuntimeCoordinatorExecutionEventFromParts({
        db: harness.db,
        eventType: "lifecycle_accepted_local",
        idempotencyKey: "lifecycle:dispatch-local-queue:attempt:queued",
        observedAtMs: 110,
        payload: {
          localQueue: { status: "queued", waitReason: "workspace_conflict" },
        },
        runtimeCoordinatorExecutionId: "rce-local-queue",
        statusAfter: "accepted_local",
      });
      expect(await readLocallyQueued()).toBe(true);
      await writeRuntimeCoordinatorExecutionEventFromParts({
        db: harness.db,
        eventType: "lifecycle_accepted_local",
        idempotencyKey: "lifecycle:dispatch-local-queue:attempt",
        observedAtMs: 120,
        payload: { localQueue: null },
        runtimeCoordinatorExecutionId: "rce-local-queue",
        statusAfter: "accepted_local",
      });
      expect(await readLocallyQueued()).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it("lists only active executions for one Space in newest-first order", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });

  it("allows running executions to enter cancellation_requested without treating the request as terminal", async () => {
    const harness = await createPostgresHarness();

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
      ).resolves.toBe("written");

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
      await harness.close();
    }
  });

  it.each([
    "cancelled",
    "failed_terminal",
    "reply_published",
  ] as const)("locks %s terminal projections against later non-terminal or conflicting terminal writes", async (status) => {
    const harness = await createPostgresHarness();
    try {
      await writeExecution(harness.db, {
        dispatchId: "dispatch-cancelled",
        runtimeCoordinatorExecutionId: "rce-cancelled",
        sourceClientMessageId: "client-cancelled",
        status,
        targetProfileId: "agt_target_a",
        updatedAtMs: 100,
      });

      const terminal = await readRuntimeCoordinatorExecutionProjectionById({
        db: harness.db,
        runtimeCoordinatorExecutionId: "rce-cancelled",
      });
      for (const nextStatus of [
        "running",
        status === "cancelled" ? "reply_published" : "cancelled",
      ] as const) {
        await expect(
          writeRuntimeCoordinatorExecutionProjection({
            db: harness.db,
            record: buildExecution({
              dispatchId: "dispatch-cancelled",
              runtimeCoordinatorExecutionId: "rce-cancelled",
              sourceClientMessageId: "client-cancelled",
              status: nextStatus,
              targetProfileId: "agt_target_a",
              updatedAtMs: 110,
            }),
          })
        ).resolves.toBe("skipped_stale");
      }

      await expect(
        readRuntimeCoordinatorExecutionProjectionById({
          db: harness.db,
          runtimeCoordinatorExecutionId: "rce-cancelled",
        })
      ).resolves.toEqual(terminal);
    } finally {
      await harness.close();
    }
  });

  it.each([
    {
      initial: "created",
      first: "delivery_accepted",
      second: "running",
      expectedStatus: "running",
      expectedAtMs: 111,
    },
    {
      initial: "running",
      first: "running",
      second: "reply_published",
      expectedStatus: "reply_published",
      expectedAtMs: 111,
    },
    {
      initial: "running",
      first: "running",
      second: "running",
      expectedStatus: "running",
      expectedAtMs: 111,
    },
    {
      initial: null,
      first: "created",
      second: "running",
      expectedStatus: "running",
      expectedAtMs: 111,
    },
    {
      initial: null,
      first: "running",
      second: "created",
      expectedStatus: "running",
      expectedAtMs: 110,
    },
  ] as const)("retains the advanced projection when $first and $second race from $initial", async ({
    initial,
    first,
    second,
    expectedStatus,
    expectedAtMs,
  }) => {
    const harness = await createPostgresHarness();
    const record = (
      status: RuntimeCoordinatorExecutionStatus,
      updatedAtMs: number
    ) => ({
      ...buildExecution({
        dispatchId: "dispatch-race",
        runtimeCoordinatorExecutionId: "rce-race",
        sourceClientMessageId: "client-race",
        status,
        targetProfileId: "agt_target",
        updatedAtMs,
      }),
      createdAtMs: 90,
    });
    try {
      if (initial) {
        await writeRuntimeCoordinatorExecutionProjection({
          db: harness.db,
          record: record(initial, 100),
        });
      }
      await Promise.all(
        [first, second].map((status, index) =>
          writeRuntimeCoordinatorExecutionProjection({
            db: harness.db,
            record: record(status, 110 + index),
          })
        )
      );
      await expect(
        readRuntimeCoordinatorExecutionProjectionById({
          db: harness.db,
          runtimeCoordinatorExecutionId: "rce-race",
        })
      ).resolves.toMatchObject({
        createdAtMs: 90,
        status: expectedStatus,
        updatedAtMs: expectedAtMs,
      });
    } finally {
      await harness.close();
    }
  });

  it.each([
    {
      status: "delivery_accepted",
      updatedAtMs: 120,
      expected: "skipped_stale",
    },
    {
      status: "running",
      updatedAtMs: 100,
      expected: "skipped_stale",
    },
    {
      status: "running",
      updatedAtMs: 110,
      expected: "written",
    },
  ] as const)("adjudicates $status at $updatedAtMs against the stored running projection", async ({
    status,
    updatedAtMs,
    expected,
  }) => {
    const harness = await createPostgresHarness();
    const base = buildExecution({
      dispatchId: "dispatch-stale",
      runtimeCoordinatorExecutionId: "rce-stale",
      sourceClientMessageId: "client-stale",
      status: "running",
      targetProfileId: "agt_target",
      updatedAtMs: 110,
    });
    try {
      await writeRuntimeCoordinatorExecutionProjection({
        db: harness.db,
        record: base,
      });
      await expect(
        writeRuntimeCoordinatorExecutionProjection({
          db: harness.db,
          record: { ...base, status, updatedAtMs },
        })
      ).resolves.toBe(expected);
      await expect(
        readRuntimeCoordinatorExecutionProjectionById({
          db: harness.db,
          runtimeCoordinatorExecutionId: "rce-stale",
        })
      ).resolves.toEqual(base);
    } finally {
      await harness.close();
    }
  });

  it("filters active executions by target profile", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
});

async function writeExecution(
  db: PostgresDatabase,
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
  if (input.status === "failed_terminal") {
    return {
      kind: "failed_terminal",
      observedAtMs: input.updatedAtMs,
      reasonCode: "runtime.progress_stale",
    };
  }
  return null;
}
