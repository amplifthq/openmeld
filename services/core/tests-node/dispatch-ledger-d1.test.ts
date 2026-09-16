import {
  buildRuntimeCoordinatorExecutionId,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonDispatchQueueMessage,
  RuntimeTransportDeliveryExecutionIdentity,
} from "@openmeld/schemas/types";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  claimDispatchAttempt,
  claimFinalReplyEmission,
  claimReplyingHintEmission,
  correlateDuplicateDispatchDeliveryAttempt,
  markDispatchAttemptWaitingForResult,
  markDispatchStatus,
  readDeliveryStabilityDispatchMetrics,
  recordDispatchAttemptExecutionOwnership,
  rollbackFinalReplyEmissionClaim,
  rollbackReplyingHintEmissionClaim,
} from "../src/dispatch/infrastructure/d1/dispatch-ledger-d1";
import {
  DISPATCH_IDEMPOTENCY_WINDOW_MS,
  DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
} from "../src/dispatch/rules/dispatch-runtime-constants";
import { buildDispatchMessage } from "../tests-support/dispatch-ledger-message";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

type LedgerRow = {
  idempotencyKey: string;
  dispatchId: string;
  spaceId: string;
  sourceEventId: string;
  sourceProfileId?: string | null;
  sourceClientMessageId: string | null;
  dispatchOwnerKind?: string | null;
  dispatchOwnerId?: string | null;
  targetProfileId: string;
  status: string;
  firstSeenAtMs: number;
  lastAttemptAtMs: number;
  attemptCount: number;
  latestAttemptId: string | null;
  replyHintSentAtMs: number | null;
  finalReplySentAtMs: number | null;
};

type AttemptRow = {
  attemptId: string;
  dispatchId: string;
  idempotencyKey: string;
  attemptNo: number;
  status: string;
  daemonSessionId: string | null;
  connectionGeneration: number | null;
  leaseEpoch: number | null;
  executionBindingId: string | null;
  executionAgentControllerRef: string | null;
  executionIdentityModelVersion: string | null;
  executionRuntimeId: string | null;
  targetProfileId: string | null;
  taskId: string | null;
  createdAtMs: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type DlqRow = {
  dispatchId: string;
  idempotencyKey: string;
  sourceEventId: string;
  targetProfileId: string;
  errorCode: string;
  failedAtMs: number;
};

const buildExecutionIdentity = (input: {
  dispatchId: string;
  targetProfileId: string;
}): RuntimeTransportDeliveryExecutionIdentity => ({
  authority: "core_runtime_registry_binding_route",
  core: {
    modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
    spaceId: "space-1",
    dispatchId: input.dispatchId,
    targetProfileId: input.targetProfileId,
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority",
      value: "runtime-1",
    },
    bindingId: "binding-1",
    agentControllerRef: "builtin:codex",
  },
});

const buildExpectedRuntimeCoordinatorExecutionId = (
  message: OpenMeldDaemonDispatchQueueMessage
): string =>
  buildRuntimeCoordinatorExecutionId({
    dispatchId: message.dispatchId,
    spaceId: message.spaceId,
    targetProfileId: message.targetProfileId,
  });

const createDispatchLedgerFixture = () => {
  const harness = createSqliteD1Harness();
  onTestFinished(() => harness.close());
  applyDrizzleMigrationsForTables(harness, [
    "openMeldDaemon_dispatch_ledger",
    "openMeldDaemon_dispatch_attempts",
    "openMeldDaemon_dlq",
    "openMeldDaemon_ops_decisions",
    "openMeldDaemon_runtime_coordinator_executions",
  ]);

  // Fixture conversion only; production SQL is executed by SQLite unchanged.
  const columnName = (key: string) =>
    key === "executionRuntimeId"
      ? "execution_openmeld_service_runtime_id"
      : key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const readRecord = <T>(
    table: string,
    key: string,
    value: string
  ): T | undefined => {
    const row = harness.queryFirst({
      sql: `SELECT * FROM ${table} WHERE ${key} = ?`,
      params: [value],
    });
    if (!row) {
      return undefined;
    }
    return Object.fromEntries(
      Object.entries(row).map(([column, field]) => [
        column === "execution_openmeld_service_runtime_id"
          ? "executionRuntimeId"
          : column.replace(/_([a-z])/g, (_, letter: string) =>
              letter.toUpperCase()
            ),
        field,
      ])
    ) as T;
  };
  const seedRecord = (
    table: string,
    key: string,
    row: Record<string, unknown>
  ) => {
    const fields = Object.entries(row).filter(
      ([, value]) => value !== undefined
    );
    const columns = fields.map(([name]) => columnName(name));
    harness.run({
      sql: `INSERT INTO ${table} (${columns.join(", ")})
        VALUES (${columns.map(() => "?").join(", ")})
        ON CONFLICT(${key}) DO UPDATE SET
        ${columns
          .filter((name) => name !== key)
          .map((name) => `${name} = excluded.${name}`)
          .join(", ")}`,
      params: fields.map(([, value]) => value as string | number | null),
    });
  };

  return {
    db: harness.db,
    seedRow: (row: LedgerRow) =>
      seedRecord("openMeldDaemon_dispatch_ledger", "idempotency_key", row),
    readRow: (key: string) =>
      readRecord<LedgerRow>(
        "openMeldDaemon_dispatch_ledger",
        "idempotency_key",
        key
      ),
    readRows: () =>
      harness.queryAll({ sql: "SELECT * FROM openMeldDaemon_dispatch_ledger" }),
    readAttempt: (id: string) =>
      readRecord<AttemptRow>(
        "openMeldDaemon_dispatch_attempts",
        "attempt_id",
        id
      ),
    seedAttemptRow: (row: AttemptRow) =>
      seedRecord("openMeldDaemon_dispatch_attempts", "attempt_id", row),
    readOpsDecisions: () =>
      harness
        .queryAll<{ decision_payload_json: string }>({
          sql: "SELECT decision_payload_json FROM openMeldDaemon_ops_decisions ORDER BY rowid",
        })
        .map((row) => JSON.parse(row.decision_payload_json)),
    injectAttemptInsertFailure: () =>
      harness.run({
        sql: `CREATE TEMP TRIGGER fail_dispatch_attempt_insert
        BEFORE INSERT ON openMeldDaemon_dispatch_attempts
        BEGIN SELECT RAISE(ABORT, 'injected dispatch attempt insert failure'); END`,
      }),
    clearAttemptInsertFailure: () =>
      harness.run({ sql: "DROP TRIGGER fail_dispatch_attempt_insert" }),
    seedDlqRow: (row: DlqRow) => seedRecord("openMeldDaemon_dlq", "id", row),
    seedRuntimeCoordinatorExecution: (input: {
      attemptId?: string | null;
      daemonSessionId?: string | null;
      dispatchId: string;
      leaseEpoch?: number | null;
      status?: string;
      targetProfileId: string;
    }) =>
      harness.run({
        sql: `INSERT INTO openMeldDaemon_runtime_coordinator_executions (
        runtime_coordinator_execution_id, model_version, space_id, dispatch_id,
        target_profile_id, openmeld_service_runtime_id_source, openmeld_service_runtime_id,
        binding_id, agent_controller_ref, status, attempt_id, daemon_session_id,
        lease_epoch, connection_generation, created_at_ms, updated_at_ms
      ) VALUES (?, 'openmeld.runtime_coordinator.execution.v1', 'space-1', ?, ?,
        'runtime_registry_authority', 'runtime-1', 'binding-1', 'builtin:codex',
        ?, ?, ?, ?, 1, 1000, 1000)`,
        params: [
          `rce-${input.dispatchId}`,
          input.dispatchId,
          input.targetProfileId,
          input.status ?? "running",
          input.attemptId ?? null,
          input.daemonSessionId ?? null,
          input.leaseEpoch ?? null,
        ],
      }),
  };
};

const seedStaleDispatchLedgerClaim = async (input: {
  db: D1Database;
  message: OpenMeldDaemonDispatchQueueMessage;
  readRow: (idempotencyKey: string) => LedgerRow | undefined;
  seedRow: (row: LedgerRow) => void;
  status: LedgerRow["status"];
}) => {
  const first = await claimDispatchAttempt({
    db: input.db,
    message: input.message,
    attempt: 1,
    nowMs: 1000,
  });
  if (first.status !== "claimed" || first.attemptNo !== 1) {
    throw new Error("expected first claim");
  }

  const seeded = input.readRow(input.message.idempotencyKey);
  if (!seeded) {
    throw new Error("expected seeded row");
  }
  seeded.status = input.status;
  seeded.lastAttemptAtMs = 1000;
  input.seedRow(seeded);

  return first;
};

const summarizeConcurrentReclaim = (
  claimResults: Awaited<ReturnType<typeof claimDispatchAttempt>>[]
) => {
  return {
    claimedCount: claimResults.filter((result) => result.status === "claimed")
      .length,
    hasDedupedClaim: claimResults.some((result) => result.status === "deduped"),
  };
};

describe("dispatch ledger schema failures", () => {
  it("fails fast when the shared OPENMELD_DB migration has not created the ledger tables", async () => {
    const harness = createSqliteD1Harness();
    onTestFinished(() => harness.close());
    const db = harness.db;

    await expect(
      claimDispatchAttempt({
        db,
        message: buildDispatchMessage(),
        attempt: 1,
        nowMs: 1000,
      })
    ).rejects.toThrow("no such table: openMeldDaemon_dispatch_ledger");
  });
});

describe("claimDispatchAttempt", () => {
  it("rolls back a new ledger claim when its attempt insert fails", async () => {
    const {
      db,
      readRow,
      injectAttemptInsertFailure,
      clearAttemptInsertFailure,
    } = createDispatchLedgerFixture();
    injectAttemptInsertFailure();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-atomic-new-claim-1",
      sourceEventId: "signal-atomic-new-claim-1",
      targetProfileId: "agt-atomic-new-claim-1",
    });

    await expect(
      claimDispatchAttempt({
        attempt: 1,
        db,
        message,
        nowMs: 1000,
      })
    ).rejects.toThrow("injected dispatch attempt insert failure");
    clearAttemptInsertFailure();

    expect(readRow(message.idempotencyKey)).toBeUndefined();
    await expect(
      claimDispatchAttempt({
        attempt: 2,
        db,
        message,
        nowMs: 1100,
      })
    ).resolves.toMatchObject({
      attemptNo: 1,
      status: "claimed",
    });
  });

  it("retains concurrent intake recovery until the same Wake reaches execution handoff", async () => {
    const { db, readRows } = createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-concurrent-new-claim-1",
      sourceEventId: "signal-concurrent-new-claim-1",
      targetProfileId: "agt-concurrent-new-claim-1",
    });

    const claims = await Promise.allSettled([
      claimDispatchAttempt({
        attempt: 1,
        db,
        message,
        nowMs: 1000,
      }),
      claimDispatchAttempt({
        attempt: 1,
        db,
        message,
        nowMs: 1000,
      }),
    ]);

    expect(claims).toHaveLength(2);
    expect(claims.every((claim) => claim.status === "fulfilled")).toBe(true);
    const fulfilledClaims = claims
      .filter((claim) => claim.status === "fulfilled")
      .map((claim) => claim.value.status);
    expect(fulfilledClaims).toEqual(["claimed", "deduped"]);
    expect(claims[1]).toMatchObject({
      status: "fulfilled",
      value: { status: "deduped", admissionInFlight: true },
    });
    expect(readRows()).toHaveLength(1);

    const winner = claims[0];
    if (winner.status !== "fulfilled" || winner.value.status !== "claimed") {
      throw new Error("expected one admission owner");
    }
    await markDispatchStatus({
      attemptId: winner.value.attemptId,
      attemptStatus: "failed_retryable",
      db,
      errorCode: "agent_execution.readiness_unconfirmed",
      errorMessage: "Initial readiness evidence is not available yet",
      idempotencyKey: message.idempotencyKey,
      nowMs: 1100,
      status: "failed_retryable",
    });
    const resumed = await claimDispatchAttempt({
      attempt: 2,
      db,
      message,
      nowMs: 2000,
    });
    expect(resumed).toMatchObject({ status: "claimed", attemptNo: 2 });
    if (resumed.status !== "claimed") {
      throw new Error("expected the same Wake to resume admission");
    }
    await markDispatchAttemptWaitingForResult({
      attemptId: resumed.attemptId,
      db,
      idempotencyKey: message.idempotencyKey,
      nowMs: 2100,
      targetProfileId: message.targetProfileId,
      taskId: message.taskId,
    });
    await expect(
      claimDispatchAttempt({
        attempt: 3,
        db,
        message,
        nowMs: 2200,
      })
    ).resolves.toEqual({ status: "deduped" });
    expect(readRows()).toHaveLength(1);
  });

  it("projects hosted native delivery as waiting for a result without daemon ownership", async () => {
    const { db, readAttempt, readRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-hosted-native-delivery-1",
      sourceEventId: "signal-hosted-native-delivery-1",
      targetProfileId: "agt-hosted-native-delivery-1",
    });
    const claim = await claimDispatchAttempt({
      attempt: 1,
      db,
      message,
      nowMs: 1000,
    });
    if (claim.status !== "claimed") {
      throw new Error("expected hosted dispatch claim");
    }

    await markDispatchAttemptWaitingForResult({
      attemptId: claim.attemptId,
      db,
      idempotencyKey: message.idempotencyKey,
      nowMs: 2000,
      targetProfileId: message.targetProfileId,
      taskId: message.taskId,
    });

    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: claim.attemptId,
      status: "dispatching",
    });
    expect(readAttempt(claim.attemptId)).toMatchObject({
      connectionGeneration: null,
      daemonSessionId: null,
      leaseEpoch: null,
      status: "waiting_result",
      targetProfileId: message.targetProfileId,
      taskId: message.taskId,
    });
  });

  it("reuses the active dispatch attempt for incomplete hosted admission recovery", async () => {
    const { db } = createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-hosted-admission-recovery-1",
      sourceEventId: "signal-hosted-admission-recovery-1",
      targetProfileId: "agt-hosted-admission-recovery-1",
    });
    const first = await claimDispatchAttempt({
      attempt: 1,
      db,
      message,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first hosted dispatch claim");
    }

    await expect(
      claimDispatchAttempt({
        attempt: 2,
        db,
        message: {
          ...message,
          deliveryRecoveryReason: "hosted_admission_incomplete",
        },
        nowMs: 30_000,
      })
    ).resolves.toEqual({
      hostedAdmissionRecoveryAttemptId: first.attemptId,
      hostedAdmissionRecoveryAttemptNo: first.attemptNo,
      status: "deduped",
    });
  });

  it("persists the source message, profile, and owner in their own columns", async () => {
    const { db, readRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      sourceClientMessageId: "client-message-1",
      sourceProfileId: "human-source-1",
      dispatchOwner: { id: "owner-1", kind: "owner_account" },
    });
    await claimDispatchAttempt({ db, message, attempt: 1, nowMs: 1000 });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      sourceClientMessageId: "client-message-1",
      sourceProfileId: "human-source-1",
      dispatchOwnerKind: "owner_account",
      dispatchOwnerId: "owner-1",
    });
  });

  it.each([
    { name: "ownerless", owner: undefined },
    {
      name: "different-owner",
      owner: { id: "owner-b", kind: "owner_account" as const },
    },
  ])("preserves creation-time owner evidence on a $name retry", async ({
    owner,
  }) => {
    const { db, readRow, seedRow } = createDispatchLedgerFixture();
    const firstMessage = buildDispatchMessage({
      dispatchOwner: { id: "owner-a", kind: "owner_account" },
    });
    await claimDispatchAttempt({
      db,
      message: firstMessage,
      attempt: 1,
      nowMs: 1000,
    });
    const seeded = readRow(firstMessage.idempotencyKey);
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seedRow({ ...seeded, status: "failed_retryable" });
    const retryClaim = await claimDispatchAttempt({
      db,
      message: buildDispatchMessage({
        idempotencyKey: firstMessage.idempotencyKey,
        dispatchOwner: owner,
      }),
      attempt: 2,
      nowMs: 2000,
    });
    expect(retryClaim).toMatchObject({
      runtimeCoordinatorDecisionRequest: { ownerUserId: "owner-a" },
    });
    expect(readRow(firstMessage.idempotencyKey)).toMatchObject({
      dispatchOwnerId: "owner-a",
      dispatchOwnerKind: "owner_account",
    });
  });

  it("fills missing dispatch owner evidence once from a valid retry message", async () => {
    const { db, readRow, seedRow } = createDispatchLedgerFixture();
    const firstMessage = buildDispatchMessage();

    await claimDispatchAttempt({
      db,
      message: firstMessage,
      attempt: 1,
      nowMs: 1000,
    });

    const seeded = readRow(firstMessage.idempotencyKey);
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seeded.status = "failed_retryable";
    seedRow(seeded);

    const retryClaim = await claimDispatchAttempt({
      db,
      message: buildDispatchMessage({
        dispatchOwner: {
          id: "owner-a",
          kind: "owner_account",
        },
        idempotencyKey: firstMessage.idempotencyKey,
      }),
      attempt: 2,
      nowMs: 2000,
    });

    expect(retryClaim).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        ownerUserId: "owner-a",
        claimDecision: "claim_existing_inside_window",
        eventKind: "retry",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(firstMessage),
      },
      status: "deduped",
    });
    expect(readRow(firstMessage.idempotencyKey)).toMatchObject({
      attemptCount: 1,
      dispatchOwnerId: "owner-a",
      dispatchOwnerKind: "owner_account",
      status: "failed_retryable",
    });
  });

  it.each([
    "runtime_coordinator.head_accept_unavailable",
    "agent_execution.readiness_unconfirmed",
    "working_folder.observation_coverage_invalid",
  ])("rechecks pre-execution admission after %s instead of requiring an existing execution", async (errorCode) => {
    const { db, readAttempt, readRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-head-accept-retry-1",
      sourceEventId: "signal-head-accept-retry-1",
      targetProfileId: "agt-head-accept-retry-1",
    });

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }

    await markDispatchStatus({
      attemptId: first.attemptId,
      attemptStatus: "failed_retryable",
      db,
      errorCode,
      errorMessage:
        "RuntimeCoordinator head accept returned retry_later before execution creation",
      idempotencyKey: message.idempotencyKey,
      nowMs: 1100,
      status: "failed_retryable",
    });

    const retry = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 1200,
    });

    expect(retry).toMatchObject({
      attemptNo: 2,
      status: "claimed",
    });
    if (retry.status !== "claimed") {
      throw new Error("expected retry claim");
    }
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(readRow(message.idempotencyKey)).toMatchObject({
      attemptCount: 2,
      latestAttemptId: retry.attemptId,
      status: "queued",
    });
    expect(readAttempt(first.attemptId)).toMatchObject({
      errorCode,
      status: "failed_retryable",
    });
    expect(readAttempt(retry.attemptId)).toMatchObject({
      status: "dispatching",
    });
  });

  it("retries RuntimeCoordinator head no-execution after a retryable head decision failure instead of deduping", async () => {
    const { db, readAttempt, readRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-head-no-execution-retry-1",
      sourceEventId: "signal-head-no-execution-retry-1",
      targetProfileId: "agt-head-no-execution-retry-1",
    });

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }

    await markDispatchStatus({
      attemptId: first.attemptId,
      attemptStatus: "failed_retryable",
      db,
      errorCode: "runtime_coordinator.head_no_execution_unavailable",
      errorMessage:
        "RuntimeCoordinator head no-execution decision returned retry_later before execution creation",
      idempotencyKey: message.idempotencyKey,
      nowMs: 1100,
      status: "failed_retryable",
    });

    const retry = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 1200,
    });

    expect(retry).toMatchObject({
      attemptNo: 2,
      status: "claimed",
    });
    if (retry.status !== "claimed") {
      throw new Error("expected retry claim");
    }
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(readRow(message.idempotencyKey)).toMatchObject({
      attemptCount: 2,
      latestAttemptId: retry.attemptId,
      status: "queued",
    });
    expect(readAttempt(first.attemptId)).toMatchObject({
      errorCode: "runtime_coordinator.head_no_execution_unavailable",
      status: "failed_retryable",
    });
    expect(readAttempt(retry.attemptId)).toMatchObject({
      status: "dispatching",
    });
  });

  it("dedupes terminal status inside idempotency window", async () => {
    const { db, readRow, seedRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    expect(first).toMatchObject({
      status: "claimed",
      attemptNo: 1,
      replyingHintActive: false,
    });

    const seeded = readRow(message.idempotencyKey);
    expect(seeded).toBeDefined();
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seeded.status = "succeeded";
    seedRow(seeded);

    const second = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 2000,
    });
    expect(second).toEqual({
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)?.status).toBe("succeeded");
  });

  it("dedupes fresh queued status inside idempotency window", async () => {
    const { db, readRow, seedRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    const seeded = readRow(message.idempotencyKey);
    expect(seeded).toBeDefined();
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seeded.status = "queued";
    seeded.lastAttemptAtMs = 1000;
    seeded.replyHintSentAtMs = 1100;
    seedRow(seeded);

    const second = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 2000,
    });
    expect(second).toEqual({
      status: "deduped",
      admissionInFlight: true,
    });
    expect(readRow(message.idempotencyKey)?.status).toBe("queued");
  });

  it("does not let stale queued D1 state reclaim delivery inside idempotency window", async () => {
    const { db, readAttempt, readRow, seedRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    const first = await seedStaleDispatchLedgerClaim({
      db,
      message,
      readRow,
      seedRow,
      status: "queued",
    });

    const reclaimNowMs = 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1;
    const second = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: reclaimNowMs,
    });
    expect(second).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "reclaim_stale_queued",
        eventKind: "reclaim",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });

    expect(readRow(message.idempotencyKey)).toMatchObject({
      status: "queued",
      lastAttemptAtMs: 1000,
      latestAttemptId: first.attemptId,
      replyHintSentAtMs: null,
    });
    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "dispatching",
      errorCode: null,
    });
  });

  it("keeps concurrent stale queued reclaim attempts as RuntimeCoordinator trigger evidence", async () => {
    const { db, readRow, seedRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    await seedStaleDispatchLedgerClaim({
      db,
      message,
      readRow,
      seedRow,
      status: "queued",
    });

    const reclaimNowMs = 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1;
    const [firstClaim, secondClaim] = await Promise.all([
      claimDispatchAttempt({
        db,
        message,
        attempt: 2,
        nowMs: reclaimNowMs,
      }),
      claimDispatchAttempt({
        db,
        message,
        attempt: 3,
        nowMs: reclaimNowMs,
      }),
    ]);

    const claimResults = [firstClaim, secondClaim];
    expect(summarizeConcurrentReclaim(claimResults)).toEqual({
      claimedCount: 0,
      hasDedupedClaim: true,
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      status: "queued",
      lastAttemptAtMs: 1000,
    });
  });

  it("dedupes fresh dispatching status inside idempotency window", async () => {
    const { db, readRow, seedRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    const seeded = readRow(message.idempotencyKey);
    expect(seeded).toBeDefined();
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seeded.status = "dispatching";
    seeded.lastAttemptAtMs = 1000;
    seeded.replyHintSentAtMs = 1100;
    seedRow(seeded);

    const second = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS - 1,
    });
    expect(second).toEqual({
      status: "deduped",
      admissionInFlight: true,
    });
    expect(readRow(message.idempotencyKey)?.status).toBe("dispatching");
  });

  it("records daemon execution evidence while an attempt is still dispatching", async () => {
    const { db, readAttempt } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    const claim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (claim.status !== "claimed") {
      throw new Error("expected first claim");
    }

    await recordDispatchAttemptExecutionOwnership({
      attemptId: claim.attemptId,
      connectionGeneration: 7,
      daemonSessionId: "daemon-session-ownership-1",
      db,
      dispatchId: message.dispatchId,
      executionIdentity: buildExecutionIdentity({
        dispatchId: message.dispatchId,
        targetProfileId: message.targetProfileId,
      }),
      leaseEpoch: 3,
      nowMs: 2000,
      targetProfileId: message.targetProfileId,
      taskId: message.taskId,
    });

    expect(readAttempt(claim.attemptId)).toMatchObject({
      connectionGeneration: 7,
      daemonSessionId: "daemon-session-ownership-1",
      executionBindingId: "binding-1",
      executionAgentControllerRef: "builtin:codex",
      executionIdentityModelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
      executionRuntimeId: "runtime-1",
      leaseEpoch: 3,
      status: "dispatching",
      targetProfileId: message.targetProfileId,
      taskId: message.taskId,
    });
  });

  it("does not overwrite daemon execution evidence after an attempt leaves dispatching", async () => {
    const { db, readAttempt, seedAttemptRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    const claim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (claim.status !== "claimed") {
      throw new Error("expected first claim");
    }
    const attempt = readAttempt(claim.attemptId);
    if (!attempt) {
      throw new Error("expected attempt");
    }
    attempt.status = "waiting_result";
    attempt.daemonSessionId = "daemon-session-existing";
    attempt.connectionGeneration = 2;
    attempt.leaseEpoch = 1;
    seedAttemptRow(attempt);

    await expect(
      recordDispatchAttemptExecutionOwnership({
        attemptId: claim.attemptId,
        connectionGeneration: 7,
        daemonSessionId: "daemon-session-new",
        db,
        dispatchId: message.dispatchId,
        executionIdentity: buildExecutionIdentity({
          dispatchId: message.dispatchId,
          targetProfileId: message.targetProfileId,
        }),
        leaseEpoch: 3,
        nowMs: 2000,
        targetProfileId: message.targetProfileId,
        taskId: message.taskId,
      })
    ).rejects.toThrow(
      "dispatch attempt execution ownership was not recorded before delivery"
    );

    expect(readAttempt(claim.attemptId)).toMatchObject({
      connectionGeneration: 2,
      daemonSessionId: "daemon-session-existing",
      leaseEpoch: 1,
      status: "waiting_result",
    });
  });

  it("treats a waiting_result continuation as a RuntimeCoordinator trigger instead of resuming from D1", async () => {
    const {
      db,
      readOpsDecisions,
      readAttempt,
      readRow,
      seedRow,
      seedAttemptRow,
    } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }

    const seeded = readRow(message.idempotencyKey);
    const seededAttempt = readAttempt(first.attemptId);
    if (!(seeded && seededAttempt)) {
      throw new Error("expected seeded attempt");
    }
    seeded.status = "dispatching";
    seeded.lastAttemptAtMs = 1000;
    seeded.replyHintSentAtMs = 1100;
    seedRow(seeded);
    seededAttempt.status = "waiting_result";
    seededAttempt.daemonSessionId = "daemon-session-1";
    seededAttempt.leaseEpoch = 9;
    seedAttemptRow(seededAttempt);

    const second = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 5000,
    });
    expect(second).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "continue_existing",
        eventKind: "reclaim",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)?.latestAttemptId).toBe(
      first.attemptId
    );
    expect(JSON.stringify(readOpsDecisions())).toContain("continue_existing");
    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "waiting_result",
    });
  });

  it("does not use missing RuntimeCoordinator projection to resume a waiting_result attempt", async () => {
    const {
      db,
      readOpsDecisions,
      readAttempt,
      readRow,
      seedRow,
      seedAttemptRow,
    } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }

    const seeded = readRow(message.idempotencyKey);
    const seededAttempt = readAttempt(first.attemptId);
    if (!(seeded && seededAttempt)) {
      throw new Error("expected seeded attempt");
    }
    seeded.status = "dispatching";
    seeded.lastAttemptAtMs = 1000;
    seedRow(seeded);
    seededAttempt.status = "waiting_result";
    seededAttempt.daemonSessionId = "daemon-session-1";
    seededAttempt.leaseEpoch = 9;
    seedAttemptRow(seededAttempt);

    const second = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 5000,
    });

    expect(second).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "continue_existing",
        eventKind: "reclaim",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)?.latestAttemptId).toBe(
      first.attemptId
    );
    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "waiting_result",
    });
    expect(JSON.stringify(readOpsDecisions())).toContain("continue_existing");
  });

  it("does not treat a RuntimeCoordinator projection as first-Wake intake authority", async () => {
    const { db, readOpsDecisions, readRow, seedRuntimeCoordinatorExecution } =
      createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-runtime-coordinator-existing-1",
      sourceEventId: "evt-runtime-coordinator-existing-1",
      targetProfileId: "agt-runtime-coordinator-existing-1",
    });
    seedRuntimeCoordinatorExecution({
      attemptId: "attempt-existing-1",
      daemonSessionId: "daemon-session-existing-1",
      dispatchId: message.dispatchId,
      leaseEpoch: 1,
      status: "running",
      targetProfileId: message.targetProfileId,
    });

    const claim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });

    expect(claim).toMatchObject({
      attemptNo: 1,
      status: "claimed",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: claim.status === "claimed" ? claim.attemptId : null,
      status: "queued",
    });
    expect(JSON.stringify(readOpsDecisions())).not.toContain(
      "runtime_coordinator.execution_exists_for_claim_new"
    );
  });

  it("treats RuntimeCoordinator reclaim queue messages as trigger-only decisions", async () => {
    const {
      db,
      readOpsDecisions,
      readAttempt,
      readRow,
      seedRuntimeCoordinatorExecution,
      seedRow,
    } = createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-runtime-coordinator-reclaim-1",
      sourceEventId: "evt-runtime-coordinator-reclaim-1",
      targetProfileId: "agt-runtime-coordinator-reclaim-1",
    });

    const first = await seedStaleDispatchLedgerClaim({
      db,
      message,
      readRow,
      seedRow,
      status: "queued",
    });
    seedRuntimeCoordinatorExecution({
      attemptId: first.attemptId,
      daemonSessionId: "daemon-session-1",
      dispatchId: message.dispatchId,
      leaseEpoch: 9,
      status: "running",
      targetProfileId: message.targetProfileId,
    });

    const reclaimNowMs = 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1;
    const reclaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: reclaimNowMs,
    });

    expect(reclaim).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "reclaim_stale_queued",
        eventKind: "reclaim",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: first.attemptId,
      status: "queued",
    });
    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "dispatching",
    });
    const payload = readOpsDecisions().at(-1);
    expect(payload).toMatchObject({
      claimDecision: "reclaim_stale_queued",
      coordinatorDecision: {
        kind: "runtime_coordinator_decision_required",
        queueOrAlarmRole: "trigger_only",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        usesFinalClaimAuthority: false,
        usesLegacyClaimLeaseAuthority: false,
      },
      reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
      runtimeCoordinatorExecutionId:
        buildExpectedRuntimeCoordinatorExecutionId(message),
    });
  });

  it("does not let stale D1 queued state reclaim delivery when RuntimeCoordinator projection is missing", async () => {
    const { db, readOpsDecisions, readAttempt, readRow, seedRow } =
      createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-runtime-coordinator-reclaim-missing-projection-1",
      sourceEventId: "evt-runtime-coordinator-reclaim-missing-projection-1",
      targetProfileId: "agt-runtime-coordinator-reclaim-missing-projection-1",
    });

    const first = await seedStaleDispatchLedgerClaim({
      db,
      message,
      readRow,
      seedRow,
      status: "queued",
    });

    const reclaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1,
    });

    expect(reclaim).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "reclaim_stale_queued",
        eventKind: "reclaim",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
        runtimeCoordinatorStatus: null,
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: first.attemptId,
      status: "queued",
    });
    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "dispatching",
    });
    const payload = readOpsDecisions().at(-1);
    expect(payload).toMatchObject({
      claimDecision: "reclaim_stale_queued",
      reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
      runtimeCoordinatorExecutionId:
        buildExpectedRuntimeCoordinatorExecutionId(message),
      runtimeCoordinatorStatus: null,
    });
  });

  it("treats RuntimeCoordinator retry queue messages as trigger-only decisions", async () => {
    const {
      db,
      readOpsDecisions,
      readAttempt,
      readRow,
      seedRuntimeCoordinatorExecution,
      seedRow,
      seedAttemptRow,
    } = createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-runtime-coordinator-retry-1",
      sourceEventId: "evt-runtime-coordinator-retry-1",
      targetProfileId: "agt-runtime-coordinator-retry-1",
    });

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }
    const ledgerRow = readRow(message.idempotencyKey);
    const attemptRow = readAttempt(first.attemptId);
    if (!(ledgerRow && attemptRow)) {
      throw new Error("expected seeded retry state");
    }
    ledgerRow.status = "failed_retryable";
    seedRow(ledgerRow);
    attemptRow.status = "failed_retryable";
    attemptRow.errorCode = "daemon.session.connection_replaced";
    seedAttemptRow(attemptRow);
    seedRuntimeCoordinatorExecution({
      attemptId: first.attemptId,
      daemonSessionId: "daemon-session-1",
      dispatchId: message.dispatchId,
      leaseEpoch: 9,
      status: "running",
      targetProfileId: message.targetProfileId,
    });

    const retry = await claimDispatchAttempt({
      db,
      message: {
        ...message,
        deliveryRecoveryReason: "connection_replaced",
      },
      attempt: 2,
      nowMs: 2000,
    });

    expect(retry).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "claim_recovery",
        eventKind: "retry",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)?.latestAttemptId).toBe(
      first.attemptId
    );
    const payload = readOpsDecisions().at(-1);
    expect(payload).toMatchObject({
      claimDecision: "claim_recovery",
      coordinatorDecision: {
        coordinatorAction: "decide_retry_timeout_or_reclaim",
        kind: "runtime_coordinator_decision_required",
        queueOrAlarmRole: "trigger_only",
        usesFinalClaimAuthority: false,
        usesLegacyClaimLeaseAuthority: false,
      },
      reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
    });
  });

  it("does not let failed D1 attempt state retry delivery when RuntimeCoordinator projection is missing", async () => {
    const {
      db,
      readOpsDecisions,
      readAttempt,
      readRow,
      seedRow,
      seedAttemptRow,
    } = createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-runtime-coordinator-retry-missing-projection-1",
      sourceEventId: "evt-runtime-coordinator-retry-missing-projection-1",
      targetProfileId: "agt-runtime-coordinator-retry-missing-projection-1",
    });

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }
    const ledgerRow = readRow(message.idempotencyKey);
    const attemptRow = readAttempt(first.attemptId);
    if (!(ledgerRow && attemptRow)) {
      throw new Error("expected seeded retry state");
    }
    ledgerRow.status = "failed_retryable";
    seedRow(ledgerRow);
    attemptRow.status = "failed_retryable";
    attemptRow.errorCode = "daemon.session.connection_replaced";
    seedAttemptRow(attemptRow);

    const retry = await claimDispatchAttempt({
      db,
      message: {
        ...message,
        deliveryRecoveryReason: "connection_replaced",
      },
      attempt: 2,
      nowMs: 2000,
    });

    expect(retry).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "claim_recovery",
        eventKind: "retry",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
        runtimeCoordinatorStatus: null,
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: first.attemptId,
      status: "failed_retryable",
    });
    const payload = readOpsDecisions().at(-1);
    expect(payload).toMatchObject({
      claimDecision: "claim_recovery",
      reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
      runtimeCoordinatorExecutionId:
        buildExpectedRuntimeCoordinatorExecutionId(message),
      runtimeCoordinatorStatus: null,
    });
  });

  it("does not reopen a completed correlated attempt for already_completed duplicate delivery", async () => {
    const { db, readAttempt, readRow, seedAttemptRow, seedRow } =
      createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-already-completed-correlation-1",
      sourceEventId: "evt-already-completed-correlation-1",
      targetProfileId: "agt-already-completed-correlation-1",
    });

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }
    const seededLedger = readRow(message.idempotencyKey);
    const seededAttempt = readAttempt(first.attemptId);
    if (!(seededLedger && seededAttempt)) {
      throw new Error("expected seeded dispatch state");
    }
    seededLedger.status = "failed_retryable";
    seedRow(seededLedger);
    seededAttempt.status = "failed_retryable";
    seedAttemptRow(seededAttempt);

    const duplicateAttemptId = "attempt-already-completed-duplicate-2";
    seedAttemptRow({
      ...seededAttempt,
      attemptId: duplicateAttemptId,
      attemptNo: 2,
      createdAtMs: 2000,
      errorCode: null,
      errorMessage: null,
      finishedAtMs: null,
      startedAtMs: 2000,
      status: "failed_retryable",
    });
    seededLedger.status = "succeeded";
    seededLedger.lastAttemptAtMs = 1500;
    seededLedger.latestAttemptId = duplicateAttemptId;
    seedRow(seededLedger);
    seededAttempt.status = "succeeded";
    seededAttempt.finishedAtMs = 1500;
    seededAttempt.errorCode = null;
    seededAttempt.errorMessage = null;
    seedAttemptRow(seededAttempt);

    await correlateDuplicateDispatchDeliveryAttempt({
      correlatedAttemptId: first.attemptId,
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      db,
      duplicateAttemptId,
      idempotencyKey: message.idempotencyKey,
      leaseEpoch: 1,
      nowMs: 2500,
      reason: "already_completed",
    });

    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "succeeded",
      finishedAtMs: 1500,
      errorCode: null,
    });
    expect(readAttempt(duplicateAttemptId)).toMatchObject({
      status: "superseded",
      errorCode: "dispatch.attempt.already_completed",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      status: "succeeded",
      lastAttemptAtMs: 1500,
    });
  });

  it("keeps already_pending duplicate delivery correlated to the active attempt", async () => {
    const { db, readAttempt, readRow, seedAttemptRow, seedRow } =
      createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-already-pending-correlation-1",
      sourceEventId: "evt-already-pending-correlation-1",
      targetProfileId: "agt-already-pending-correlation-1",
    });

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }
    const ledger = readRow(message.idempotencyKey);
    const firstAttempt = readAttempt(first.attemptId);
    if (!(ledger && firstAttempt)) {
      throw new Error("expected first dispatch state");
    }
    ledger.status = "failed_retryable";
    seedRow(ledger);
    firstAttempt.status = "failed_retryable";
    seedAttemptRow(firstAttempt);

    const duplicateAttemptId = "attempt-already-pending-duplicate-2";
    seedAttemptRow({
      ...firstAttempt,
      attemptId: duplicateAttemptId,
      attemptNo: 2,
      createdAtMs: 2000,
      errorCode: null,
      errorMessage: null,
      finishedAtMs: null,
      startedAtMs: 2000,
      status: "failed_retryable",
    });
    ledger.status = "dispatching";
    ledger.latestAttemptId = duplicateAttemptId;
    seedRow(ledger);
    firstAttempt.status = "waiting_result";
    firstAttempt.finishedAtMs = null;
    seedAttemptRow(firstAttempt);

    await correlateDuplicateDispatchDeliveryAttempt({
      correlatedAttemptId: first.attemptId,
      connectionGeneration: 4,
      daemonSessionId: "daemon-session-4",
      db,
      duplicateAttemptId,
      idempotencyKey: message.idempotencyKey,
      leaseEpoch: 9,
      nowMs: 2500,
      reason: "already_pending",
    });

    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "waiting_result",
      daemonSessionId: "daemon-session-4",
      connectionGeneration: 4,
      leaseEpoch: 9,
      finishedAtMs: null,
    });
    expect(readAttempt(duplicateAttemptId)).toMatchObject({
      status: "superseded",
      errorCode: "dispatch.attempt.already_pending",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      status: "dispatching",
      latestAttemptId: first.attemptId,
    });
  });

  it("does not let stale dispatching D1 state reclaim delivery inside idempotency window", async () => {
    const { db, readAttempt, readRow, seedRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    const first = await seedStaleDispatchLedgerClaim({
      db,
      message,
      readRow,
      seedRow,
      status: "dispatching",
    });

    const reclaimNowMs = 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1;
    const second = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: reclaimNowMs,
    });
    expect(second).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "reclaim_stale_dispatching",
        eventKind: "reclaim",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      status: "dispatching",
      lastAttemptAtMs: 1000,
      latestAttemptId: first.attemptId,
    });
    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "dispatching",
      errorCode: null,
    });
  });

  it("keeps stale dispatching threshold boundary as RuntimeCoordinator trigger evidence", async () => {
    const { db, readAttempt, readRow, seedRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }
    const seeded = readRow(message.idempotencyKey);
    expect(seeded).toBeDefined();
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seeded.status = "dispatching";
    seeded.lastAttemptAtMs = 1000;
    seedRow(seeded);

    const boundaryNowMs = 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS;
    const claim = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: boundaryNowMs,
    });
    expect(claim).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "reclaim_stale_dispatching",
        eventKind: "reclaim",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      status: "dispatching",
      lastAttemptAtMs: 1000,
      latestAttemptId: first.attemptId,
    });
    expect(readAttempt(first.attemptId)?.status).toBe("dispatching");
  });

  it("keeps concurrent stale dispatching reclaim attempts as RuntimeCoordinator trigger evidence", async () => {
    const { db, readRow, seedRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    await seedStaleDispatchLedgerClaim({
      db,
      message,
      readRow,
      seedRow,
      status: "dispatching",
    });

    const reclaimNowMs = 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1;
    const [firstClaim, secondClaim] = await Promise.all([
      claimDispatchAttempt({
        db,
        message,
        attempt: 2,
        nowMs: reclaimNowMs,
      }),
      claimDispatchAttempt({
        db,
        message,
        attempt: 3,
        nowMs: reclaimNowMs,
      }),
    ]);

    const claimResults = [firstClaim, secondClaim];
    expect(summarizeConcurrentReclaim(claimResults)).toEqual({
      claimedCount: 0,
      hasDedupedClaim: true,
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      status: "dispatching",
      lastAttemptAtMs: 1000,
    });
  });

  it("keeps retryable in-window dispatches as RuntimeCoordinator trigger evidence", async () => {
    const { db, readAttempt, readRow, seedRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    const firstClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (firstClaim.status !== "claimed") {
      throw new Error("expected first claim to be claimed");
    }

    const seeded = readRow(message.idempotencyKey);
    expect(seeded).toBeDefined();
    if (!seeded) {
      throw new Error("expected seeded row");
    }
    seeded.status = "failed_retryable";
    seeded.replyHintSentAtMs = 1100;
    seedRow(seeded);

    const retryClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 2000,
    });
    expect(retryClaim).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "claim_existing_inside_window",
        eventKind: "retry",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
        runtimeCoordinatorStatus: null,
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: firstClaim.attemptId,
      status: "failed_retryable",
      replyHintSentAtMs: 1100,
    });
    expect(readAttempt("attempt-2")).toBeUndefined();
  });

  it.each([
    ["daemon.profile.offline", 2000],
    ["runtime_coordinator.device_waiting", 2000],
    [
      "runtime_coordinator.device_waiting",
      DISPATCH_IDEMPOTENCY_WINDOW_MS + 2000,
    ],
  ] as const)("allows route_lost redrive to re-enter pre-execution waiting delivery for %s at %i", async (errorCode, recoveryAtMs) => {
    const { db, readAttempt, readRow, seedRow, seedAttemptRow } =
      createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-offline-waiting-redrive-1",
      sourceEventId: "evt-offline-waiting-redrive-1",
      targetProfileId: "agt-offline-waiting-redrive-1",
    });
    message.deviceWait = {
      bindingId: "binding-waiting",
      openMeldServiceRuntimeId: "runtime-waiting",
      targetProfileId: message.targetProfileId,
      deadlineAtMs: 604_801_000,
    };

    const firstClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (firstClaim.status !== "claimed") {
      throw new Error("expected first claim to be claimed");
    }

    const seeded = readRow(message.idempotencyKey);
    const firstAttempt = readAttempt(firstClaim.attemptId);
    if (!(seeded && firstAttempt)) {
      throw new Error("expected seeded offline waiting state");
    }
    seeded.status = "failed_retryable";
    seedRow(seeded);
    firstAttempt.status = "failed_retryable";
    firstAttempt.errorCode = errorCode;
    seedAttemptRow(firstAttempt);

    if (errorCode === "runtime_coordinator.device_waiting") {
      const duplicate = await claimDispatchAttempt({
        db,
        message,
        attempt: 2,
        nowMs: 1500,
      });
      expect(duplicate.status).toBe("deduped");
      expect(readRow(message.idempotencyKey)?.latestAttemptId).toBe(
        firstClaim.attemptId
      );
    }

    const redriveClaim = await claimDispatchAttempt({
      db,
      message: {
        ...message,
        deliveryRecoveryReason: "route_lost",
      },
      attempt: 2,
      nowMs: recoveryAtMs,
    });

    expect(redriveClaim).toMatchObject({
      attemptNo: recoveryAtMs > DISPATCH_IDEMPOTENCY_WINDOW_MS ? 1 : 2,
      deliveryRecoveryReason: "route_lost",
      status: "claimed",
    });
    if (redriveClaim.status !== "claimed") {
      throw new Error("expected redrive claim to create a new attempt");
    }
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: redriveClaim.attemptId,
      status: "queued",
    });
    expect(readAttempt(redriveClaim.attemptId)).toMatchObject({
      status: "dispatching",
    });
  });

  it("supersedes the queue-wait attempt when coordinator promotion claims fresh delivery", async () => {
    const { db, readAttempt, readRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-profile-queue-promotion-1",
      sourceEventId: "evt-profile-queue-promotion-1",
      targetProfileId: "agt-profile-queue-promotion-1",
    });
    const firstClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (firstClaim.status !== "claimed") {
      throw new Error("expected first claim to be claimed");
    }
    await markDispatchStatus({
      attemptId: firstClaim.attemptId,
      attemptStatus: "profile_queue_waiting",
      db,
      errorCode: "agent_profile_work_coordinator.queued",
      errorMessage: "waiting behind the active profile Wake",
      idempotencyKey: message.idempotencyKey,
      nowMs: 1100,
      status: "queued",
    });

    const promotedClaim = await claimDispatchAttempt({
      db,
      message: {
        ...message,
        deliveryRecoveryReason: "agent_profile_work_coordinator_promoted",
      },
      attempt: 2,
      nowMs: 2000,
    });

    expect(promotedClaim).toMatchObject({
      attemptNo: 2,
      deliveryRecoveryReason: "agent_profile_work_coordinator_promoted",
      status: "claimed",
    });
    if (promotedClaim.status !== "claimed") {
      throw new Error("expected promotion to create a new attempt");
    }
    expect(readRow(message.idempotencyKey)).toMatchObject({
      attemptCount: 2,
      latestAttemptId: promotedClaim.attemptId,
      status: "queued",
    });
    expect(readAttempt(firstClaim.attemptId)).toMatchObject({
      errorCode: "agent_profile_work_coordinator.promoted",
      status: "superseded",
    });
    expect(readAttempt(promotedClaim.attemptId)).toMatchObject({
      status: "dispatching",
    });
  });

  it("rolls back an existing ledger update when its replacement attempt insert fails", async () => {
    const {
      db,
      injectAttemptInsertFailure,
      clearAttemptInsertFailure,
      readAttempt,
      readRow,
      seedRow,
      seedAttemptRow,
    } = createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-atomic-redrive-1",
      sourceEventId: "evt-atomic-redrive-1",
      targetProfileId: "agt-atomic-redrive-1",
    });

    const firstClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (firstClaim.status !== "claimed") {
      throw new Error("expected first claim to be claimed");
    }
    const seeded = readRow(message.idempotencyKey);
    const firstAttempt = readAttempt(firstClaim.attemptId);
    if (!(seeded && firstAttempt)) {
      throw new Error("expected seeded offline waiting state");
    }
    seeded.status = "failed_retryable";
    seedRow(seeded);
    firstAttempt.status = "failed_retryable";
    firstAttempt.errorCode = "daemon.profile.offline";
    seedAttemptRow(firstAttempt);
    injectAttemptInsertFailure();

    await expect(
      claimDispatchAttempt({
        db,
        message: {
          ...message,
          deliveryRecoveryReason: "route_lost",
        },
        attempt: 2,
        nowMs: 2000,
      })
    ).rejects.toThrow("injected dispatch attempt insert failure");
    clearAttemptInsertFailure();

    expect(readRow(message.idempotencyKey)).toMatchObject({
      attemptCount: 1,
      lastAttemptAtMs: 1000,
      latestAttemptId: firstClaim.attemptId,
      status: "failed_retryable",
    });
    await expect(
      claimDispatchAttempt({
        db,
        message: {
          ...message,
          deliveryRecoveryReason: "route_lost",
        },
        attempt: 3,
        nowMs: 2100,
      })
    ).resolves.toMatchObject({
      attemptNo: 2,
      status: "claimed",
    });
  });

  it("allows Queue retry to re-enter pre-execution waiting delivery as fallback trigger", async () => {
    const { db, readAttempt, readRow, seedRow, seedAttemptRow } =
      createDispatchLedgerFixture();
    const message = buildDispatchMessage({
      dispatchId: "dispatch-offline-waiting-queue-retry-1",
      sourceEventId: "evt-offline-waiting-queue-retry-1",
      targetProfileId: "agt-offline-waiting-queue-retry-1",
    });

    const firstClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (firstClaim.status !== "claimed") {
      throw new Error("expected first claim to be claimed");
    }

    const seeded = readRow(message.idempotencyKey);
    const firstAttempt = readAttempt(firstClaim.attemptId);
    if (!(seeded && firstAttempt)) {
      throw new Error("expected seeded offline waiting state");
    }
    seeded.status = "failed_retryable";
    seedRow(seeded);
    firstAttempt.status = "failed_retryable";
    firstAttempt.errorCode = "daemon.profile.offline";
    seedAttemptRow(firstAttempt);

    const retryClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 2000,
    });

    expect(retryClaim).toMatchObject({
      attemptNo: 2,
      status: "claimed",
    });
    if (retryClaim.status !== "claimed") {
      throw new Error("expected Queue retry to create a new attempt");
    }
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: retryClaim.attemptId,
      status: "queued",
    });
    expect(readAttempt(retryClaim.attemptId)).toMatchObject({
      status: "dispatching",
    });
  });

  it("keeps connection_replaced retry as RuntimeCoordinator trigger evidence", async () => {
    const { db, readAttempt, readRow, seedRow, seedAttemptRow } =
      createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    const firstClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });

    if (firstClaim.status !== "claimed") {
      throw new Error("expected the initial claim to succeed");
    }

    const ledgerRow = readRow(message.idempotencyKey);
    if (!ledgerRow) {
      throw new Error("expected a seeded ledger row");
    }
    ledgerRow.status = "failed_retryable";
    seedRow(ledgerRow);

    const attemptRow = readAttempt(firstClaim.attemptId);
    if (!attemptRow) {
      throw new Error("expected a seeded attempt row");
    }
    attemptRow.status = "failed_retryable";
    attemptRow.errorCode = "daemon.session.connection_replaced";
    seedAttemptRow(attemptRow);

    const retryClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 2000,
    });

    expect(retryClaim).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "claim_recovery",
        eventKind: "retry",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      latestAttemptId: firstClaim.attemptId,
      status: "failed_retryable",
    });
  });

  it("keeps watchdog recovery redrive as RuntimeCoordinator trigger evidence", async () => {
    const { db, readRow, seedRow } = createDispatchLedgerFixture();
    const message = {
      ...buildDispatchMessage(),
      deliveryRecoveryReason: "connection_replaced" as const,
    };

    const firstClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (firstClaim.status !== "claimed") {
      throw new Error("expected the initial claim to succeed");
    }

    const ledgerRow = readRow(message.idempotencyKey);
    if (!ledgerRow) {
      throw new Error("expected a seeded ledger row");
    }
    ledgerRow.status = "queued";
    ledgerRow.lastAttemptAtMs = 1500;
    ledgerRow.replyHintSentAtMs = 1600;
    seedRow(ledgerRow);

    const recoveryClaim = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 2000,
    });

    expect(recoveryClaim).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "claim_recovery",
        eventKind: "retry",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)?.latestAttemptId).toBe(
      firstClaim.attemptId
    );
    expect(readRow(message.idempotencyKey)?.replyHintSentAtMs).toBe(1600);
  });

  it("keeps reset_existing outside the idempotency window as RuntimeCoordinator trigger evidence", async () => {
    const { db, readOpsDecisions, readAttempt, readRow } =
      createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    const first = await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    if (first.status !== "claimed") {
      throw new Error("expected first claim");
    }

    const beyondWindowMs = 1000 + DISPATCH_IDEMPOTENCY_WINDOW_MS + 1;
    const reset = await claimDispatchAttempt({
      db,
      message,
      attempt: 3,
      nowMs: beyondWindowMs,
    });
    expect(reset).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "reset_existing",
        eventKind: "reclaim",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
        runtimeCoordinatorStatus: null,
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)).toMatchObject({
      firstSeenAtMs: 1000,
      latestAttemptId: first.attemptId,
      status: "queued",
    });
    expect(readAttempt(first.attemptId)).toMatchObject({
      status: "dispatching",
    });
    const payload = readOpsDecisions().at(-1);
    expect(payload).toMatchObject({
      claimDecision: "reset_existing",
      reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
      runtimeCoordinatorExecutionId:
        buildExpectedRuntimeCoordinatorExecutionId(message),
      runtimeCoordinatorStatus: null,
    });
  });
});

describe("claimFinalReplyEmission", () => {
  it("claims final reply persistence only once per idempotency key", async () => {
    const { db, readRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });

    await expect(
      claimFinalReplyEmission({
        db,
        idempotencyKey: message.idempotencyKey,
        nowMs: 2000,
      })
    ).resolves.toBe("claimed");

    expect(readRow(message.idempotencyKey)?.finalReplySentAtMs).toBe(2000);

    await expect(
      claimFinalReplyEmission({
        db,
        idempotencyKey: message.idempotencyKey,
        nowMs: 3000,
      })
    ).resolves.toBe("already_claimed");
  });

  it("rolls back a final reply claim when persistence fails", async () => {
    const { db, readRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });

    await expect(
      claimFinalReplyEmission({
        db,
        idempotencyKey: message.idempotencyKey,
        nowMs: 2000,
      })
    ).resolves.toBe("claimed");
    expect(readRow(message.idempotencyKey)?.finalReplySentAtMs).toBe(2000);

    await rollbackFinalReplyEmissionClaim({
      db,
      idempotencyKey: message.idempotencyKey,
      claimedAtMs: 2000,
    });

    expect(readRow(message.idempotencyKey)?.finalReplySentAtMs).toBeNull();
  });
});

describe("replying hint claim", () => {
  it("claims once and rolls back only with matching timestamp", async () => {
    const { db, readRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });

    const firstClaim = await claimReplyingHintEmission({
      db,
      idempotencyKey: message.idempotencyKey,
      nowMs: 1100,
    });
    expect(firstClaim).toBe("claimed");
    expect(readRow(message.idempotencyKey)?.replyHintSentAtMs).toBe(1100);

    const secondClaim = await claimReplyingHintEmission({
      db,
      idempotencyKey: message.idempotencyKey,
      nowMs: 1200,
    });
    expect(secondClaim).toBe("already_claimed");
    expect(readRow(message.idempotencyKey)?.replyHintSentAtMs).toBe(1100);

    await rollbackReplyingHintEmissionClaim({
      db,
      idempotencyKey: message.idempotencyKey,
      claimedAtMs: 9999,
    });
    expect(readRow(message.idempotencyKey)?.replyHintSentAtMs).toBe(1100);

    await rollbackReplyingHintEmissionClaim({
      db,
      idempotencyKey: message.idempotencyKey,
      claimedAtMs: 1100,
    });
    expect(readRow(message.idempotencyKey)?.replyHintSentAtMs).toBeNull();
  });

  it("does not clear reply hint state from D1 reset_existing intake", async () => {
    const { db, readRow } = createDispatchLedgerFixture();
    const message = buildDispatchMessage();

    await claimDispatchAttempt({
      db,
      message,
      attempt: 1,
      nowMs: 1000,
    });
    await claimReplyingHintEmission({
      db,
      idempotencyKey: message.idempotencyKey,
      nowMs: 1100,
    });
    expect(readRow(message.idempotencyKey)?.replyHintSentAtMs).toBe(1100);

    const reset = await claimDispatchAttempt({
      db,
      message,
      attempt: 2,
      nowMs: 1000 + DISPATCH_IDEMPOTENCY_WINDOW_MS + 1,
    });

    expect(reset).toMatchObject({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "reset_existing",
        eventKind: "reclaim",
        runtimeCoordinatorExecutionId:
          buildExpectedRuntimeCoordinatorExecutionId(message),
      },
      status: "deduped",
    });
    expect(readRow(message.idempotencyKey)?.replyHintSentAtMs).toBe(1100);
  });

  it("returns missing_ledger_row when no ledger row exists", async () => {
    const { db } = createDispatchLedgerFixture();
    const claim = await claimReplyingHintEmission({
      db,
      idempotencyKey: "5:evt-missing|5:agt-missing",
      nowMs: 1100,
    });
    expect(claim).toBe("missing_ledger_row");
  });
});

describe("readDeliveryStabilityDispatchMetrics", () => {
  it("aggregates delivery stability metrics with explicit window and timeout thresholds", async () => {
    const { db, seedDlqRow, seedRow } = createDispatchLedgerFixture();
    const baseTs = 1_000_000;

    seedRow({
      idempotencyKey: "5:evt-1|5:agt-1",
      dispatchId: "dispatch-1",
      spaceId: "space-1",
      sourceEventId: "evt-1",
      sourceClientMessageId: null,
      targetProfileId: "agt-1",
      status: "failed_terminal",
      firstSeenAtMs: baseTs - 45_000,
      lastAttemptAtMs: baseTs - 40_000,
      attemptCount: 1,
      latestAttemptId: null,
      replyHintSentAtMs: null,
      finalReplySentAtMs: null,
    });
    seedRow({
      idempotencyKey: "5:evt-2|5:agt-2",
      dispatchId: "dispatch-2",
      spaceId: "space-1",
      sourceEventId: "evt-2",
      sourceClientMessageId: null,
      targetProfileId: "agt-2",
      status: "succeeded",
      firstSeenAtMs: baseTs - 20_000,
      lastAttemptAtMs: baseTs - 10_000,
      attemptCount: 1,
      latestAttemptId: null,
      replyHintSentAtMs: null,
      finalReplySentAtMs: null,
    });
    seedRow({
      idempotencyKey: "5:evt-3|5:agt-3",
      dispatchId: "dispatch-3",
      spaceId: "space-1",
      sourceEventId: "evt-3",
      sourceClientMessageId: null,
      targetProfileId: "agt-3",
      status: "failed_retryable",
      firstSeenAtMs: baseTs - 8000,
      lastAttemptAtMs: baseTs - 8000,
      attemptCount: 2,
      latestAttemptId: null,
      replyHintSentAtMs: null,
      finalReplySentAtMs: null,
    });
    seedRow({
      idempotencyKey: "5:evt-4|5:agt-4",
      dispatchId: "dispatch-4",
      spaceId: "space-1",
      sourceEventId: "evt-4",
      sourceClientMessageId: null,
      targetProfileId: "agt-4",
      status: "deduped",
      firstSeenAtMs: baseTs - 5000,
      lastAttemptAtMs: baseTs - 5000,
      attemptCount: 1,
      latestAttemptId: null,
      replyHintSentAtMs: null,
      finalReplySentAtMs: null,
    });
    seedRow({
      idempotencyKey: "5:evt-5|5:agt-5",
      dispatchId: "dispatch-5",
      spaceId: "space-1",
      sourceEventId: "evt-5",
      sourceClientMessageId: null,
      targetProfileId: "agt-5",
      status: "dispatching",
      firstSeenAtMs: baseTs - 3000,
      lastAttemptAtMs: baseTs - 6000,
      attemptCount: 3,
      latestAttemptId: null,
      replyHintSentAtMs: null,
      finalReplySentAtMs: null,
    });

    seedDlqRow({
      dispatchId: "dispatch-1",
      idempotencyKey: "5:evt-1|5:agt-1",
      sourceEventId: "evt-1",
      targetProfileId: "agt-1",
      errorCode: "daemon.delivery.timeout",
      failedAtMs: baseTs - 1000,
    });
    seedDlqRow({
      dispatchId: "dispatch-2",
      idempotencyKey: "5:evt-2|5:agt-2",
      sourceEventId: "evt-2",
      targetProfileId: "agt-2",
      errorCode: "permission.denied.runtime",
      failedAtMs: baseTs - 1000,
    });

    const metrics = await readDeliveryStabilityDispatchMetrics({
      db,
      nowMs: baseTs,
      observeWindowMs: 60_000,
      dispatchingTimeoutMs: 5000,
    });
    expect(metrics.failedTerminalCount).toBe(1);
    expect(metrics.coldStartTimeoutCount).toBe(1);
    expect(metrics.dispatchingTimeoutCount).toBe(1);
    expect(metrics.dedupedCount).toBe(1);
    expect(metrics.failedTerminalRate).toBeCloseTo(1 / 3);
    expect(metrics.coldStartTimeoutRate).toBeCloseTo(1 / 3);
    expect(metrics.dedupedRatio).toBeCloseTo(1 / 4);
  });

  it("falls back to zero rates when no recent data exists", async () => {
    const { db } = createDispatchLedgerFixture();
    const metrics = await readDeliveryStabilityDispatchMetrics({
      db,
      nowMs: 1000,
      observeWindowMs: 60_000,
      dispatchingTimeoutMs: 5000,
    });

    expect(metrics).toEqual({
      failedTerminalCount: 0,
      failedTerminalRate: 0,
      coldStartTimeoutCount: 0,
      coldStartTimeoutRate: 0,
      dispatchingTimeoutCount: 0,
      dedupedCount: 0,
      dedupedRatio: 0,
    });
  });
});
