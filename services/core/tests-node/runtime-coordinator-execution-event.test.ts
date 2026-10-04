import { buildRuntimeCoordinatorExecutionEventId } from "@openmeld/schemas";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  createRuntimeCoordinatorTokenFingerprint,
  createRuntimeCoordinatorTokenValidationHash,
  REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN,
} from "../src/runtime-transport/application/runtime-coordinator-execution-token";
import { writeRuntimeCoordinatorExecutionEventFromParts } from "../src/runtime-transport/infrastructure/postgresql/runtime-coordinator-execution-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("RuntimeCoordinator native event persistence", () => {
  it("bounds long identities, deduplicates replay, and preserves legacy short identities and correlation", async () => {
    const harness = await createPostgresHarness();
    onTestFinished(async () => {
      await harness.close();
    });
    const input = {
      db: harness.db,
      eventType: "execution_token_terminal_late" as const,
      runtimeCoordinatorExecutionId: "e".repeat(200),
      idempotencyKey: `token_validation:${"e".repeat(200)}:lifecycle:${"r".repeat(120)}`,
      observedAtMs: 1000,
      payload: { frameKind: "lifecycle" },
    };
    await writeRuntimeCoordinatorExecutionEventFromParts(input);
    await writeRuntimeCoordinatorExecutionEventFromParts({
      ...input,
      observedAtMs: 2000,
    });
    await writeRuntimeCoordinatorExecutionEventFromParts({
      ...input,
      idempotencyKey: `${input.idempotencyKey}:different`,
    });
    const rows = await harness.queryAll<{
      event_id: string;
      runtime_coordinator_execution_id: string;
      idempotency_key: string;
      observed_at_ms: number;
    }>({
      text: `SELECT event_id, runtime_coordinator_execution_id, idempotency_key, observed_at_ms
        FROM "openmeld"."openMeldDaemon_runtime_coordinator_execution_events" ORDER BY idempotency_key`,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.event_id.length).toBeLessThanOrEqual(512);
    expect(rows[0]?.event_id).not.toBe(rows[1]?.event_id);
    expect(rows[0]).toMatchObject({
      runtime_coordinator_execution_id: input.runtimeCoordinatorExecutionId,
      idempotency_key: input.idempotencyKey,
      observed_at_ms: 1000,
    });
    const short = {
      ...input,
      idempotencyKey: "short",
      runtimeCoordinatorExecutionId: "rce-1",
    };
    await writeRuntimeCoordinatorExecutionEventFromParts(short);
    expect(
      await harness.queryFirst({
        text: `SELECT event_id FROM "openmeld"."openMeldDaemon_runtime_coordinator_execution_events" WHERE idempotency_key = 'short'`,
      })
    ).toEqual({ event_id: buildRuntimeCoordinatorExecutionEventId(short) });
  });

  it("persists redacted diagnostic payloads without execution credentials", async () => {
    const harness = await createPostgresHarness();
    onTestFinished(async () => {
      await harness.close();
    });
    const executionToken = `rcet_v1_${"a".repeat(64)}`;
    const scope = {
      authorityScope: {
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-1",
      },
      executionScope: {
        dispatchId: "dispatch-1",
        runtimeCoordinatorExecutionId: "rce-1",
        sourceClientMessageId: "client-message-1",
        spaceId: "space-1",
        targetProfileId: "agt-1",
      },
      runId: "run-1",
    };
    const tokenValidationHash =
      await createRuntimeCoordinatorTokenValidationHash({
        executionToken,
        scope,
      });
    const tokenFingerprint = await createRuntimeCoordinatorTokenFingerprint({
      executionToken,
      scope,
    });
    await writeRuntimeCoordinatorExecutionEventFromParts({
      db: harness.db,
      eventType: "result_received",
      idempotencyKey: "rce-1::run-1",
      observedAtMs: 1_700_000_000_000,
      payload: { executionToken, tokenFingerprint, tokenValidationHash },
      reasonCode: "execution_token_issued",
      runtimeCoordinatorExecutionId: "rce-1",
      statusAfter: "delivery_accepted",
    });
    const row = await harness.queryFirst<{ payload_json: string }>({
      text: `SELECT payload_json FROM "openmeld"."openMeldDaemon_runtime_coordinator_execution_events"`,
    });
    expect(row?.payload_json).not.toContain(executionToken);
    expect(row?.payload_json).not.toContain(tokenValidationHash);
    expect(row?.payload_json).toContain(tokenFingerprint);
    expect(row?.payload_json).toContain(
      REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN
    );
  });
});
