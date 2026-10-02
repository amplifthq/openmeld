import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxProvider } from "@earendil-works/pi-ai";
import { observe, useModel } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { expect, it, vi } from "vitest";

it("keeps later work blocked until its earlier same-conversation submission is natively settled", async () => {
  const database = sqlite();
  await database.migrate?.();
  const { submissionStore: store } = await database.connect();
  try {
    for (const submissionId of [
      "unknown-head",
      "later-work",
      "other-conversation",
    ]) {
      await store.admitDispatch({
        submissionId,
        agent: "Unready",
        id:
          submissionId === "other-conversation"
            ? "independent"
            : "same-conversation",
        acceptedAt: new Date().toISOString(),
        message: { kind: "user", body: "Read the authorized input." },
      });
      await store.markSubmissionCanonicalReady(submissionId);
    }
    expect(
      (await store.listRunnableSubmissions()).map((row) => row.submissionId)
    ).toEqual(["unknown-head", "other-conversation"]);
    await expect(
      store.claimSubmission({
        submissionId: "later-work",
        attemptId: "later-attempt",
        ownerId: "native-owner",
        leaseExpiresAt: Date.now() + 60_000,
      })
    ).resolves.toBeNull();
    // An exact native terminal outcome releases the queue. Core's unavailable
    // reconciliation must not manufacture this transition from elapsed time.
    await expect(
      store.settleQueuedSubmission(
        "unknown-head",
        "aborted",
        new Error("Native owner confirmed Stop.")
      )
    ).resolves.toBe(true);
    expect(
      (await store.listRunnableSubmissions()).map((row) => row.submissionId)
    ).toEqual(["later-work", "other-conversation"]);
    await expect(
      store.claimSubmission({
        submissionId: "later-work",
        attemptId: "later-attempt",
        ownerId: "native-owner",
        leaseExpiresAt: Date.now() + 60_000,
      })
    ).resolves.toMatchObject({ status: "running", submissionId: "later-work" });
  } finally {
    await database.close?.();
  }
});

it("bounds failed queued preparation without a wall-clock deadline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flue-unready-recovery-"));
  const file = join(directory, "runtime.sqlite");
  const seed = sqlite(file);
  await seed.migrate?.();
  const seeded = await seed.connect();
  await seeded.submissionStore.admitDispatch({
    submissionId: "unready-input",
    agent: "Unready",
    id: "same-conversation",
    acceptedAt: new Date().toISOString(),
    message: { kind: "user", body: "Read the authorized input." },
  });
  await seed.close?.();
  const provider = fauxProvider({ provider: "preparation-recovery" });
  const model = provider.getModel();
  function Unready() {
    useModel(`${model.provider}/${model.id}`);
    return "Do not execute before preparation succeeds.";
  }
  Unready.durability = { maxAttempts: 2, timeoutMs: 0 };
  const backing = sqlite(file);
  const failedReadyWrite = vi
    .fn<() => Promise<never>>()
    .mockRejectedValue(new Error("Controlled canonical-ready write failure."));
  const settlements: string[] = [];
  const unsubscribe = observe((event) => {
    if (
      event.type === "submission_settled" &&
      event.submissionId === "unready-input"
    ) {
      settlements.push(event.outcome);
    }
  });
  const runtime = await start({
    agents: [Unready],
    providers: [provider.provider],
    db: {
      migrate: () => backing.migrate?.(),
      close: () => backing.close?.(),
      connect: async () => {
        const stores = await backing.connect();
        // Keep the real vendor stores. Only the final materialization write
        // fails, reproducing a queued row that never becomes claimable.
        stores.submissionStore.markSubmissionCanonicalReady = failedReadyWrite;
        return stores;
      },
    },
  });
  const inspector = new DatabaseSync(file, { readOnly: true });
  try {
    await expect
      .poll(() =>
        inspector
          .prepare(
            "SELECT status, attempt_count, max_attempts FROM flue_agent_submissions WHERE submission_id = ?"
          )
          .get("unready-input")
      )
      .toEqual({
        status: "settled",
        attempt_count: 2,
        max_attempts: 2,
      });
    expect(failedReadyWrite).toHaveBeenCalledTimes(2);
    expect(provider.state.callCount).toBe(0);
    expect(settlements).toEqual(["failed"]);
  } finally {
    await runtime.stop();
    inspector.close();
    unsubscribe();
    await rm(directory, { recursive: true, force: true });
  }
});

it("fences repeated preparation failure reports against ready, stale, and terminal rows", async () => {
  const database = sqlite();
  await database.migrate?.();
  const { submissionStore: store } = await database.connect();
  const fail = store.recordSubmissionPreparationFailure?.bind(store);
  expect(fail).toBeTypeOf("function");
  if (!fail) {
    throw new Error("Pinned SQL preparation seam is missing.");
  }
  try {
    for (const submissionId of ["ready", "exhausted", "stopping"]) {
      await store.admitDispatch({
        submissionId,
        agent: "Unready",
        id: submissionId,
        acceptedAt: new Date().toISOString(),
        message: { kind: "user", body: "Read this input." },
      });
    }
    const error = new Error("Preparation failed.");
    const stopping = await store.getSubmission("stopping");
    if (!stopping) {
      throw new Error("Missing admitted stop fixture.");
    }
    await store.requestSessionAbort(stopping.sessionKey);
    expect(await fail("stopping", 0, 1, error, true)).toBeNull();
    expect(await store.getSubmission("stopping")).toMatchObject({
      status: "queued",
      attemptCount: 0,
      abortRequestedAt: expect.any(Number),
    });
    expect(await fail("ready", 0, 2, error)).toMatchObject({
      attemptCount: 1,
      status: "queued",
    });
    expect(await fail("ready", 0, 2, error)).toBeNull();
    await store.markSubmissionCanonicalReady("ready");
    expect(await fail("ready", 1, 2, error, true)).toBeNull();
    expect(await store.getSubmission("ready")).toMatchObject({
      status: "queued",
      attemptCount: 1,
    });

    expect(await fail("exhausted", 0, 2, error)).toMatchObject({
      status: "queued",
      attemptCount: 1,
    });
    const winners = await Promise.all([
      fail("exhausted", 1, 2, error),
      fail("exhausted", 1, 2, error),
    ]);
    expect(winners.filter(Boolean)).toHaveLength(1);
    expect(await store.getSubmission("exhausted")).toMatchObject({
      status: "settled",
      attemptCount: 2,
      error: "Preparation failed.",
    });
    expect(await fail("exhausted", 2, 2, new Error("Late error"))).toBeNull();
    expect(await fail("missing", 0, 2, error)).toBeNull();
  } finally {
    await database.close?.();
  }
});
