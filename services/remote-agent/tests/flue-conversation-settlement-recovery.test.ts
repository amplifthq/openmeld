import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { init, instrument, observe, useModel } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { expect, it, vi } from "vitest";
import {
  getRemoteAgentExecutionSubmissionId,
  REMOTE_AGENT_EXECUTION_INSTRUMENTATION,
  registerRemoteAgentExecutionPreparation,
  requireRemoteAgentExecutionResources,
} from "../flue-adapter/execution-context";

it("repairs an interrupted assistant stream before continuing this session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flue-stream-recovery-"));
  const database = join(directory, "session.sqlite");
  const provider = fauxProvider({
    provider: "stream-recovery",
    tokensPerSecond: 20,
  });
  const model = provider.getModel();
  const disposeInstrumentation = instrument(
    REMOTE_AGENT_EXECUTION_INSTRUMENTATION
  );
  const restorePreparation = registerRemoteAgentExecutionPreparation(() => {
    const submissionId = getRemoteAgentExecutionSubmissionId();
    expect(submissionId).not.toBeNull();
    return Promise.resolve({ submissionId });
  });
  function Center() {
    const resources = requireRemoteAgentExecutionResources<{
      submissionId: string;
    }>();
    expect(resources.submissionId).toBe(getRemoteAgentExecutionSubmissionId());
    useModel(`${model.provider}/${model.id}`);
    return "Keep the user's exact choices across an interrupted response.";
  }
  Center.durability = { maxAttempts: 5, timeoutMs: 0 };
  const streamed = Promise.withResolvers<void>();
  const realNow = Date.now.bind(Date);
  const clock = vi.spyOn(Date, "now");
  const unsubscribe = observe((event) => {
    if (event.type === "text_delta") {
      streamed.resolve();
    }
  });
  provider.setResponses([
    fauxAssistantMessage("This is a partial answer. ".repeat(100)),
  ]);
  let runtime = await start({
    agents: [Center],
    db: sqlite(database),
    providers: [provider.provider],
  });
  try {
    const first = init(Center, { id: "same-session" });
    const receipt = await first.dispatch(
      "Remember these choices: first Northstar, second Cedar."
    );
    await streamed.promise;
    await runtime.stop();
    // A replacement Node coordinator can reclaim only an expired owner lease.
    clock.mockImplementation(() => realNow() + 120_000);
    provider.setResponses([
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("second Cedar");
        return fauxAssistantMessage("Cedar.");
      },
    ]);
    runtime = await start({
      agents: [Center],
      db: sqlite(database),
      providers: [provider.provider],
    });
    const replacement = init(Center, { id: "same-session" });
    expect((await replacement.read(receipt)).text).toContain("Cedar");
    provider.setResponses([
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("second Cedar");
        return fauxAssistantMessage("Cedar selected.");
      },
    ]);
    expect(
      (
        await replacement.read(
          await replacement.dispatch("Choose the second one.")
        )
      ).text
    ).toContain("Cedar");
  } finally {
    unsubscribe();
    await runtime.stop();
    clock.mockRestore();
    restorePreparation();
    await disposeInstrumentation();
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  "completed",
  "aborted",
  "exhausted",
  "preparation_failed",
] as const)("settles %s recovery from durable facts even when execution preparation is unavailable", async (mode) => {
  const directory = await mkdtemp(join(tmpdir(), "flue-terminal-recovery-"));
  const original = join(directory, "original.sqlite");
  const snapshot = join(directory, "interrupted.sqlite");
  const captured = Promise.withResolvers<void>();
  const provider = fauxProvider({
    provider: "terminal-recovery",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  let preparationUnavailable = false;
  let failedPreparations = 0;
  const dispose = instrument(REMOTE_AGENT_EXECUTION_INSTRUMENTATION);
  const restore = registerRemoteAgentExecutionPreparation(() => {
    if (preparationUnavailable) {
      failedPreparations += 1;
      throw new Error("Controlled execution-resource preparation failure.");
    }
    return Promise.resolve({
      submissionId: getRemoteAgentExecutionSubmissionId(),
    });
  });
  function Recovery() {
    requireRemoteAgentExecutionResources();
    useModel(`${model.provider}/${model.id}`);
    return "Return the durable answer without repeating external work.";
  }
  Recovery.durability = { maxAttempts: 5, timeoutMs: 0 };
  Recovery.joinQueuedDeliveries = false;
  let snapshotTaken = false;
  const unsubscribe = observe((event) => {
    const captureNow =
      mode === "completed"
        ? event.type === "operation" &&
          event.operationKind === "prompt" &&
          !event.isError
        : event.type === "text_delta";
    if (snapshotTaken || !captureNow) {
      return;
    }
    snapshotTaken = true;
    const sql = new DatabaseSync(original);
    try {
      // Capture a real committed runtime boundary, before its caller can
      // settle the operational row. No invented or rewritten Flue history.
      sql.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`);
      captured.resolve();
    } finally {
      sql.close();
    }
  });
  provider.setResponses([fauxAssistantMessage("The durable answer is Cedar.")]);
  let runtime = await start({
    agents: [Recovery],
    db: sqlite(original),
    providers: [provider.provider],
  });
  try {
    const receipt = await init(Recovery, { id: "same-execution" }).dispatch(
      "Choose Cedar."
    );
    await captured.promise;
    unsubscribe();
    await runtime.stop();
    const adapter = sqlite(snapshot);
    const { submissionStore } = await adapter.connect();
    let submission = await submissionStore.getSubmission(receipt.submissionId);
    expect(submission?.status).toBe("running");
    if (!submission?.attemptId) {
      throw new Error("Missing captured attempt.");
    }
    if (mode === "completed" || mode === "aborted") {
      const exactAbort = submissionStore as typeof submissionStore & {
        requestSubmissionAbort(submissionId: string): Promise<boolean>;
      };
      await exactAbort.requestSubmissionAbort(receipt.submissionId);
    }
    if (mode === "completed" || mode === "exhausted") {
      while (submission.attemptCount < 5) {
        if (!submission.attemptId) {
          throw new Error("Captured recovery lost its attempt identity.");
        }
        const replacement = await submissionStore.replaceSubmissionAttempt(
          {
            submissionId: receipt.submissionId,
            attemptId: submission.attemptId,
          },
          `captured_recovery_${submission.attemptCount + 1}`,
          { ownerId: "previous-owner", leaseExpiresAt: 1 }
        );
        if (!replacement?.attemptId) {
          throw new Error("Could not advance the captured attempt.");
        }
        submission = replacement;
      }
    }
    await adapter.close?.();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
    preparationUnavailable = true;
    const inspector = new DatabaseSync(snapshot, { readOnly: true });
    try {
      runtime = await start({
        agents: [Recovery],
        db: sqlite(snapshot),
        providers: [provider.provider],
      });
      await expect
        .poll(
          () =>
            inspector
              .prepare(
                "SELECT status FROM flue_agent_submissions WHERE submission_id = ?"
              )
              .get(receipt.submissionId)?.status
        )
        .toBe("settled");
      const read = init(Recovery, { id: "same-execution" }).read(receipt);
      if (mode === "completed") {
        await expect(read).resolves.toMatchObject({
          text: "The durable answer is Cedar.",
        });
      } else {
        await expect(read).rejects.toThrow();
      }
      expect(failedPreparations).toBe(mode === "preparation_failed" ? 1 : 0);
      preparationUnavailable = false;
      provider.setResponses([
        fauxAssistantMessage("A new independent answer."),
      ]);
      const next = init(Recovery, { id: "same-execution" });
      await expect(
        next.read(
          await next.dispatch("Continue with a new independent request.")
        )
      ).resolves.toMatchObject({ text: "A new independent answer." });
    } finally {
      await runtime.stop();
      inspector.close();
      clock.mockRestore();
    }
  } finally {
    unsubscribe();
    await runtime.stop();
    restore();
    await dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
