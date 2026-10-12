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
  useAgentStart,
  useModel,
  useTool,
} from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { object } from "valibot";
import { describe, expect, it, vi } from "vitest";

describe("Flue 2 OpenMeld durability contracts", () => {
  it.each([
    "tool_batch",
    "steered_input",
  ] as const)("recovers %s after same-execution steering without replaying tools or losing input", async (boundary) => {
    const directory = await mkdtemp(join(tmpdir(), "flue-steering-recovery-"));
    const original = join(directory, "original.sqlite");
    const snapshot = join(directory, "interrupted.sqlite");
    const captured = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const provider = fauxProvider({
      provider: "steering-recovery",
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    const model = provider.getModel();
    let correction: AgentSteeringInput | undefined;
    let steeringReady = false;
    let recovery = false;
    const completedWork = vi.fn(() => ({ output: "Saved result: Cedar 200." }));
    const capture = () => {
      const sql = new DatabaseSync(original);
      try {
        // Capture committed runtime records without rewriting their contents.
        sql.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`);
      } finally {
        sql.close();
      }
      captured.resolve();
    };
    const unfinishedWork = vi.fn(async () => {
      // This tool's real outcome has not been persisted in the snapshot.
      capture();
      await release.promise;
      return { output: "Original owner returned." };
    });
    const saved = defineTool({
      name: "save_record",
      description: "Save the selected record once.",
      input: object({}),
      run: completedWork,
    });
    const waiting = defineTool({
      name: "inspect_record",
      description: "Inspect the saved record.",
      input: object({}),
      run: unfinishedWork,
    });
    function Recovery() {
      useModel(`${model.provider}/${model.id}`);
      useTool(saved);
      useTool(waiting);
      return recovery
        ? "Preserve saved records. Explain any interrupted inspection."
        : "Save the selected record and inspect it.";
    }
    Recovery.durability = { maxAttempts: 5, timeoutMs: 0 };
    Recovery.joinQueuedDeliveries = false;
    Recovery.steeringSource = (submissionId: string) => ({
      claim: () => {
        if (!steeringReady) {
          return Promise.resolve([]);
        }
        correction ??= {
          targetSubmissionId: submissionId,
          status: "joining",
          input: {
            kind: "dispatch",
            submissionId: "same-execution-check-in",
            agent: "Recovery",
            id: "steered-recovery",
            acceptedAt: new Date().toISOString(),
            message: { kind: "user", body: "Keep the saved Cedar record." },
          },
        };
        return Promise.resolve(
          correction.status === "joining" ? [correction] : []
        );
      },
      listUnresolved: async () => (correction ? [correction] : []),
      finalize: async () => {
        if (correction) {
          correction.status = "joined";
        }
        if (!recovery && boundary === "steered_input") {
          // The check-in is canonical and acknowledged; its answering model
          // turn has not started. The previous assistant cannot answer it.
          capture();
          await release.promise;
        }
      },
      revert: async () => undefined,
    });
    provider.setResponses([
      () => {
        steeringReady = true;
        return boundary === "tool_batch"
          ? fauxAssistantMessage(fauxToolCall("save_record", {}), {
              stopReason: "toolUse",
            })
          : fauxAssistantMessage("The earlier answer was Cedar.");
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Keep the saved Cedar record."
        );
        return boundary === "tool_batch"
          ? fauxAssistantMessage(fauxToolCall("inspect_record", {}), {
              stopReason: "toolUse",
            })
          : fauxAssistantMessage("Original owner finished.");
      },
      fauxAssistantMessage("Original owner finished."),
    ]);
    let runtime = await start({
      agents: [Recovery],
      db: sqlite(original),
      providers: [provider.provider],
    });
    const realNow = Date.now.bind(Date);
    const clock = vi.spyOn(Date, "now");
    try {
      const agent = init(Recovery, { id: "steered-recovery" });
      const receipt = await agent.dispatch("Save Cedar, then inspect it.");
      const originalResult = agent.read(receipt);
      await Promise.race([
        captured.promise,
        originalResult.then(() => {
          throw new Error(
            "Submission settled before the interrupted boundary."
          );
        }),
      ]);
      expect(correction?.status).toBe("joined");
      release.resolve();
      await originalResult;
      await runtime.stop();
      recovery = true;
      clock.mockImplementation(() => realNow() + 120_000);
      provider.setResponses([
        (context) => {
          const messages = JSON.stringify(context.messages);
          expect(messages).toContain("Keep the saved Cedar record.");
          if (boundary === "tool_batch") {
            expect(messages).toContain("Saved result: Cedar 200.");
            expect(messages).toContain("The outcome is unknown.");
          } else {
            expect(messages).toContain("The earlier answer was Cedar.");
          }
          return fauxAssistantMessage(
            "The resumed response addresses the check-in."
          );
        },
        fauxAssistantMessage("Cedar remains saved."),
      ]);
      runtime = await start({
        agents: [Recovery],
        db: sqlite(snapshot),
        providers: [provider.provider],
      });
      const replacement = init(Recovery, { id: "steered-recovery" });
      expect((await replacement.read(receipt)).text).toBe(
        `${boundary === "steered_input" ? "The earlier answer was Cedar.\n\n" : ""}The resumed response addresses the check-in.`
      );
      expect(completedWork).toHaveBeenCalledTimes(
        boundary === "tool_batch" ? 1 : 0
      );
      expect(unfinishedWork).toHaveBeenCalledTimes(
        boundary === "tool_batch" ? 1 : 0
      );
      // A later independent submission must remain usable and distinct.
      correction = undefined;
      Recovery.steeringSource = () => ({
        claim: async () => [],
        listUnresolved: async () => [],
        finalize: async () => undefined,
        revert: async () => undefined,
      });
      expect(
        (
          await replacement.read(
            await replacement.dispatch("Confirm the record.")
          )
        ).text
      ).toBe("Cedar remains saved.");
    } finally {
      release.resolve();
      await runtime.stop();
      clock.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    false,
    true,
  ])("applies only exact-execution steering without admitting another execution (foreign target: %s)", async (foreignTarget) => {
    const provider = fauxProvider({
      provider: "exact-steering",
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    const model = provider.getModel();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const operation = defineTool({
      name: "wait_for_records",
      description: "Read the requested records.",
      input: object({}),
      run: async () => {
        entered.resolve();
        await release.promise;
        return { output: "North America: 100; Europe: 200" };
      },
    });
    const agentStarted = vi.fn();
    function Steered() {
      useModel(`${model.provider}/${model.id}`);
      useTool(operation);
      useAgentStart(agentStarted);
      return "Apply the user's latest scope to the records.";
    }
    Steered.joinQueuedDeliveries = false;
    let correction:
      | {
          targetSubmissionId: string;
          status: "joining" | "joined";
          input: {
            kind: "dispatch";
            submissionId: string;
            agent: string;
            id: string;
            acceptedAt: string;
            message: { kind: "user"; body: string };
          };
        }
      | undefined;
    const applied = vi.fn();
    Steered.steeringSource = (submissionId: string) => ({
      claim: async () =>
        correction &&
        (foreignTarget || correction.targetSubmissionId === submissionId) &&
        correction.status === "joining"
          ? [correction]
          : [],
      listUnresolved: async () =>
        correction?.targetSubmissionId === submissionId ? [correction] : [],
      finalize: (inputId: string) => {
        expect(inputId).toBe(correction?.input.submissionId);
        if (correction) {
          correction.status = "joined";
        }
        applied();
        return Promise.resolve();
      },
      revert: async () => undefined,
    });
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("wait_for_records", {}), {
        stopReason: "toolUse",
      }),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Only analyze North America."
        );
        return fauxAssistantMessage("North America total: 100.");
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Only analyze North America."
        );
        return fauxAssistantMessage("The previous scope was North America.");
      },
    ]);
    const runtime = await start({
      agents: [Steered],
      providers: [provider.provider],
    });
    try {
      const agent = init(Steered, { id: "one-steered-conversation" });
      const receipt = await agent.dispatch("Read and total all the records.");
      await entered.promise;
      correction = {
        targetSubmissionId: foreignTarget
          ? "another-execution"
          : receipt.submissionId,
        status: "joining",
        input: {
          kind: "dispatch",
          submissionId: "steering-input-one",
          agent: "Steered",
          id: "one-steered-conversation",
          acceptedAt: new Date().toISOString(),
          message: { kind: "user", body: "Only analyze North America." },
        },
      };
      release.resolve();
      if (foreignTarget) {
        await expect(agent.read(receipt)).rejects.toMatchObject({
          outcome: "failed",
          submissionId: receipt.submissionId,
        });
        expect(applied).not.toHaveBeenCalled();
        expect(agentStarted).toHaveBeenCalledTimes(1);
        return;
      }
      expect((await agent.read(receipt)).text).toBe(
        "North America total: 100."
      );
      expect(applied).toHaveBeenCalledTimes(1);
      expect(agentStarted).toHaveBeenCalledTimes(1);
      expect(
        (await agent.read(await agent.dispatch("What was the scope?"))).text
      ).toBe("The previous scope was North America.");
      expect(applied).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
      await runtime.stop();
    }
  });

  it("keeps independently admitted turns and their completions separate while one is running", async () => {
    const provider = fauxProvider({
      provider: "separate-deliveries",
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    const model = provider.getModel();
    function Separate() {
      useModel(`${model.provider}/${model.id}`);
      return "Answer each admitted request under its own execution.";
    }
    Separate.joinQueuedDeliveries = false;
    const entered = Promise.withResolvers<void>();
    const release =
      Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
    provider.setResponses([
      () => {
        entered.resolve();
        return release.promise;
      },
      fauxAssistantMessage("Second completion."),
    ]);
    const runtime = await start({
      agents: [Separate],
      providers: [provider.provider],
    });
    try {
      const agent = init(Separate, { id: "one-conversation" });
      const first = await agent.dispatch("First independent request.");
      await entered.promise;
      const second = await agent.dispatch("Second independent request.");
      release.resolve(fauxAssistantMessage("First completion."));
      expect((await agent.read(first)).text).toBe("First completion.");
      expect((await agent.read(second)).text).toBe("Second completion.");
    } finally {
      release.resolve(fauxAssistantMessage("First completion."));
      await runtime.stop();
    }
  });

  it("retains unpublished tool choices in the same session across a runtime replacement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openmeld-flue2-"));
    const database = join(directory, "runtime.sqlite");
    const provider = fauxProvider({
      provider: "continuity",
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    const model = provider.getModel();
    let lookupCount = 0;
    const shortlist = defineTool({
      name: "shortlist",
      description:
        "Return the two shortlisted records in their original order.",
      input: object({}),
      run: () => {
        lookupCount += 1;
        return {
          output: [
            { id: "record-193", name: "Northstar" },
            { id: "record-807", name: "Cedar" },
          ],
        };
      },
    });
    function Continuity() {
      useModel(`${model.provider}/${model.id}`);
      useTool(shortlist);
      return "Preserve the choices in this conversation.";
    }
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("shortlist", {}), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Two options are ready for your decision."),
    ]);
    let runtime = await start({
      agents: [Continuity],
      db: sqlite(database),
      providers: [provider.provider],
    });
    try {
      const first = init(Continuity, { id: "same-session" });
      await first.read(
        await first.dispatch("Keep two choices for my decision.")
      );
      await runtime.stop();
      provider.setResponses([
        (context) => {
          const modelContext = JSON.stringify(context.messages);
          expect(modelContext).toContain("record-193");
          expect(modelContext).toContain("record-807");
          expect(modelContext.indexOf("record-193")).toBeLessThan(
            modelContext.indexOf("record-807")
          );
          expect(JSON.stringify(context.messages)).toContain(
            "Choose the second one."
          );
          return fauxAssistantMessage("Cedar, record-807, selected.");
        },
      ]);
      runtime = await start({
        agents: [Continuity],
        db: sqlite(database),
        providers: [provider.provider],
      });
      const second = init(Continuity, { id: "same-session" });
      expect(
        (await second.read(await second.dispatch("Choose the second one.")))
          .text
      ).toContain("Cedar");
      expect(lookupCount).toBe(1);
    } finally {
      await runtime.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not terminate healthy work at the default one-hour wall-clock limit", async () => {
    const provider = fauxProvider({
      provider: "no-deadline",
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    const model = provider.getModel();
    const realNow = Date.now.bind(Date);
    const clock = vi.spyOn(Date, "now");
    const longWork = defineTool({
      name: "long_work",
      description: "Complete a healthy long-running operation.",
      input: object({}),
      run: () => {
        clock.mockImplementation(() => realNow() + 2 * 60 * 60 * 1000);
        return { output: "Operation completed." };
      },
    });
    function LongWork() {
      useModel(`${model.provider}/${model.id}`);
      useTool(longWork);
      return "Complete the operation and report its result.";
    }
    LongWork.durability = { maxAttempts: 5, timeoutMs: 0 };
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("long_work", {}), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Work completed after two hours."),
    ]);
    const runtime = await start({
      agents: [LongWork],
      providers: [provider.provider],
    });
    try {
      const agent = init(LongWork, { id: "long-work" });
      expect(
        (await agent.read(await agent.dispatch("Run the operation."))).text
      ).toContain("completed");
    } finally {
      clock.mockRestore();
      await runtime.stop();
    }
  });

  it("records stop intent for only the named submission, including a late stop", async () => {
    const database = sqlite();
    await database.migrate?.();
    const { submissionStore } = await database.connect();
    const store = submissionStore as typeof submissionStore & {
      requestSubmissionAbort(submissionId: string): Promise<boolean>;
    };
    try {
      for (const submissionId of ["first", "second"]) {
        await store.admitDispatch({
          submissionId,
          agent: "Center",
          id: "session",
          acceptedAt: new Date().toISOString(),
          message: { kind: "user", body: submissionId },
        });
      }
      expect(await store.requestSubmissionAbort("first")).toBe(true);
      expect((await store.getSubmission("first"))?.abortRequestedAt).toEqual(
        expect.any(Number)
      );
      expect(
        (await store.getSubmission("second"))?.abortRequestedAt
      ).toBeUndefined();
      await store.settleQueuedSubmission("first", "aborted", undefined);
      expect(await store.requestSubmissionAbort("first")).toBe(false);
      expect(await store.requestSubmissionAbort("missing-old-submission")).toBe(
        false
      );
      expect(
        (await store.getSubmission("second"))?.abortRequestedAt
      ).toBeUndefined();
    } finally {
      await database.close?.();
    }
  });
});
