import { RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION } from "@openmeld/schemas";
import type {
  RuntimeCoordinatorExecutionRecord,
  RuntimeCoordinatorExecutionStatus,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { countActiveRemoteAgentNativeDeliveriesBySpaceIds } from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  countActiveRuntimeCoordinatorExecutionsBySpaceIds,
  writeRuntimeCoordinatorExecutionProjection,
} from "../src/runtime-transport/infrastructure/d1/runtime-coordinator-execution-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("account space active wake count repos", () => {
  it("counts only fresh active executions inside the requested space list", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_coordinator_executions"
    );
    try {
      await writeExecution(harness.db, {
        dispatchId: "dispatch-running",
        runtimeCoordinatorExecutionId: "rce-running",
        sourceClientMessageId: "client-running",
        spaceId: "space-1",
        status: "running",
        updatedAtMs: 1000,
      });
      await writeExecution(harness.db, {
        dispatchId: "dispatch-created",
        runtimeCoordinatorExecutionId: "rce-created",
        sourceClientMessageId: "client-created",
        spaceId: "space-1",
        status: "created",
        updatedAtMs: 1100,
      });
      await writeExecution(harness.db, {
        dispatchId: "dispatch-terminal",
        runtimeCoordinatorExecutionId: "rce-terminal",
        sourceClientMessageId: "client-terminal",
        spaceId: "space-1",
        status: "reply_published",
        updatedAtMs: 1200,
      });
      await writeExecution(harness.db, {
        dispatchId: "dispatch-stale",
        runtimeCoordinatorExecutionId: "rce-stale",
        sourceClientMessageId: "client-stale",
        spaceId: "space-2",
        status: "running",
        updatedAtMs: 100,
      });
      await writeExecution(harness.db, {
        dispatchId: "dispatch-elsewhere",
        runtimeCoordinatorExecutionId: "rce-elsewhere",
        sourceClientMessageId: "client-elsewhere",
        spaceId: "space-outside",
        status: "running",
        updatedAtMs: 1300,
      });

      await expect(
        countActiveRuntimeCoordinatorExecutionsBySpaceIds({
          db: harness.db,
          freshAfterMs: 500,
          spaceIds: ["space-1", "space-2", "space-quiet"],
        })
      ).resolves.toEqual(new Map([["space-1", 2]]));
    } finally {
      harness.close();
    }
  });

  it("counts only fresh active non-routine Space native deliveries", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldRemoteAgent_native_delivery_ledger"
    );
    try {
      for (const row of [
        {
          conversationKind: "space",
          deliveryId: "delivery-accepted",
          routineRunId: null,
          spaceId: "space-1",
          status: "accepted",
          executionEvidenceAtMs: 1000,
          updatedAtMs: 1000,
        },
        {
          conversationKind: "space",
          deliveryId: "delivery-retry",
          routineRunId: null,
          spaceId: "space-1",
          status: "retry_observed",
          executionEvidenceAtMs: 1050,
          updatedAtMs: 1050,
        },
        {
          conversationKind: "space",
          deliveryId: "delivery-submitted",
          routineRunId: null,
          spaceId: "space-1",
          status: "submitted",
          executionEvidenceAtMs: null,
          updatedAtMs: 1100,
        },
        {
          conversationKind: "space",
          deliveryId: "delivery-routine",
          routineRunId: "routine-run-1",
          spaceId: "space-1",
          status: "accepted",
          executionEvidenceAtMs: 1150,
          updatedAtMs: 1150,
        },
        {
          conversationKind: "slack",
          deliveryId: "delivery-slack",
          routineRunId: null,
          spaceId: "space-1",
          status: "accepted",
          executionEvidenceAtMs: 1200,
          updatedAtMs: 1200,
        },
        {
          conversationKind: "space",
          deliveryId: "delivery-stale",
          routineRunId: null,
          spaceId: "space-2",
          status: "accepted",
          executionEvidenceAtMs: 100,
          updatedAtMs: 100,
        },
        {
          conversationKind: "space",
          deliveryId: "delivery-background-refresh",
          routineRunId: null,
          spaceId: "space-2",
          status: "accepted",
          executionEvidenceAtMs: 100,
          updatedAtMs: 1300,
        },
      ] as const) {
        harness.run({
          params: [
            row.deliveryId,
            row.conversationKind,
            row.spaceId,
            `dispatch-${row.deliveryId}`,
            `idempotency-${row.deliveryId}`,
            row.status,
            row.routineRunId,
            row.executionEvidenceAtMs,
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
              dispatch_id,
              idempotency_key,
              status,
              routine_run_id,
              execution_evidence_at_ms,
              created_at_ms,
              updated_at_ms
            )
            VALUES (?, 'org-1', ?, ?, 'agt_target_native', 'binding-1', 'signal-1', ?, ?, ?, ?, ?, ?, ?)
          `,
        });
      }

      await expect(
        countActiveRemoteAgentNativeDeliveriesBySpaceIds({
          db: harness.db,
          freshAfterMs: 500,
          spaceIds: ["space-1", "space-2"],
        })
      ).resolves.toEqual(new Map([["space-1", 2]]));
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
    spaceId: string;
    status: RuntimeCoordinatorExecutionStatus;
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
  spaceId: string;
  status: RuntimeCoordinatorExecutionStatus;
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
    spaceId: input.spaceId,
    status: input.status,
    targetProfileId: "agt_target_a",
    terminalOutcome:
      input.status === "reply_published"
        ? {
            kind: "reply_published",
            observedAtMs: input.updatedAtMs,
            reasonCode: null,
          }
        : null,
    updatedAtMs: input.updatedAtMs,
  };
}
