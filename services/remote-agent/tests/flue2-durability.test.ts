import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
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
