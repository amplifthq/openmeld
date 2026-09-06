import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { defineTool, init, useModel, useTool } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { object } from "valibot";
import { describe, expect, it, vi } from "vitest";

describe("Flue 2 OpenMeld durability contracts", () => {
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
