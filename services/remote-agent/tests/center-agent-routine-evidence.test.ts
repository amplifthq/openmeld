import {
  centerAgentListRoutineRunsToolResponseSchema,
  centerAgentReadRoutineRunDiagnosticsResponseSchema,
} from "@openmeld/schemas";
import type {
  RemoteAgentTurnRuntimeEvidence,
  RemoteAgentWorkerRuntimeDiagnosticsResponse,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  handoffRoutineRunNativeDelivery,
  markRemoteAgentNativeDeliveryAck,
  persistRemoteAgentWorkerSubmitRequest,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../../core/src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { rpcCenterAgentListRoutines } from "../../core/src/routines/routine-center-agent-rpc";
import {
  rpcCenterAgentListRoutineRuns,
  rpcCenterAgentReadRoutineRunDiagnostics,
} from "../../core/src/routines/routine-evidence-rpc";
import { applyDrizzleMigrationsForTables } from "../../core/tests-node/helpers/sqlite-d1-harness.test-support";
import type { RemoteAgentCoreWorkerBinding } from "../agent-core/callback-context";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import {
  createEvidenceFixture,
  EVIDENCE_OTHER_SPACE_ID,
  EVIDENCE_SPACE_ID,
} from "./center-agent-evidence.test-support";
import { executeEvidenceCodeMode } from "./evidence-code-mode.test-support";
import {
  createRoutineTurnEnvelope,
  createSubmitTurnRequest,
  TEST_NOW_MS,
} from "./fixtures";

const fixtures: Awaited<ReturnType<typeof createEvidenceFixture>>[] = [];
const PRIVATE_TEXT = "Private financial decision; do not expose this content";
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.harness.close();
  }
});

async function fixture() {
  const f = await createEvidenceFixture();
  fixtures.push(f);
  applyDrizzleMigrationsForTables(f.harness, ["routines", "routine_runs"]);
  f.harness.run({
    sql: `INSERT INTO routines (
      id, organization_id, name, instructions, schedule_kind, cron_expression, timezone,
      target_space_id, status, next_due_at, created_by_user_id, updated_by_user_id, created_at_ms, updated_at_ms
    ) VALUES ('routine-1', ?, 'Daily report', ?, 'cron', '0 9 * * *', 'UTC', ?, 'paused', NULL, ?, ?, ?, ?)`,
    params: [
      f.request.organizationId,
      PRIVATE_TEXT,
      EVIDENCE_OTHER_SPACE_ID,
      f.speaker.ownerUserId,
      f.speaker.ownerUserId,
      TEST_NOW_MS,
      TEST_NOW_MS,
    ],
  });
  for (const [id, offset, status] of [
    ["old-run", 0, "submitted"],
    ["middle-run", 1000, "skipped"],
    ["latest-run", 2000, "failed"],
  ] as const) {
    f.harness.run({
      sql: `INSERT INTO routine_runs (
        id, routine_id, organization_id, scheduled_for, status, failure_code, failure_detail,
        target_space_id_snapshot, destination_kind_snapshot, routine_name_snapshot,
        execution_engine, started_at_ms
      ) VALUES (?, 'routine-1', ?, ?, ?, ?, ?, ?, 'space', 'Original report', 'workflow', ?)`,
      params: [
        id,
        f.request.organizationId,
        TEST_NOW_MS + offset,
        status,
        status === "failed" ? "empty_assistant_response" : null,
        PRIVATE_TEXT,
        EVIDENCE_SPACE_ID,
        TEST_NOW_MS,
      ],
    });
  }
  const binding: RemoteAgentCoreWorkerBinding = {
    centerAgentListRoutineRuns: (input) =>
      rpcCenterAgentListRoutineRuns(f.env, input),
    centerAgentReadRoutineRunDiagnostics: (input) =>
      rpcCenterAgentReadRoutineRunDiagnostics(f.env, input),
    centerAgentListRoutines: (input) =>
      rpcCenterAgentListRoutines(f.env, input),
  };
  async function read(runId = "old-run") {
    return centerAgentReadRoutineRunDiagnosticsResponseSchema.parse(
      await f.execute(binding, "openmeld_read_routine_run_diagnostics", {
        runId,
      })
    );
  }
  return { ...f, binding, read };
}

async function delivery(
  f: Awaited<ReturnType<typeof fixture>>,
  deliveryId: string,
  offset: number
) {
  const envelope = createRoutineTurnEnvelope({
    routineId: "routine-1",
    runId: "old-run",
    destination: { kind: "space", spaceId: EVIDENCE_SPACE_ID },
  });
  const request = createSubmitTurnRequest({
    ...f.request,
    conversationId: "old-run",
    dispatchId: `${deliveryId}-dispatch`,
    idempotencyKey: `${deliveryId}-key`,
    triggerMessageId: `${deliveryId}-trigger`,
    turnEnvelope: {
      ...envelope,
      space: { ...envelope.space, id: EVIDENCE_SPACE_ID },
    },
  });
  await upsertRemoteAgentNativeDeliveryRecord({
    db: f.harness.db,
    deliveryId,
    nowMs: TEST_NOW_MS + offset,
    organizationId: request.organizationId,
    spaceId: request.spaceId,
    profileId: request.agentProfileId,
    bindingId: request.bindingId,
    triggerMessageId: request.triggerMessageId,
    triggerText: PRIVATE_TEXT,
    routineRunId: "old-run",
    dispatchId: request.dispatchId,
    attemptId: null,
    idempotencyKey: request.idempotencyKey,
    status: "submitted",
    onBehalfOfProfileId: f.speaker.profileId,
    onBehalfOfUserId: f.speaker.ownerUserId,
  });
  await persistRemoteAgentWorkerSubmitRequest({
    db: f.harness.db,
    idempotencyKey: request.idempotencyKey,
    nowMs: TEST_NOW_MS + offset,
    workerSubmitRequest: request,
  });
  await markRemoteAgentNativeDeliveryAck({
    db: f.harness.db,
    idempotencyKey: request.idempotencyKey,
    nowMs: TEST_NOW_MS + offset,
    accepted: true,
    submissionId: `${deliveryId}-submission`,
  });
}

function runtimeEvidence(
  submissionId: string,
  toolCallCount: number
): RemoteAgentTurnRuntimeEvidence {
  return {
    budgetExhaustedAtMs: null,
    capabilityDescribeCount: 1,
    capabilitySearchCount: 1,
    codeModeToolCallCount: toolCallCount,
    directToolCallCount: 0,
    firstAssistantTextAtMs: TEST_NOW_MS + 100,
    firstModelEventAtMs: TEST_NOW_MS + 50,
    firstProviderRequestPreparedAtMs: TEST_NOW_MS + 20,
    firstProviderResponseHeadersAtMs: TEST_NOW_MS + 30,
    firstVisibleContentAtMs: TEST_NOW_MS + 100,
    lastModelCompletedAtMs: TEST_NOW_MS + 200,
    modelCallCount: 2,
    modelId: "test-model",
    providerAvailableToolCount: 10,
    providerDeferredToolCount: 8,
    providerExposedToolCount: 2,
    providerRequestCount: 2,
    recentCapabilityDiscovery: [],
    recentProviderRequests: [],
    recentToolCalls: [
      {
        calledAtMs: TEST_NOW_MS + 50,
        source: "code_mode",
        toolName: PRIVATE_TEXT,
      },
    ],
    submissionId,
    toolCallCount,
    toolCallLimit: 64,
    updatedAtMs: TEST_NOW_MS + 200,
  };
}

function runtimeResponse(
  evidence: RemoteAgentTurnRuntimeEvidence[]
): RemoteAgentWorkerRuntimeDiagnosticsResponse {
  return {
    activeRuns: [],
    attemptMarkers: [],
    callbackContexts: [],
    collectedAt: new Date(TEST_NOW_MS + 300).toISOString(),
    durableObjectAlarmAtMs: null,
    fibers: [],
    schedules: [],
    spaceId: EVIDENCE_SPACE_ID,
    submissions: [],
    turnObservability: evidence,
    v: 1,
  };
}

describe("Routine evidence through normal member tools", () => {
  it("selects an older Run from real paged history and preserves history after definition deletion", async () => {
    const f = await fixture();
    const firstOutput = await executeEvidenceCodeMode({
      fixture: f,
      binding: f.binding,
      toolName: "openmeld_list_routine_runs",
      payload: { routineId: "routine-1", limit: 2 },
    });
    const first = centerAgentListRoutineRunsToolResponseSchema.parse(
      (firstOutput as { result: unknown }).result
    );
    expect(first.runs.map((run) => run.id)).toEqual([
      "latest-run",
      "middle-run",
    ]);
    expect(first.nextBeforeScheduledFor).toBe(TEST_NOW_MS + 1000);
    const older = centerAgentListRoutineRunsToolResponseSchema.parse(
      await f.execute(f.binding, "openmeld_list_routine_runs", {
        routineId: "routine-1",
        limit: 2,
        beforeScheduledFor: first.nextBeforeScheduledFor,
      })
    );
    expect(older.runs.map((run) => run.id)).toEqual(["old-run"]);
    expect(older.nextBeforeScheduledFor).toBeNull();
    const prior = await f.read();
    expect(prior.run.destination).toEqual({
      kind: "space",
      coverage: "available",
      spaceId: EVIDENCE_SPACE_ID,
    });
    expect(prior.run.scheduledFor).toBe(TEST_NOW_MS);
    expect(prior.run.status).toBe("submitted"); // today's definition is paused
    const legacy = await rpcCenterAgentListRoutines(f.env, {
      context: buildRemoteAgentCoreContext(
        f.callbackContext,
        "legacy-last-run"
      ),
      speakerMember: { memberId: f.speaker.id, userId: f.speaker.ownerUserId },
    });
    expect(legacy.routines[0]?.lastRun?.id).toBe("latest-run");
    f.harness.run({ sql: "DELETE FROM routines WHERE id = 'routine-1'" });
    expect((await f.read()).run).toEqual(prior.run);
    expect(JSON.stringify(prior)).not.toContain(PRIVATE_TEXT);
    expect(JSON.stringify(prior)).not.toContain(EVIDENCE_OTHER_SPACE_ID);
  });

  it("uses the persisted continuation owner and keeps runtime, generation and publication separate", async () => {
    const f = await fixture();
    await delivery(f, "first-delivery", 0);
    await delivery(f, "continuation-delivery", 500);
    f.harness.run({
      sql: "UPDATE routine_runs SET native_delivery_id = 'first-delivery', continuation_delegation_id = 'delegation-1' WHERE id = 'old-run'",
    });
    f.harness.run({
      sql: "UPDATE openMeldRemoteAgent_native_delivery_ledger SET status = 'completed', completed_at_ms = ?, failure_detail = ? WHERE delivery_id = 'first-delivery'",
      params: [TEST_NOW_MS + 250, PRIVATE_TEXT],
    });
    await handoffRoutineRunNativeDelivery({
      db: f.harness.db,
      organizationId: f.request.organizationId,
      runId: "old-run",
      previousDeliveryId: "first-delivery",
      nextDeliveryId: "continuation-delivery",
    });
    const runtimeReads: unknown[] = [];
    Reflect.set(f.env, "OPENMELD_REMOTE_AGENT_WORKER", {
      readRuntimeDiagnostics: (input: unknown) => {
        runtimeReads.push(input);
        return Promise.resolve(
          runtimeResponse([
            runtimeEvidence("first-delivery-submission", 3),
            runtimeEvidence("continuation-delivery-submission", 7),
          ])
        );
      },
    });
    const before = f.harness.queryAll({
      sql: "SELECT * FROM routine_runs ORDER BY id",
    });
    const output = await executeEvidenceCodeMode({
      fixture: f,
      binding: f.binding,
      toolName: "openmeld_read_routine_run_diagnostics",
      payload: { runId: "old-run" },
    });
    const result = centerAgentReadRoutineRunDiagnosticsResponseSchema.parse(
      (output as { result: unknown }).result
    );
    expect(result.nativeDelivery.coverage).toBe("available");
    expect(result.nativeDelivery.currentResultOwnerId).toBe(
      "continuation-delivery"
    );
    expect(result.nativeDelivery.currentResultOwnerRecorded).toBe(true);
    expect(result.nativeDelivery.deliveries[0]).toMatchObject({
      deliveryId: "continuation-delivery",
      isCurrentResultOwner: true,
      status: "accepted",
      runtimeEvidenceStatus: "available",
      runtimeEvidence: { toolCallCount: 7 },
      publicationState: null,
    });
    expect(result.nativeDelivery.deliveries[1]?.status).toBe("completed");
    expect(result.run.status).toBe("submitted");
    expect(result.run.publication.status).toBe("not_recorded");
    expect(runtimeReads).toEqual([
      { runtimeConversationId: "old-run", spaceId: EVIDENCE_SPACE_ID },
    ]);
    expect(JSON.stringify(output)).not.toContain(PRIVATE_TEXT);
    expect(
      f.harness.queryAll({ sql: "SELECT * FROM routine_runs ORDER BY id" })
    ).toEqual(before);
    f.harness.run({
      sql: "UPDATE routine_runs SET status = 'completed', finished_at_ms = ? WHERE id = 'old-run'",
      params: [TEST_NOW_MS + 900],
    });
    f.harness.run({
      sql: "UPDATE openMeldRemoteAgent_native_delivery_ledger SET status = 'completed', final_publication_state = 'outcome_unknown' WHERE delivery_id = 'continuation-delivery'",
    });
    const uncertain = await f.read();
    expect(uncertain.run.status).toBe("completed");
    expect(uncertain.run.publication.status).toBe("not_recorded");
    expect(uncertain.nativeDelivery.deliveries[0]?.publicationState).toBe(
      "outcome_unknown"
    );
  });

  it("distinguishes skipped, failed, absent runtime evidence and unavailable runtime service", async () => {
    const f = await fixture();
    expect(await f.read("middle-run")).toMatchObject({
      run: { status: "skipped" },
      nativeDelivery: { coverage: "not_recorded", deliveries: [] },
    });
    const failed = await f.read("latest-run");
    expect(failed.run.failure.status).toBe("recorded");
    expect(failed.run.failure.publicReason).toBeTruthy();
    await delivery(f, "only-delivery", 0);
    Reflect.set(f.env, "OPENMELD_REMOTE_AGENT_WORKER", {
      readRuntimeDiagnostics: () => Promise.resolve(runtimeResponse([])),
    });
    expect(
      (await f.read()).nativeDelivery.deliveries[0]?.runtimeEvidenceStatus
    ).toBe("not_recorded");
    Reflect.deleteProperty(f.env, "OPENMELD_REMOTE_AGENT_WORKER");
    const unavailable = await f.read();
    expect(unavailable.nativeDelivery.coverage).toBe("available");
    expect(
      unavailable.nativeDelivery.deliveries[0]?.runtimeEvidenceStatus
    ).toBe("unavailable");
  });

  it("redacts inaccessible/private references and explicitly marks unsupported channel provenance", async () => {
    const f = await fixture();
    f.harness.run({
      sql: "UPDATE routine_runs SET target_space_id_snapshot = ?, published_signal_id = 'private-result' WHERE id = 'old-run'",
      params: [EVIDENCE_OTHER_SPACE_ID],
    });
    const hidden = await f.read();
    expect(hidden.run.destination.coverage).toBe("redacted");
    expect(hidden.run.publication).toEqual({
      status: "recorded",
      signalId: null,
    });
    expect(JSON.stringify(hidden)).not.toContain(EVIDENCE_OTHER_SPACE_ID);
    expect(JSON.stringify(hidden)).not.toContain("private-result");
    f.harness.run({
      sql: "UPDATE routine_runs SET destination_kind_snapshot = 'slack_thread', target_space_id_snapshot = NULL, slack_channel_id_snapshot = 'private-channel' WHERE id = 'old-run'",
    });
    const channel = await f.read();
    expect(channel.run.destination.coverage).toBe("unsupported_source");
    expect(JSON.stringify(channel)).not.toContain("private-channel");
  });

  it("rejects unknown and personal Runs identically, revoked members and caller-supplied submission IDs", async () => {
    const f = await fixture();
    await expect(f.read("missing")).rejects.toMatchObject({ status: 404 });
    f.harness.run({
      sql: "UPDATE routine_runs SET agent_profile_id_snapshot = ? WHERE id = 'old-run'",
      params: [f.request.agentProfileId],
    });
    await expect(f.read()).rejects.toMatchObject({ status: 404 });
    const listed = centerAgentListRoutineRunsToolResponseSchema.parse(
      await f.execute(f.binding, "openmeld_list_routine_runs", {
        routineId: "routine-1",
      })
    );
    expect(listed.runs.map((run) => run.id)).not.toContain("old-run");
    await expect(
      f.execute(f.binding, "openmeld_read_routine_run_diagnostics", {
        runId: "middle-run",
        submissionId: "arbitrary",
      })
    ).rejects.toThrow();
    f.harness.run({
      sql: "DELETE FROM members WHERE id = ?",
      params: [f.speaker.id],
    });
    await expect(f.read("middle-run")).rejects.toMatchObject({ status: 403 });
  });
});
