import { createHash } from "node:crypto";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type {
  FauxResponseFactory,
  FauxResponseStep,
} from "@earendil-works/pi-ai/providers/faux";
import {
  defineTool,
  init,
  instrument,
  observe,
  useModel,
  useTool,
} from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { object } from "valibot";
import { describe, expect, it } from "vitest";
import { resolveCenterAgentSpaceConversationId } from "../../core/src/remote-agent/application/remote-agent-conversation-continuity";
import {
  getRemoteAgentModelPurpose,
  REMOTE_AGENT_EXECUTION_INSTRUMENTATION,
  registerRemoteAgentExecutionPreparation,
  requireRemoteAgentExecutionResources,
} from "../flue-adapter/execution-context";

const RECEIPT = "COMPLETE-781";
const ARTIFACT = "Completed authorized work. Deployment is not authorized.\n";
const SMALL_INPUT_BUDGET = 6000;
const SUMMARY_FAILURE_MARKER = "UNCOMMITTED-CHECKPOINT-519";
const HISTORICAL_ROLE_LABEL = /\[Historical (user|assistant|toolResult) /u;

type Request = {
  context: TranscriptContext;
  estimatedTokens: number;
  model: string;
  purpose: ReturnType<typeof getRemoteAgentModelPurpose>;
};

function userTexts(context: TranscriptContext): string[] {
  return context.messages
    .filter((message) => message.role === "user")
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("")
    );
}

async function createFixture(
  largeCompaction = {
    workingContextTokens: 48_000,
    maxWorkingContextTokens: 56_000,
    reserveTokens: 2000,
    maxSummaryTokens: 512,
  }
) {
  const directory = await mkdtemp(join(tmpdir(), "flue-model-switch-"));
  const database = join(directory, "session.sqlite");
  const artifactPath = join(directory, "result.txt");
  const operationLog = join(directory, "writes.log");
  const digest = createHash("sha256").update(ARTIFACT).digest("hex");
  const provider = fauxProvider({
    provider: "model-switch-continuity",
    models: [
      { id: "large", contextWindow: 100_000, maxTokens: 16_384 },
      { id: "small", contextWindow: 8000, maxTokens: 1024 },
    ],
  });
  let selected: "large" | "small" = "large";
  let writes = 0;
  let afterWrite = () => Promise.resolve();
  const requests: Request[] = [];
  const compactions: boolean[] = [];
  const disposeInstrumentation = instrument(
    REMOTE_AGENT_EXECUTION_INSTRUMENTATION
  );
  // Exercise the real submission resource owner. The product's Core admission
  // freezes this route; changing the preference must not mutate live resources.
  const restorePreparation = registerRemoteAgentExecutionPreparation(() =>
    Promise.resolve({ model: selected })
  );
  const record = defineTool({
    name: "record",
    description: "Write the authorized result exactly once.",
    input: object({}),
    run: async () => {
      writes++;
      await appendFile(operationLog, "record\n");
      await writeFile(artifactPath, ARTIFACT, { flag: "wx" });
      await afterWrite();
      return {
        output: { receipt: RECEIPT, path: artifactPath, sha256: digest },
      };
    },
  });
  function Center() {
    const { model } = requireRemoteAgentExecutionResources<{
      model: "large" | "small";
    }>();
    useModel(`model-switch-continuity/${model}`, {
      compaction: {
        ...(model === "large"
          ? largeCompaction
          : {
              workingContextTokens: 6000,
              maxWorkingContextTokens: 6000,
              reserveTokens: 2000,
              maxSummaryTokens: 512,
            }),
        keepRecentTokens: 512,
        preserveActiveInput: true,
      },
    });
    useTool(record);
    return "Use existing results. Never repeat completed work. Do not deploy.";
  }
  Center.joinQueuedDeliveries = false;
  const unsubscribe = observe((event) => {
    if (event.type === "compaction") {
      compactions.push(event.isError);
    }
  });
  const open = () =>
    start({
      agents: [Center],
      providers: [provider.provider],
      db: sqlite(database),
    });
  let runtime = await open();
  const checkpoint = `The write completed once. Receipt ${RECEIPT}. File ${artifactPath}. SHA-256 ${digest}. Deployment is not authorized. Continue from the saved result.`;

  return {
    artifactPath,
    checkpoint,
    compactions,
    digest,
    expectedSavedResult: {
      content: ARTIFACT,
      sha256: digest,
      operations: "record\n",
      writes: 1,
    },
    requests,
    agent: (id = "same-conversation") => init(Center, { id }),
    selectModel: (model: typeof selected) => {
      selected = model;
    },
    waitAfterWrite: (wait: typeof afterWrite) => {
      afterWrite = wait;
    },
    setResponses: (responses: FauxResponseStep[]) => {
      provider.setResponses(
        responses.map(
          (response): FauxResponseFactory =>
            (context, options, state, model) => {
              const estimatedTokens = Math.ceil(
                Buffer.byteLength(JSON.stringify(context), "utf8") / 4
              );
              requests.push({
                context: structuredClone(context),
                estimatedTokens,
                model: model.id,
                purpose: getRemoteAgentModelPurpose(),
              });
              // Enforce a supplier capacity contract independently of Flue's
              // cut planner. An oversized request fails at the actual provider.
              if (
                model.id === "small" &&
                estimatedTokens > SMALL_INPUT_BUDGET
              ) {
                return fauxAssistantMessage("", {
                  stopReason: "error",
                  errorMessage: `context_length_exceeded: ${estimatedTokens} tokens exceeds ${SMALL_INPUT_BUDGET}`,
                });
              }
              return typeof response === "function"
                ? response(context, options, state, model)
                : response;
            }
        )
      );
    },
    readSavedResult: async () => {
      const contents = await readFile(artifactPath);
      return {
        content: contents.toString("utf8"),
        sha256: createHash("sha256").update(contents).digest("hex"),
        operations: await readFile(operationLog, "utf8"),
        writes,
      };
    },
    restart: async () => {
      await runtime.stop();
      runtime = await open();
    },
    dispose: async () => {
      unsubscribe();
      await runtime.stop();
      restorePreparation();
      await disposeInstrumentation();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function seedHistory(
  fixture: Fixture,
  shape: "long-history" | "large-tail"
) {
  fixture.setResponses([
    fauxAssistantMessage(fauxToolCall("record", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage(
      `${RECEIPT}. FIRST-OBSERVATION. ${
        shape === "large-tail"
          ? "Historical findings. 🧭".repeat(1500)
          : "Historical findings. ".repeat(800)
      } FIRST-OBSERVATION-END.`
    ),
    ...(shape === "long-history"
      ? [
          fauxAssistantMessage(
            `SECOND-OBSERVATION. ${"More historical findings. ".repeat(700)} SECOND-OBSERVATION-END.`
          ),
          fauxAssistantMessage(
            `THIRD-OBSERVATION. ${"Last historical findings. ".repeat(700)} THIRD-OBSERVATION-END.`
          ),
        ]
      : []),
  ]);
  const agent = fixture.agent();
  const receipt = await agent.dispatch("Record once and give the findings.");
  const reply = await agent.read(receipt);
  if (shape === "long-history") {
    await agent.read(await agent.dispatch("Explain the second observation."));
    await agent.read(await agent.dispatch("Explain the third observation."));
  }
  return { receipt, reply };
}

function savedResultResponse(fixture: Fixture): FauxResponseFactory {
  return (context) => {
    const source = JSON.stringify(context.messages);
    const hasSavedResult = [
      RECEIPT,
      fixture.artifactPath,
      fixture.digest,
    ].every((fact) => source.includes(fact));
    return fauxAssistantMessage(
      hasSavedResult
        ? fixture.checkpoint
        : "This input contains no complete saved-result receipt."
    );
  };
}

describe("model switch conversation continuity", () => {
  it("keeps walkthrough approvals separate from an interleaved Circle request after restart", async () => {
    const fixture = await createFixture();
    const spaceId = "tonebird-issues";
    const walkthrough = resolveCenterAgentSpaceConversationId({
      spaceId,
      sourceSignalId: "walkthrough-root",
      isCenterAgentDm: false,
    });
    const circle = resolveCenterAgentSpaceConversationId({
      spaceId,
      sourceSignalId: "circle-root",
      isCenterAgentDm: false,
    });
    try {
      fixture.setResponses([
        fauxAssistantMessage("27 walkthrough operations prepared."),
      ]);
      const first = fixture.agent(walkthrough);
      await first.read(
        await first.dispatch(
          "WALKTHROUGH-TON: create the 27 issues from the uploaded document."
        )
      );
      fixture.setResponses([fauxAssistantMessage("Circle request prepared.")]);
      const other = fixture.agent(circle);
      await other.read(
        await other.dispatch("CIRCLE-TON: default list and relationship view.")
      );
      expect(
        JSON.stringify(fixture.requests.at(-1)?.context.messages)
      ).not.toContain("WALKTHROUGH-TON");

      await fixture.restart();
      const approvalConversation = resolveCenterAgentSpaceConversationId({
        spaceId,
        sourceSignalId: "approval-onb-01",
        isCenterAgentDm: false,
        threadContext: {
          threadId: "thr-walkthrough",
          rootSignalId: "walkthrough-root",
        },
      });
      fixture.setResponses([fauxAssistantMessage("ONB-01 result returned.")]);
      const resumed = fixture.agent(approvalConversation);
      await resumed.read(
        await resumed.dispatch("Approved ton-walk-1315-ONB-01.")
      );
      const history = JSON.stringify(fixture.requests.at(-1)?.context.messages);
      expect(history).toContain("WALKTHROUGH-TON");
      expect(history).not.toContain("CIRCLE-TON");
      expect(approvalConversation).toBe(walkthrough);
    } finally {
      await fixture.dispose();
    }
  });

  it("finishes an active tool on its frozen model and applies the new model to the next submission", async () => {
    const fixture = await createFixture();
    const wroteFile = Promise.withResolvers<void>();
    const releaseTool = Promise.withResolvers<void>();
    fixture.waitAfterWrite(() => {
      wroteFile.resolve();
      return releaseTool.promise;
    });
    fixture.setResponses([
      fauxAssistantMessage(fauxToolCall("record", {}), {
        stopReason: "toolUse",
      }),
      savedResultResponse(fixture),
      savedResultResponse(fixture),
    ]);
    try {
      const agent = fixture.agent();
      const original = await agent.dispatch(
        "Write the result once. Do not deploy."
      );
      const originalReply = agent.read(original);
      await wroteFile.promise;
      fixture.selectModel("small");
      const next = await agent.dispatch(
        "Report the existing result. Do not write again."
      );
      expect(fixture.requests.map((request) => request.model)).toEqual([
        "large",
      ]);
      releaseTool.resolve();
      await expect(originalReply).resolves.toMatchObject({
        text: fixture.checkpoint,
      });
      await expect(agent.read(next)).resolves.toMatchObject({
        text: fixture.checkpoint,
      });
      expect(fixture.requests.map((request) => request.model)).toEqual([
        "large",
        "large",
        "small",
      ]);
      for (const request of fixture.requests.slice(1)) {
        const history = JSON.stringify(request.context.messages);
        expect(history).toContain(RECEIPT);
        expect(history).toContain(fixture.artifactPath);
        expect(history).toContain(fixture.digest);
      }
      expect(await fixture.readSavedResult()).toEqual(
        fixture.expectedSavedResult
      );

      await fixture.restart();
      const restored = fixture.agent();
      const requestsBeforeRead = fixture.requests.length;
      await expect(restored.read(original)).resolves.toMatchObject({
        text: fixture.checkpoint,
      });
      expect(fixture.requests).toHaveLength(requestsBeforeRead);
      fixture.setResponses([savedResultResponse(fixture)]);
      await expect(
        restored.read(
          await restored.dispatch("Report the saved receipt and hash.")
        )
      ).resolves.toMatchObject({ text: fixture.checkpoint });
      expect(fixture.requests.at(-1)?.model).toBe("small");
      expect(
        JSON.stringify(fixture.requests.at(-1)?.context.messages)
      ).toContain(fixture.digest);
      expect(await fixture.readSavedResult()).toEqual(
        fixture.expectedSavedResult
      );
    } finally {
      releaseTool.resolve();
      await fixture.dispose();
    }
  });

  it.each([
    "long-history",
    "large-tail",
  ] as const)("continues %s on a smaller model with every maintenance request inside capacity", async (shape) => {
    const fixture = await createFixture();
    try {
      const original = await seedHistory(fixture, shape);
      fixture.selectModel("small");
      fixture.setResponses(
        Array.from({ length: 24 }, () => savedResultResponse(fixture))
      );
      const agent = fixture.agent();
      await expect(
        agent.read(
          await agent.dispatch(
            "Report the existing receipt and file. Do not write again."
          )
        )
      ).resolves.toMatchObject({ text: fixture.checkpoint });
      const smallRequests = fixture.requests.filter(
        (request) => request.model === "small"
      );
      const summaries = smallRequests.filter(
        (request) => request.purpose === "compaction"
      );
      expect(summaries.length).toBeGreaterThan(1);
      expect(
        smallRequests.every(
          (request) => request.estimatedTokens <= SMALL_INPUT_BUDGET
        )
      ).toBe(true);
      const source = summaries
        .map((request) => JSON.stringify(request.context))
        .join("\n");
      expect(source).toContain("FIRST-OBSERVATION");
      expect(source).toContain("FIRST-OBSERVATION-END");
      for (const request of summaries) {
        const input = userTexts(request.context).join("\n");
        expect(input).toMatch(HISTORICAL_ROLE_LABEL);
        // UTF-8 replaces an isolated UTF-16 surrogate. A round trip must keep
        // every character sent to the summarizer, including at chunk edges.
        expect(new TextDecoder().decode(new TextEncoder().encode(input))).toBe(
          input
        );
      }
      if (shape === "large-tail") {
        expect(source).toContain("🧭");
      }
      expect(fixture.compactions).toEqual([false]);
      const mainContext = JSON.stringify(
        smallRequests.at(-1)?.context.messages
      );
      expect(mainContext).toContain(RECEIPT);
      expect(mainContext).toContain(fixture.artifactPath);
      expect(mainContext).toContain(fixture.digest);
      expect(await fixture.readSavedResult()).toEqual(
        fixture.expectedSavedResult
      );

      await fixture.restart();
      const restored = fixture.agent();
      await expect(restored.read(original.receipt)).resolves.toMatchObject({
        text: original.reply.text,
      });
      fixture.setResponses([savedResultResponse(fixture)]);
      await expect(
        restored.read(
          await restored.dispatch(
            "Continue from the existing receipt. Do not write again."
          )
        )
      ).resolves.toMatchObject({ text: fixture.checkpoint });
      expect(
        JSON.stringify(fixture.requests.at(-1)?.context.messages)
      ).toContain(fixture.digest);
      expect(await fixture.readSavedResult()).toEqual(
        fixture.expectedSavedResult
      );
    } finally {
      await fixture.dispose();
    }
  });

  it("rewrites an oversized saved checkpoint when only short messages follow it", async () => {
    const fixture = await createFixture({
      workingContextTokens: 9000,
      maxWorkingContextTokens: 12_000,
      reserveTokens: 10_000,
      maxSummaryTokens: 8000,
    });
    try {
      const original = await seedHistory(fixture, "large-tail");
      const oversizedCheckpoint = `${fixture.checkpoint}\nCHECKPOINT-BEGIN. ${"Preserved historical observations. 🧭".repeat(700)} CHECKPOINT-END.`;
      const shortReply = "The recorded result remains available.";
      fixture.setResponses([
        (context) => {
          expect(getRemoteAgentModelPurpose()).toBe("compaction");
          expect(JSON.stringify(context.messages)).toContain(fixture.digest);
          return fauxAssistantMessage(oversizedCheckpoint);
        },
        fauxAssistantMessage(shortReply),
      ]);
      const agent = fixture.agent();
      const checkpointSubmission = await agent.dispatch("Keep the result.");
      await expect(agent.read(checkpointSubmission)).resolves.toMatchObject({
        text: shortReply,
      });
      expect(fixture.compactions).toEqual([false]);
      expect(
        JSON.stringify(fixture.requests.at(-1)?.context.messages)
      ).toContain("CHECKPOINT-END");

      fixture.selectModel("small");
      fixture.setResponses(
        Array.from({ length: 24 }, () => savedResultResponse(fixture))
      );
      await expect(
        agent.read(await agent.dispatch("Report the saved result."))
      ).resolves.toMatchObject({ text: fixture.checkpoint });
      const smallRequests = fixture.requests.filter(
        (request) => request.model === "small"
      );
      const summaries = smallRequests.filter(
        (request) => request.purpose === "compaction"
      );
      expect(summaries.length).toBeGreaterThan(1);
      expect(
        smallRequests.every(
          (request) => request.estimatedTokens <= SMALL_INPUT_BUDGET
        )
      ).toBe(true);
      const source = summaries
        .map((request) => userTexts(request.context).join("\n"))
        .join("\n");
      expect(source).toContain("CHECKPOINT-BEGIN");
      expect(source).toContain("CHECKPOINT-END");
      for (const request of summaries) {
        const input = userTexts(request.context).join("\n");
        expect(input).toContain("[Historical previous-checkpoint ");
        expect(new TextDecoder().decode(new TextEncoder().encode(input))).toBe(
          input
        );
      }
      expect(fixture.compactions).toEqual([false, false]);
      expect(await fixture.readSavedResult()).toEqual(
        fixture.expectedSavedResult
      );

      await fixture.restart();
      const restored = fixture.agent();
      await expect(restored.read(original.receipt)).resolves.toMatchObject({
        text: original.reply.text,
      });
      await expect(restored.read(checkpointSubmission)).resolves.toMatchObject({
        text: shortReply,
      });
      fixture.setResponses([savedResultResponse(fixture)]);
      await expect(
        restored.read(await restored.dispatch("Report the receipt and hash."))
      ).resolves.toMatchObject({ text: fixture.checkpoint });
      expect(await fixture.readSavedResult()).toEqual(
        fixture.expectedSavedResult
      );
    } finally {
      await fixture.dispose();
    }
  });

  it("rejects an oversized active input without replacing it and preserves it for a larger-model follow-up", async () => {
    const fixture = await createFixture();
    const original = `ACTIVE-AUTHORITY-519. ${"Required current evidence. ".repeat(1500)} NO DEPLOYMENT.`;
    try {
      await seedHistory(fixture, "large-tail");
      fixture.selectModel("small");
      fixture.setResponses(
        Array.from({ length: 24 }, () => savedResultResponse(fixture))
      );
      const agent = fixture.agent();
      await expect(agent.read(await agent.dispatch(original))).rejects.toThrow(
        "Agent run failed"
      );
      expect(
        fixture.requests.filter(
          (request) => request.model === "small" && request.purpose === "agent"
        )
      ).toEqual([]);
      expect(await fixture.readSavedResult()).toEqual(
        fixture.expectedSavedResult
      );

      await fixture.restart();
      fixture.selectModel("large");
      fixture.setResponses([
        (context) => {
          expect(
            userTexts(context).filter((text) => text === original)
          ).toHaveLength(1);
          expect(JSON.stringify(context.messages)).toContain(RECEIPT);
          return fauxAssistantMessage(fixture.checkpoint);
        },
      ]);
      const restored = fixture.agent();
      await expect(
        restored.read(
          await restored.dispatch(
            "Report the earlier request's receipt only. Do not execute it."
          )
        )
      ).resolves.toMatchObject({ text: fixture.checkpoint });
      expect(await fixture.readSavedResult()).toEqual(
        fixture.expectedSavedResult
      );
    } finally {
      await fixture.dispose();
    }
  });

  it("keeps the original history when a later summary chunk fails, including after SQLite restart", async () => {
    const fixture = await createFixture();
    try {
      await seedHistory(fixture, "long-history");
      fixture.selectModel("small");
      let summaryCalls = 0;
      fixture.setResponses(
        Array.from(
          { length: 24 },
          (): FauxResponseFactory => () => {
            expect(getRemoteAgentModelPurpose()).toBe("compaction");
            summaryCalls++;
            return summaryCalls === 1
              ? fauxAssistantMessage(
                  `${SUMMARY_FAILURE_MARKER}. ${fixture.checkpoint}`
                )
              : fauxAssistantMessage("", {
                  stopReason: "error",
                  errorMessage: "Permanent summary rejection",
                });
          }
        )
      );
      const agent = fixture.agent();
      await expect(
        agent.read(
          await agent.dispatch("Report the saved result. Do not write again.")
        )
      ).rejects.toThrow("Agent run failed");
      expect(summaryCalls).toBeGreaterThan(1);
      expect(fixture.compactions.every((failed) => failed)).toBe(true);
      expect(await fixture.readSavedResult()).toEqual(
        fixture.expectedSavedResult
      );

      await fixture.restart();
      fixture.selectModel("large");
      fixture.setResponses([
        (context) => {
          const history = JSON.stringify(context.messages);
          expect(history).toContain("FIRST-OBSERVATION-END");
          expect(history).toContain("SECOND-OBSERVATION-END");
          expect(history).toContain("THIRD-OBSERVATION-END");
          expect(history).toContain(fixture.digest);
          expect(history).not.toContain(SUMMARY_FAILURE_MARKER);
          return fauxAssistantMessage(fixture.checkpoint);
        },
      ]);
      const restored = fixture.agent();
      await expect(
        restored.read(
          await restored.dispatch(
            "Report the existing receipt. Do not repeat the write."
          )
        )
      ).resolves.toMatchObject({ text: fixture.checkpoint });
      expect(await fixture.readSavedResult()).toEqual(
        fixture.expectedSavedResult
      );
    } finally {
      await fixture.dispose();
    }
  });
});
