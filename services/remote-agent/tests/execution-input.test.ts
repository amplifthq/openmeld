import { describe, expect, it } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  buildRemoteAgentExecutionIdentity,
  completeRemoteAgentExecutionState,
  initializeRemoteAgentExecutionState,
  requestRemoteAgentExecutionCancellation,
} from "../agent-core/execution-state";
import {
  createRemoteAgentSteeringSource,
  hasPendingRemoteAgentExecutionInput,
  readRemoteAgentExecutionInput,
  receiveRemoteAgentExecutionInput,
} from "../flue-adapter/execution-input";
import { createSubmitTurnRequest } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

async function fixture() {
  const storage = new InMemoryDurableObjectStorage();
  const turn = createSubmitTurnRequest();
  const authorProfileId = turn.author.profileId;
  if (!authorProfileId) {
    throw new Error("Fixture must have a Human Profile.");
  }
  const context = createRemoteAgentCallbackContext({
    ack: {
      accepted: true,
      createdAt: 100,
      idempotencyKey: turn.idempotencyKey,
      status: "pending",
      submissionId: "original-execution",
    },
    nowMs: 100,
    request: turn,
  });
  await putRemoteAgentCallbackContext(storage, context);
  const target = buildRemoteAgentExecutionIdentity(context);
  await initializeRemoteAgentExecutionState({
    acceptedAtMs: 100,
    identity: target,
    storage,
  });
  const request = {
    target,
    inputId: "correction",
    sourceSignalId: "signal-correction",
    authorProfileId,
    text: "Only analyze North America.",
  };
  return { storage, target, context, request };
}

describe("exact-execution input intake", () => {
  it("keeps receipt separate from canonical application, including duplicate delivery and a rebuilt source", async () => {
    const { storage, context, request } = await fixture();
    const results = await Promise.all(
      [200, 201].map((nowMs) =>
        receiveRemoteAgentExecutionInput({ storage, request, nowMs })
      )
    );
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({
      status: "received",
      receipt: { appliedAtMs: null },
    });
    const firstSource = createRemoteAgentSteeringSource({ storage, context });
    expect(
      await hasPendingRemoteAgentExecutionInput({ storage, context })
    ).toBe(true);
    const pending = await firstSource.claim();
    expect(firstSource.getResponseId()).toBe("openmeld-input:correction");
    expect(pending).toHaveLength(1);
    const message = pending[0]?.input.message;
    expect(message).toMatchObject({
      kind: "user",
      body: expect.stringContaining(request.text),
    });
    expect(message).toMatchObject({
      body: expect.stringContaining(
        "Request received at UTC: 1970-01-01T00:00:00.200Z"
      ),
    });
    expect(message).toMatchObject({
      body: expect.stringContaining(
        "Request timezone: UTC (UTC fallback: no valid user timezone)"
      ),
    });
    const rebuilt = createRemoteAgentSteeringSource({ storage, context });
    expect(await rebuilt.claim()).toEqual(pending);
    const firstInput = pending[0];
    if (!firstInput) {
      throw new Error("Expected one durable input.");
    }
    await rebuilt.finalize(firstInput.input.submissionId);
    expect(await firstSource.claim()).toEqual([]);
    expect(
      await hasPendingRemoteAgentExecutionInput({ storage, context })
    ).toBe(false);
    expect(rebuilt.getResponseId()).toBe(firstSource.getResponseId());
    expect(
      await readRemoteAgentExecutionInput({ storage, query: request })
    ).toMatchObject({
      status: "applied",
      receipt: { appliedAtMs: expect.any(Number) },
    });
    await expect(
      receiveRemoteAgentExecutionInput({
        storage,
        request: { ...request, text: "Use Europe instead." },
        nowMs: 300,
      })
    ).resolves.toEqual({ status: "rejected", reason: "input_conflict" });
  });

  it("keeps an active Steer's accepted timezone and timestamp through replay and a rebuilt source", async () => {
    const { storage, context, request } = await fixture();
    const accepted = {
      ...request,
      requestTimeContext: {
        submittedAtMs: 150,
        userTime: {
          timeZone: "Asia/Taipei",
          source: "desktop" as const,
          observedAtMs: 150,
        },
      },
    };
    await receiveRemoteAgentExecutionInput({
      storage,
      request: accepted,
      nowMs: 200,
    });
    await receiveRemoteAgentExecutionInput({
      storage,
      request: accepted,
      nowMs: 10_000,
    });
    const first = await createRemoteAgentSteeringSource({
      storage,
      context,
    }).claim();
    const rebuilt = await createRemoteAgentSteeringSource({
      storage,
      context,
    }).claim();
    expect(first).toEqual(rebuilt);
    const message = first[0]?.input.message;
    expect(message).toMatchObject({
      body: expect.stringContaining(
        "Request received at UTC: 1970-01-01T00:00:00.150Z"
      ),
    });
    expect(message).toMatchObject({
      body: expect.stringContaining(
        "Request timezone: Asia/Taipei (authenticated desktop observation)"
      ),
    });
    expect(JSON.stringify(message)).not.toContain("1970-01-01T00:00:10.000Z");
  });

  it("rejects a different sender and does not broaden the original execution's authority", async () => {
    const { storage, context, request } = await fixture();
    expect(
      await receiveRemoteAgentExecutionInput({
        storage,
        request: { ...request, authorProfileId: "another-member" },
        nowMs: 200,
      })
    ).toEqual({ status: "rejected", reason: "authority_mismatch" });
    expect(
      await createRemoteAgentSteeringSource({ storage, context }).claim()
    ).toEqual([]);
  });

  it.each([
    "stop",
    "complete",
  ])("does not retarget late input after %s", async (operation) => {
    const { storage, target, context, request } = await fixture();
    await receiveRemoteAgentExecutionInput({ storage, request, nowMs: 200 });
    if (operation === "stop") {
      await requestRemoteAgentExecutionCancellation({
        storage,
        identity: target,
        nowMs: 210,
      });
    } else {
      await completeRemoteAgentExecutionState({
        storage,
        identity: target,
        nowMs: 210,
        status: "completed",
        completedText: "Done.",
      });
    }
    expect(
      await receiveRemoteAgentExecutionInput({
        storage,
        request: { ...request, inputId: "late" },
        nowMs: 220,
      })
    ).toEqual({ status: "rejected", reason: "target_unavailable" });
    expect(
      await readRemoteAgentExecutionInput({ storage, query: request })
    ).toMatchObject({ status: "unconfirmed" });
    const next = {
      ...context,
      submissionId: "next-execution",
      idempotencyKey: "next-key",
    };
    expect(
      await createRemoteAgentSteeringSource({ storage, context: next }).claim()
    ).toEqual([]);
  });
});
