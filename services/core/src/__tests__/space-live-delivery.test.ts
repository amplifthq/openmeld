import { describe, expect, it } from "vitest";
import {
  type SpaceLiveAccessDecision,
  SpaceLiveDelivery,
  type SpaceLiveDeliveryClosure,
  type SpaceLiveDeliveryTarget,
} from "../space/transport/do/space-live-delivery";

type TestSession = { name: string; quit?: boolean };

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

const transientError = new Error(
  "core.organization_context.membership_lookup_failed: timeout exceeded when trying to connect"
);

function createHarness(input: {
  authorize: (
    session: TestSession,
    attempt: number
  ) => Promise<SpaceLiveAccessDecision>;
}) {
  const delivered = new Map<string, string[]>();
  const closed = new Map<string, SpaceLiveDeliveryClosure>();
  const authorizeStarts: { session: string; enqueuedBefore: number }[] = [];
  const attempts = new Map<string, number>();
  const drains: Promise<void>[] = [];
  let enqueued = 0;
  const delivery = new SpaceLiveDelivery<TestSession, string>({
    authorize: (session) => {
      const attempt = (attempts.get(session.name) ?? 0) + 1;
      attempts.set(session.name, attempt);
      authorizeStarts.push({ session: session.name, enqueuedBefore: enqueued });
      return input.authorize(session, attempt);
    },
    close: (target, closure) => {
      target.session.quit = true;
      closed.set(target.session.name, closure);
    },
    deliver: (target, messages) => {
      delivered.set(target.session.name, [
        ...(delivered.get(target.session.name) ?? []),
        ...messages,
      ]);
    },
    isActive: (target) => !target.session.quit,
    retryDelayMs: 500,
    sleep: async () => undefined,
    waitUntil: (promise) => {
      drains.push(promise);
    },
  });
  const targets = (...sessions: TestSession[]) =>
    sessions.map(
      (session): SpaceLiveDeliveryTarget<TestSession> => ({
        session,
        webSocket: {} as WebSocket,
      })
    );
  return {
    attempts,
    authorizeStarts,
    closed,
    delivered,
    enqueue: (sessions: TestSession[], message: string) => {
      enqueued += 1;
      delivery.enqueue(targets(...sessions), message);
    },
    settle: async () => {
      while (drains.length > 0) {
        await Promise.all(drains.splice(0));
      }
    },
  };
}

describe("Space live delivery", () => {
  it("keeps every other session open when one access check cannot reach its evidence", async () => {
    const alice: TestSession = { name: "alice" };
    const bob: TestSession = { name: "bob" };
    const harness = createHarness({
      authorize: (session) =>
        session === bob
          ? Promise.reject(transientError)
          : Promise.resolve("authorized"),
    });

    harness.enqueue([alice, bob], "wake.progress.changed#1");
    harness.enqueue([alice, bob], "wake.progress.changed#2");
    await harness.settle();

    expect(harness.delivered.get("alice")).toEqual([
      "wake.progress.changed#1",
      "wake.progress.changed#2",
    ]);
    expect(alice.quit).toBeUndefined();
    // Fail closed for the unverified session only: nothing is delivered, and
    // the retryable close sends it through the full reconnect check.
    expect(harness.delivered.get("bob")).toBeUndefined();
    expect(harness.closed.get("bob")).toMatchObject({
      code: 1013,
      reason: "space_access_unverified",
      error: transientError,
    });
    expect(harness.closed.has("alice")).toBe(false);
  });

  it("delivers withheld messages after one retried access check succeeds", async () => {
    const alice: TestSession = { name: "alice" };
    const harness = createHarness({
      authorize: (_session, attempt) =>
        attempt === 1
          ? Promise.reject(transientError)
          : Promise.resolve("authorized"),
    });

    harness.enqueue([alice], "wake.progress.changed#1");
    harness.enqueue([alice], "wake.progress.changed#2");
    await harness.settle();

    expect(harness.attempts.get("alice")).toBe(2);
    expect(harness.closed.size).toBe(0);
    expect(harness.delivered.get("alice")).toEqual([
      "wake.progress.changed#1",
      "wake.progress.changed#2",
    ]);
  });

  it("revokes a session whose current access is denied without delivering", async () => {
    const departed: TestSession = { name: "departed" };
    const member: TestSession = { name: "member" };
    const harness = createHarness({
      authorize: (session) =>
        Promise.resolve(session === departed ? "denied" : "authorized"),
    });

    harness.enqueue([departed, member], "space.meta.changed");
    await harness.settle();

    expect(harness.delivered.get("departed")).toBeUndefined();
    expect(harness.closed.get("departed")).toEqual({
      code: 1008,
      reason: "space_access_changed",
    });
    expect(harness.delivered.get("member")).toEqual(["space.meta.changed"]);
    expect(harness.attempts.get("departed")).toBe(1);
  });

  it("never delivers a message under an access check that started before it was queued", async () => {
    const alice: TestSession = { name: "alice" };
    const checks: Deferred<SpaceLiveAccessDecision>[] = [];
    const harness = createHarness({
      authorize: () => {
        const check = deferred<SpaceLiveAccessDecision>();
        checks.push(check);
        return check.promise;
      },
    });

    harness.enqueue([alice], "delta#1");
    for (let index = 2; index <= 50; index += 1) {
      harness.enqueue([alice], `delta#${index}`);
    }
    harness.enqueue([alice], "wake.progress.changed");
    expect(checks).toHaveLength(1);
    // Access is revoked while the first check is still in flight; the first
    // check already read the old answer.
    checks[0]?.resolve("authorized");
    await flushMicrotasks();
    expect(checks).toHaveLength(2);
    checks[1]?.resolve("denied");
    await harness.settle();

    // Only the message queued before the first check started was delivered.
    expect(harness.delivered.get("alice")).toEqual(["delta#1"]);
    expect(harness.closed.get("alice")?.code).toBe(1008);
    expect(harness.authorizeStarts).toEqual([
      { session: "alice", enqueuedBefore: 1 },
      { session: "alice", enqueuedBefore: 51 },
    ]);
  });

  it("authorizes a queued burst once so invalidations do not wait behind each stream delta", async () => {
    const alice: TestSession = { name: "alice" };
    const checks: Deferred<SpaceLiveAccessDecision>[] = [];
    const harness = createHarness({
      authorize: () => {
        const check = deferred<SpaceLiveAccessDecision>();
        checks.push(check);
        return check.promise;
      },
    });

    harness.enqueue([alice], "delta#1");
    for (let index = 2; index <= 50; index += 1) {
      harness.enqueue([alice], `delta#${index}`);
    }
    harness.enqueue([alice], "wake.progress.changed");
    checks[0]?.resolve("authorized");
    await flushMicrotasks();
    checks[1]?.resolve("authorized");
    await harness.settle();

    expect(checks).toHaveLength(2);
    expect(harness.delivered.get("alice")).toEqual([
      ...Array.from({ length: 50 }, (_, index) => `delta#${index + 1}`),
      "wake.progress.changed",
    ]);
  });

  it("does not hold other sessions behind one slow access check", async () => {
    const slow: TestSession = { name: "slow" };
    const fast: TestSession = { name: "fast" };
    const slowCheck = deferred<SpaceLiveAccessDecision>();
    const harness = createHarness({
      authorize: (session) =>
        session === slow ? slowCheck.promise : Promise.resolve("authorized"),
    });

    harness.enqueue([slow, fast], "signal#1");
    harness.enqueue([slow, fast], "signal#2");
    await flushMicrotasks();

    expect(harness.delivered.get("fast")).toEqual(["signal#1", "signal#2"]);
    expect(harness.delivered.get("slow")).toBeUndefined();
    slowCheck.resolve("authorized");
    await harness.settle();
    expect(harness.delivered.get("slow")).toEqual(["signal#1", "signal#2"]);
  });
});
