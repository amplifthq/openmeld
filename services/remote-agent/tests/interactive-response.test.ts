import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  type AgentSteeringInput,
  defineTool,
  init,
  observe,
  useAgentFinish,
  useModel,
  useTool,
} from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { strictObject, string } from "valibot";
import { expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { initializeRemoteAgentExecutionState } from "../agent-core/execution-state";
import {
  getRemoteAgentExecutionSubmissionId,
  installRemoteAgentExecutionInstrumentation,
  registerRemoteAgentExecutionPreparation,
} from "../flue-adapter/execution-context";
import { useInteractiveResponse } from "../flue-adapter/interactive-response";
import { createCenterAgentObservationDispatcher } from "../flue-adapter/observation-dispatcher";
import { createHostedPublicProgressTool } from "../flue-adapter/public-progress";
import { RemoteAgentSqlStorage } from "../flue-adapter/storage";
import { handleCenterAgentObservation } from "../flue-adapter/stream-observer";
import { createRemoteAgentStreamPublisher } from "../flue-adapter/streaming";
import { createSubmitTurnRequest } from "./fixtures";

it.each([
  "progress",
  "text",
] as const)("continues the original work after an accepted %s check-in response and resets for the next request", async (answerKind) => {
  const directory = await mkdtemp(join(tmpdir(), "interactive-response-"));
  const provider = fauxProvider({
    provider: "interactive-response",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  const order: string[] = [];
  let publicationAttempts = 0;
  let submissionId = "first";
  let steerReady = false;
  let steering: AgentSteeringInput | undefined;
  const database = new DatabaseSync(join(directory, "adapter.sqlite"));
  const storage = new RemoteAgentSqlStorage({
    exec(query, ...bindings) {
      const rows = database.prepare(query).all(...(bindings as never[]));
      return {
        toArray: () => rows,
        rowsWritten: Number(
          database.prepare("SELECT changes() AS count").get()?.count ?? 0
        ),
      };
    },
  });
  const publisher = createRemoteAgentStreamPublisher({
    sleep: async () => undefined,
  });
  let getAcceptedResponseInputId: () => string | null = () => null;
  const releaseTextAck = Promise.withResolvers<void>();
  const pending = new Set<Promise<void>>();
  const errors: unknown[] = [];
  let textAcknowledged = false;
  const coreWorker = {
    submitRemoteAgentStreamDelta: async (body: {
      kind?: string;
      sequence: number;
    }) => {
      if (body.kind === "progress") {
        publicationAttempts += 1;
        if (publicationAttempts <= 2) {
          return {
            status: "retryable" as const,
            reasonCode: "agent_stream.unavailable",
            lastSequence: 0,
          };
        }
        order.push("reply");
      } else if (
        answerKind === "text" &&
        submissionId === "check-in" &&
        !textAcknowledged
      ) {
        await releaseTextAck.promise;
        textAcknowledged = true;
        order.push("reply");
      }
      return { status: "accepted" as const, lastSequence: body.sequence };
    },
  };
  const stopPreparing = registerRemoteAgentExecutionPreparation(async () => {
    const executionId = getRemoteAgentExecutionSubmissionId();
    if (!executionId) {
      throw new Error("Missing execution identity");
    }
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: {
        accepted: true,
        createdAt: Date.now(),
        idempotencyKey: request.idempotencyKey,
        requestId: executionId,
        status: "pending",
        submissionId: executionId,
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
        submissionId: executionId,
        v: 1,
      },
      storage,
    });
    getAcceptedResponseInputId = await publisher.prepareResponseProjection({
      context,
      storage,
      observedAtMs: Date.now(),
    });
    return { interactiveResponseId: () => submissionId };
  });
  installRemoteAgentExecutionInstrumentation();
  const dispatchObservation = createCenterAgentObservationDispatcher({
    handle: (event, responseInputId) =>
      handleCenterAgentObservation({
        event,
        responseInputId,
        streamPublisher: publisher,
        resolveDependencies: () => ({
          coreWorker,
          storage,
          env: {} as CloudflareBindings,
        }),
      }),
    scheduleBackground: (task) => {
      pending.add(task);
      task
        .catch((error: unknown) => errors.push(error))
        .finally(() => pending.delete(task));
    },
  });
  const unsubscribe = observe((event) => {
    if (event.type === "text_delta" || event.type === "message_end") {
      return dispatchObservation(event);
    }
  });
  const progress = defineTool({
    name: "openmeld_report_progress",
    description: "Reply before work.",
    input: strictObject({ update: string() }),
    run: async ({ data }) => {
      const executionId = getRemoteAgentExecutionSubmissionId();
      if (!executionId) {
        throw new Error("Missing progress execution identity");
      }
      const tool = createHostedPublicProgressTool({
        coreWorker,
        storage,
        streamPublisher: publisher,
        submissionId: executionId,
      });
      return { output: (await tool.execute(data)) as { shown: boolean } };
    },
  });
  const work = defineTool({
    name: "start_work",
    description: "Start work once.",
    input: strictObject({}),
    run: vi.fn(() => {
      order.push("work");
      steerReady = true;
      return { output: { running: true, reference: "original-command" } };
    }),
  });
  const readResult = defineTool({
    name: "read_result",
    description: "Read the original command.",
    input: strictObject({}),
    run: vi.fn(() => {
      order.push("read");
      return { output: "ORIGINAL RESULT" };
    }),
  });
  function Interactive() {
    useModel(`${model.provider}/${model.id}`, { compaction: false });
    const response = useInteractiveResponse({
      getInputId: () => submissionId,
      getAcceptedResponseInputId,
      tools: [progress, work, readResult],
    });
    useAgentFinish((finish) => {
      if (steerReady && vi.mocked(readResult.run).mock.calls.length === 0) {
        finish.append({
          kind: "signal",
          type: "owned_commands_pending",
          body: "The original command remains active. Read its retained result without restarting it.",
        });
      }
    });
    for (const tool of response.tools) {
      useTool(tool);
    }
    return response.instructions;
  }
  Interactive.joinQueuedDeliveries = false;
  Interactive.agentName = "center-agent-v2";
  Interactive.steeringSource = (targetSubmissionId: string) => ({
    claim: () => {
      if (!steerReady || steering?.status === "joined") {
        return Promise.resolve([]);
      }
      submissionId = "check-in";
      steering = {
        targetSubmissionId,
        status: "joining",
        input: {
          kind: "dispatch",
          submissionId: "check-in",
          agent: "center-agent-v2",
          id: "one-conversation",
          acceptedAt: new Date().toISOString(),
          message: {
            kind: "user",
            body: "Are you there? Keep the original command running.",
          },
        },
      };
      return Promise.resolve([steering]);
    },
    listUnresolved: () => Promise.resolve(steering ? [steering] : []),
    finalize: () => {
      if (steering) {
        steering.status = "joined";
      }
      return Promise.resolve();
    },
    revert: () => Promise.resolve(),
  });
  provider.setResponses([
    () =>
      fauxAssistantMessage(
        fauxToolCall("openmeld_report_progress", {
          update: "I'm here. I'll continue the video.",
        }),
        { stopReason: "toolUse" }
      ),
    () =>
      fauxAssistantMessage(fauxToolCall("start_work", {}), {
        stopReason: "toolUse",
      }),
    () => {
      expect(work.run).not.toHaveBeenCalled();
      return fauxAssistantMessage(
        fauxToolCall("openmeld_report_progress", {
          update: "I'm here. I'll continue the video.",
        }),
        { stopReason: "toolUse" }
      );
    },
    () => {
      expect(order).toEqual(["reply"]);
      return fauxAssistantMessage(fauxToolCall("start_work", {}), {
        stopReason: "toolUse",
      });
    },
    () =>
      fauxAssistantMessage(fauxToolCall("read_result", {}), {
        stopReason: "toolUse",
      }),
    (ctx) => {
      expect(JSON.stringify(ctx.messages)).toContain(
        "Keep the original command running."
      );
      expect(readResult.run).not.toHaveBeenCalled();
      return answerKind === "text"
        ? fauxAssistantMessage(
            "I'm here. The original command is still running."
          )
        : fauxAssistantMessage(
            fauxToolCall("openmeld_report_progress", {
              update: "I'm here. The original command is still running.",
            }),
            { stopReason: "toolUse" }
          );
    },
    ...(answerKind === "text"
      ? [
          async () => {
            // Flue does not await observation delivery. A late Core ACK must keep
            // the catalog closed, then unlock the next render without a progress tool.
            expect(getAcceptedResponseInputId()).toBe("first");
            expect(readResult.run).not.toHaveBeenCalled();
            releaseTextAck.resolve();
            await Promise.all([...pending]);
            expect(getAcceptedResponseInputId()).toBe("check-in");
            return fauxAssistantMessage(
              "The original command is still running."
            );
          },
        ]
      : []),
    () =>
      fauxAssistantMessage(fauxToolCall("read_result", {}), {
        stopReason: "toolUse",
      }),
    () => {
      expect(readResult.run).toHaveBeenCalledOnce();
      return fauxAssistantMessage("Done: ORIGINAL RESULT.");
    },
    () =>
      fauxAssistantMessage(fauxToolCall("start_work", {}), {
        stopReason: "toolUse",
      }),
    () => {
      expect(work.run).toHaveBeenCalledTimes(1);
      return fauxAssistantMessage("Yes, I'm here.");
    },
  ]);
  const runtime = await start({
    agents: [Interactive],
    providers: [provider.provider],
    db: sqlite(join(directory, "history.sqlite")),
  });
  const agent = init(Interactive, { id: "one-conversation" });
  try {
    await agent.read(await agent.dispatch("Continue the video."));
    await Promise.all([...pending]);
    expect(errors).toEqual([]);
    expect(order).toEqual(["reply", "work", "reply", "read"]);
    submissionId = "second";
    steerReady = false;
    steering = undefined;
    await agent.read(await agent.dispatch("Are you there?"));
    expect(work.run).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["reply", "work", "reply", "read"]);
  } finally {
    releaseTextAck.resolve();
    await runtime.stop();
    await Promise.all([...pending]);
    unsubscribe();
    stopPreparing();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
