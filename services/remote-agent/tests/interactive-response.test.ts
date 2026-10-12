import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  type AgentSteeringInput,
  defineTool,
  init,
  useModel,
  useTool,
} from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { strictObject, string } from "valibot";
import { expect, it, vi } from "vitest";
import { useInteractiveResponse } from "../flue-adapter/interactive-response";

it("answers before exposing work, preserves the submission, and resets for the next request", async () => {
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
  const progress = defineTool({
    name: "openmeld_report_progress",
    description: "Reply before work.",
    input: strictObject({ update: string() }),
    run: () => {
      publicationAttempts += 1;
      if (publicationAttempts === 1) {
        return { output: { shown: false } };
      }
      order.push("reply");
      return { output: { shown: true } };
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
      tools: [progress, work, readResult],
    });
    for (const tool of response.tools) {
      useTool(tool);
    }
    return "Answer the user first. Then do their work.";
  }
  Interactive.joinQueuedDeliveries = false;
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
          agent: "Interactive",
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
      return fauxAssistantMessage(
        fauxToolCall("openmeld_report_progress", {
          update: "I'm here. The original command is still running.",
        }),
        { stopReason: "toolUse" }
      );
    },
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
    expect(order).toEqual(["reply", "work", "reply", "read"]);
    submissionId = "second";
    steerReady = false;
    steering = undefined;
    await agent.read(await agent.dispatch("Are you there?"));
    expect(work.run).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["reply", "work", "reply", "read"]);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
