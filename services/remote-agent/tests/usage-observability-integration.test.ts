import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
  type FlueObservation,
  observe,
  setProvider,
  useModel,
} from "@flue/runtime";
import {
  createFlueContext,
  createNodeAgentCoordinator,
  resetModelsForTests,
  resolveModel,
} from "@flue/runtime/internal";
import { sqlite } from "@flue/runtime/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRemoteAgentName,
  type RemoteAgentAdmissionHost,
  submitRemoteAgentConversationTurn,
} from "../agent-core/submission";
import { installRemoteAgentExecutionInstrumentation } from "../flue-adapter/execution-context";
import { createCenterAgentObservationDispatcher } from "../flue-adapter/observation-dispatcher";
import { handleCenterAgentObservation } from "../flue-adapter/stream-observer";
import { createRemoteAgentStreamPublisher } from "../flue-adapter/streaming";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const AGENT_NAME = "center-agent-v2";
const INSTANCE_ID = "space-usage-observability";
const MODEL_ID = "usage-observability-model";
const PROVIDER_ID = "usage-observability-provider";

describe("Remote Agent usage observability integration", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
    resetModelsForTests();
  });

  it("writes provider turn usage to Analytics Engine", async () => {
    installRemoteAgentExecutionInstrumentation();
    const callbackStorage = new InMemoryDurableObjectStorage();
    const writeDataPoint = vi.fn();
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_usage_observability",
      status: "accepted" as const,
    }));
    const observedEvents: FlueObservation[] = [];
    const scheduledObservations: Promise<void>[] = [];
    const streamPublisher = createRemoteAgentStreamPublisher({
      sleep: async () => undefined,
    });
    const dispatchObservation = createCenterAgentObservationDispatcher({
      handle: async (event) => {
        await handleCenterAgentObservation({
          event,
          resolveDependencies: () => ({
            coreWorker: {
              completeRemoteAgentSubmission,
              submitRemoteAgentStreamDelta: async (body: {
                sequence: number;
              }) => ({
                lastSequence: body.sequence,
                status: "accepted" as const,
              }),
            },
            env: {
              OPENMELD_OBSERVABILITY: { writeDataPoint },
              OPENMELD_WORKER_ENVIRONMENT: "test",
            } as unknown as CloudflareBindings,
            storage: callbackStorage,
          }),
          streamPublisher,
        });
      },
      scheduleBackground: (task) => {
        scheduledObservations.push(task);
      },
    });
    const unsubscribe = observe((event) => {
      if (event.agentName !== AGENT_NAME) {
        return;
      }
      observedEvents.push(event);
      return dispatchObservation(event);
    });
    cleanups.push(unsubscribe);

    const faux = fauxProvider({
      api: "usage-observability-faux",
      models: [
        {
          contextWindow: 32_000,
          id: MODEL_ID,
          maxTokens: 1024,
        },
      ],
      provider: PROVIDER_ID,
    });
    setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage("Usage from this completed turn must be recorded."),
    ]);

    const persistence = sqlite();
    cleanups.push(async () => await persistence.close?.());
    await persistence.migrate?.();
    const stores = await persistence.connect();
    function agent() {
      useModel(`${PROVIDER_ID}/${MODEL_ID}`);
      return "Answer the user directly.";
    }
    const coordinator = createNodeAgentCoordinator({
      agents: [{ agent, name: AGENT_NAME }],
      attachmentStore: stores.attachmentStore,
      conversationStreamStore: stores.conversationStreamStore,
      createContext: ({ agentName, id, request, submissionId }) =>
        createFlueContext({
          agentConfig: { resolveModel },
          agentName,
          env: {},
          id,
          req: request,
          submissionId,
        }),
      submissions: stores.submissionStore,
    });
    cleanups.push(async () => await coordinator.shutdown());

    const baseRequest = createSubmitTurnRequest();
    const request = createSubmitTurnRequest({
      spaceId: INSTANCE_ID,
      turnEnvelope: {
        ...baseRequest.turnEnvelope,
        space: { ...baseRequest.turnEnvelope.space, id: INSTANCE_ID },
      },
    });
    const host: RemoteAgentAdmissionHost = {
      admitConversationTurn: async ({
        message,
        request: admittedRequest,
        submissionId,
      }) => {
        const admission = await coordinator.admitDispatch({
          acceptedAt: new Date(TEST_NOW_MS).toISOString(),
          agent: AGENT_NAME,
          submissionId,
          id: INSTANCE_ID,
          message: { kind: "user", body: message },
        });
        if (admission.kind === "conflict") {
          throw new Error("Deterministic Flue dispatch conflicted.");
        }
        return {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: admittedRequest.idempotencyKey,
          requestId: submissionId,
          status: "pending",
          submissionId,
        };
      },
    };

    await submitRemoteAgentConversationTurn({
      agentName: buildRemoteAgentName(request),
      host,
      input: request,
      nowMs: () => TEST_NOW_MS,
      storage: callbackStorage,
    });
    await coordinator.waitForIdle();
    await Promise.all(scheduledObservations);

    const providerTurn = observedEvents.find(
      (event) => event.type === "turn" && !event.isError
    );
    if (providerTurn?.type !== "turn") {
      throw new Error(
        `Expected a completed provider turn. Events: ${summarizeEvents(
          observedEvents
        )}`
      );
    }
    const usage = providerTurn.response.usage;
    if (!usage) {
      throw new Error(
        `Expected provider turn usage. Events: ${summarizeEvents(
          observedEvents
        )}`
      );
    }
    const usagePoints = writeDataPoint.mock.calls
      .map(([point]) => point as AnalyticsEngineDataPoint)
      .filter((point) => point.blobs?.[0] === "remote_agent.turn_usage.v1");

    expect(
      usagePoints,
      `Observed Flue events: ${summarizeEvents(observedEvents)}`
    ).toHaveLength(1);
    expect(usagePoints[0]?.blobs?.[0]).toBe("remote_agent.turn_usage.v1");
    expect(usagePoints[0]?.indexes).toEqual([request.organizationId]);
    expect(usagePoints[0]?.doubles).toEqual([
      usage.input,
      usage.output,
      usage.cacheRead,
      usage.cacheWrite,
      usage.totalTokens,
      usage.cost.total,
    ]);
    expect(usagePoints[0]?.blobs?.[7]).toBe(request.spaceId);
    expect(usagePoints[0]?.blobs?.[8]).toBe(request.dispatchId);
  });
});

function summarizeEvents(events: readonly FlueObservation[]): string {
  return JSON.stringify(
    events.map((event) => ({
      operationKind: "operationKind" in event ? event.operationKind : undefined,
      submissionId: event.submissionId,
      type: event.type,
      usage: "usage" in event ? event.usage : undefined,
      error: "error" in event ? event.error : undefined,
      result: "result" in event ? event.result : undefined,
      isError: "isError" in event ? event.isError : undefined,
    })),
    null,
    2
  );
}
