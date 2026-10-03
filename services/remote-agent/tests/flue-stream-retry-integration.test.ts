import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { defineTool, init, observe, useModel, useTool } from "@flue/runtime";
import { start } from "@flue/runtime/node";
import type { RemoteAgentStreamDeltaCallbackBody } from "@openmeld/schemas/types";
import { object } from "valibot";
import { expect, it } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { initializeRemoteAgentExecutionState } from "../agent-core/execution-state";
import { createCenterAgentObservationDispatcher } from "../flue-adapter/observation-dispatcher";
import { handleCenterAgentObservation } from "../flue-adapter/stream-observer";
import { createRemoteAgentStreamPublisher } from "../flue-adapter/streaming";
import { createSubmitTurnRequest } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

it.each([
  { withNarration: false, silentToolSteps: 0 },
  { withNarration: true, silentToolSteps: 0 },
  { withNarration: false, silentToolSteps: 1 },
  { withNarration: true, silentToolSteps: 2 },
])("replaces a failed streamed answer with prior narration=$withNarration and silent retry tool steps=$silentToolSteps", async ({
  withNarration,
  silentToolSteps,
}) => {
  const provider = fauxProvider({
    provider: "retry-display",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  const gate = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
  // The failed message and its buffered tail must be visible before retry.
  const failed = fauxAssistantMessage("Wrong partial answer. ".repeat(20), {
    stopReason: "error",
    errorMessage: "Connection error.",
  });
  const final = fauxAssistantMessage("Correct complete answer.");
  const narration = fauxAssistantMessage(
    [
      fauxThinking("Private reasoning must not become a stream prefix."),
      fauxText("I will check the catalogue."),
      fauxToolCall("lookup", {}),
    ],
    { stopReason: "toolUse" }
  );
  provider.setResponses([
    () => gate.promise,
    ...(withNarration ? [failed] : []),
    ...Array.from({ length: silentToolSteps }, () =>
      fauxAssistantMessage(fauxToolCall("lookup", {}), {
        stopReason: "toolUse",
      })
    ),
    final,
  ]);
  const lookup = defineTool({
    name: "lookup",
    description: "Read the catalogue.",
    input: object({}),
    run: () => ({ output: "The catalogue is available." }),
  });
  function Center() {
    useModel(`${model.provider}/${model.id}`);
    useTool(lookup);
    return "Answer the request without exposing private reasoning.";
  }
  Center.agentName = "center-agent-v2";
  Center.joinQueuedDeliveries = false;
  Center.durability = { maxAttempts: 5, timeoutMs: 0 };
  const storage = new InMemoryDurableObjectStorage();
  const publisher = createRemoteAgentStreamPublisher();
  const frames: RemoteAgentStreamDeltaCallbackBody[] = [];
  const coreWorker = {
    submitRemoteAgentStreamDelta: (
      body: RemoteAgentStreamDeltaCallbackBody
    ) => {
      frames.push(body);
      return Promise.resolve({
        status: "accepted" as const,
        lastSequence: body.sequence,
      });
    },
  };
  const pending = new Set<Promise<void>>();
  const errors: unknown[] = [];
  const replacementPrefixes: string[] = [];
  const dispatchObservation = createCenterAgentObservationDispatcher({
    handle: (event) =>
      handleCenterAgentObservation({
        event,
        resolveDependencies: () => ({
          coreWorker,
          storage,
          env: {} as CloudflareBindings,
        }),
        streamPublisher: publisher,
      }),
    scheduleBackground: (task) => {
      pending.add(task);
      task
        .catch((error: unknown) => errors.push(error))
        .finally(() => pending.delete(task));
    },
  });
  const unsubscribe = observe((event) => {
    if (event.type === "text_delta") {
      const prefix: unknown = Reflect.get(event, "textPrefix");
      if (typeof prefix === "string") {
        replacementPrefixes.push(prefix);
      }
    }
    if (
      event.type === "text_delta" ||
      event.type === "thinking_delta" ||
      event.type === "message_end"
    ) {
      return dispatchObservation(event);
    }
  });
  const runtime = await start({
    agents: [Center],
    providers: [provider.provider],
  });
  try {
    const agent = init(Center, { id: "retry-same-worker" });
    const receipt = await agent.dispatch("Check the catalogue and answer.");
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: {
        accepted: true,
        createdAt: Date.now(),
        idempotencyKey: request.idempotencyKey,
        requestId: receipt.submissionId,
        status: "pending",
        submissionId: receipt.submissionId,
      },
      nowMs: Date.now(),
      request,
    });
    await putRemoteAgentCallbackContext(storage, context);
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: context.submissionCreatedAt,
      identity: {
        idempotencyKey: context.idempotencyKey,
        organizationId: context.organizationId,
        spaceId: context.spaceId,
        submissionId: context.submissionId,
        v: 1,
      },
      storage,
    });
    gate.resolve(withNarration ? narration : failed);
    const answer = await agent.read(receipt);
    await Promise.all([...pending]);
    await publisher.flush({
      context,
      coreWorker,
      storage,
      observedAtMs: Date.now() + 1000,
    });
    expect(errors).toEqual([]);
    const snapshots = frames.map((frame) =>
      "snapshot" in frame ? frame.snapshot : frame.textSnapshot
    );
    expect(
      snapshots.some((text) => text.includes("Wrong partial answer."))
    ).toBe(true);
    expect(snapshots.at(-1)).toBe(answer.text);
    expect(snapshots.at(-1)).not.toContain("Wrong partial");
    expect(snapshots.at(-1)).toContain("Correct complete answer.");
    expect(replacementPrefixes).toEqual([
      withNarration ? "I will check the catalogue.\n\n" : "",
    ]);
    if (withNarration) {
      expect(snapshots.at(-1)).toContain("I will check the catalogue.");
    }
    expect(snapshots.every((text) => !text.includes("Private reasoning"))).toBe(
      true
    );
    expect(
      frames.every((frame) => frame.submissionId === receipt.submissionId)
    ).toBe(true);
  } finally {
    gate.resolve(final);
    await runtime.stop();
    await Promise.all([...pending]);
    unsubscribe();
  }
});
