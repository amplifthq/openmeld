import { randomUUID } from "node:crypto";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequestV2 } from "../../remote-agent/tests/fixtures";
import { buildRemoteAgentWorkerSubmitTurnRequestV4 } from "../src/remote-agent/application/remote-agent-conversation-continuity";
import { readRemoteAgentRuntimeDiagnosticsForDispatch } from "../src/remote-agent/application/remote-agent-runtime-diagnostics-service";
import {
  persistRemoteAgentWorkerSubmitRequest,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { env } from "../test-support/worker-env";

describe("Remote Agent runtime diagnostics service", () => {
  it("keeps pre-admission dispatch details readable before runtime identity exists", async () => {
    const suffix = randomUUID();
    const dispatchId = `dispatch-pre-admission-${suffix}`;
    const idempotencyKey = `remote-agent:${dispatchId}`;
    const spaceId = `space-${suffix}`;
    const targetProfileId = "agt_22222222-2222-4222-8222-222222222222";
    await upsertRemoteAgentNativeDeliveryRecord({
      attemptId: `attempt-${suffix}`,
      bindingId: `binding-${suffix}`,
      db: getPostgresDatabase(env),
      dispatchId,
      idempotencyKey,
      nowMs: Date.now(),
      organizationId: `org-${suffix}`,
      profileId: targetProfileId,
      spaceId,
      status: "submitted",
      triggerMessageId: `signal-${suffix}`,
    });
    const readRuntimeDiagnostics = vi.fn();

    await expect(
      readRemoteAgentRuntimeDiagnosticsForDispatch({
        db: getPostgresDatabase(env),
        dispatchId,
        remoteAgentWorker: { readRuntimeDiagnostics },
        spaceId,
        targetProfileId,
      })
    ).resolves.toBeNull();
    expect(readRuntimeDiagnostics).not.toHaveBeenCalled();
  });

  it.each([
    1, 2,
  ] as const)("reads diagnostics v%s from the exact runtime generation frozen on the dispatch", async (version) => {
    const suffix = randomUUID();
    const dispatchId = `dispatch-${suffix}`;
    const idempotencyKey = `remote-agent:${dispatchId}`;
    const organizationId = `org-${suffix}`;
    const spaceId = `space-${suffix}`;
    const targetProfileId = "agt_11111111-1111-4111-8111-111111111111";
    const workerSubmitRequest = buildRemoteAgentWorkerSubmitTurnRequestV4({
      generation: 2,
      request: createSubmitTurnRequestV2({
        agentProfileId: targetProfileId,
        bindingId: `binding-${suffix}`,
        dispatchId,
        idempotencyKey,
        organizationId,
        sourceClientMessageId: `client-${suffix}`,
        spaceId,
        triggerMessageId: `signal-${suffix}`,
      }),
    });
    await upsertRemoteAgentNativeDeliveryRecord({
      attemptId: null,
      bindingId: workerSubmitRequest.bindingId,
      db: getPostgresDatabase(env),
      dispatchId,
      idempotencyKey,
      nowMs: Date.now(),
      organizationId,
      profileId: targetProfileId,
      spaceId,
      status: "submitted",
      triggerMessageId: workerSubmitRequest.triggerMessageId,
    });
    await persistRemoteAgentWorkerSubmitRequest({
      db: getPostgresDatabase(env),
      idempotencyKey,
      nowMs: Date.now(),
      workerSubmitRequest,
    });
    const response = {
      activeRuns: [],
      ...(version === 1 ? { attemptMarkers: [] } : {}),
      callbackContexts: [],
      collectedAt: "2026-08-12T00:00:00.000Z",
      durableObjectAlarmAtMs: null,
      fibers: [],
      schedules: [],
      spaceId,
      submissions: [],
      v: version,
    };
    const readRuntimeDiagnostics = vi.fn().mockResolvedValue(response);

    await expect(
      readRemoteAgentRuntimeDiagnosticsForDispatch({
        db: getPostgresDatabase(env),
        dispatchId,
        remoteAgentWorker: { readRuntimeDiagnostics },
        spaceId,
        targetProfileId,
      })
    ).resolves.toEqual(response);
    expect(readRuntimeDiagnostics).toHaveBeenCalledWith({
      runtimeConversationId: workerSubmitRequest.runtimeConversation.id,
      spaceId,
    });
    expect(workerSubmitRequest.runtimeConversation.id).not.toBe(spaceId);
  });
});
