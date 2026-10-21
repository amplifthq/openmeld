import type { Profile, SignalEnvelope } from "@openmeld/protocol";
import { USER_TIME_ZONE_INTERACTIVE_PRIORITY_MS } from "@openmeld/schemas";
import { expect, it, vi } from "vitest";
import type { SignalTextBuildOptions } from "../src/space/application/space-signal-service";
import type { SignalPublishContext } from "../src/space/application/types";
import {
  handleWebSocketTextSignal,
  Space,
} from "../src/space/transport/do/space";
import {
  readUserTimeContext,
  recordUserTimeZoneObservation,
  resolveUserRequestTimeContext,
} from "../src/user-time-context/user-time-context-repository";
import { env } from "../test-support/worker-env";
import { createWorkerPostgresFixture } from "./postgresql.test-support";

const signalMethods = Space.prototype as unknown as {
  buildTextSignal(
    this: { spaceId: string; lastTimestamp: number },
    profile: Profile,
    text: string,
    options?: SignalTextBuildOptions
  ): SignalEnvelope;
  publishTextSignal(
    this: unknown,
    signal: SignalEnvelope,
    context?: SignalPublishContext
  ): Promise<void>;
};

it.each([
  ["dispatch", false],
  ["steer", false],
  ["dispatch", true],
  ["steer", true],
] as const)("freezes legacy WS %s input at acceptance (old session: %s)", async (mode, legacySession) => {
  const fixture = await createWorkerPostgresFixture(env);
  const userId = crypto.randomUUID();
  await fixture.operator.query({
    text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $1, $2, 1, 1000, 1000)',
    values: [userId, `${userId}@example.test`],
  });
  await recordUserTimeZoneObservation({
    db: fixture.db,
    userId,
    nowMs: 100,
    observation: { source: "web", timeZone: "Asia/Taipei" },
  });
  const captured: SignalPublishContext[] = [];
  const capture = (_signal: SignalEnvelope, context?: SignalPublishContext) => {
    captured.push(context ?? {});
  };
  const target = {
    bindings: { OPENMELD_POSTGRESQL: fixture.binding },
    ctx: { waitUntil: vi.fn() },
    spaceId: "space-time-test",
    assertRemoteAgentFinalReplyWasNotStopped: vi.fn(),
    publishExecutionInput: vi.fn(capture),
    persistSignalWithOptionalOutbox: (
      signal: SignalEnvelope,
      _createOutboxRecord: boolean,
      context?: SignalPublishContext
    ) => {
      capture(signal, context);
      return {
        persistedSignal: true,
        duplicateFinalReplyBlocked: false,
        dispatchMessages: [],
      };
    },
    flushPendingDispatchOutbox: vi.fn(),
    recordOrganizationMemberHumanActivity: vi.fn(),
    broadcastSignal: vi.fn(),
  };
  const builder = { spaceId: target.spaceId, lastTimestamp: 0 };
  const profile: Profile = {
    kind: "human",
    profileId: "hum-time-test",
    profileName: "Morgan",
  };
  const clock = vi.spyOn(Date, "now").mockReturnValue(120);
  try {
    await handleWebSocketTextSignal({
      webSocket: { send: vi.fn() } as unknown as WebSocket,
      session: {
        ...(legacySession ? {} : { callerPrincipalId: userId }),
        viewerOwnerUserId: userId,
        helloAccepted: true,
        supportsLiveSignalHistory: false,
        supportsSpaceMessageAddressing: false,
      },
      profile,
      payload: {
        type: "signal.text",
        ts: 9999,
        actorContext: { callerPrincipalId: "forged-user" },
        requestTimeContext: {
          submittedAtMs: 9999,
          userTime: {
            timeZone: "America/Los_Angeles",
            source: "web",
            observedAtMs: 9999,
          },
        },
        data: {
          text: "Please run this in 10 minutes.",
          ...(mode === "steer"
            ? {
                meta: {
                  clientMessageId: "accepted-steer",
                  centerAgentExecutionInput: {
                    dispatchId: "dispatch",
                    targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
                  },
                },
              }
            : {}),
        },
      },
      buildTextSignal: (acceptedProfile, text, options) =>
        signalMethods.buildTextSignal.call(
          builder,
          acceptedProfile,
          text,
          options
        ),
      publishTextSignal: (signal, context) =>
        signalMethods.publishTextSignal.call(target, signal, context),
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.requestTimeContext).toEqual({
      submittedAtMs: 120,
      userTime: { timeZone: "Asia/Taipei", source: "web", observedAtMs: 100 },
    });
    await recordUserTimeZoneObservation({
      db: fixture.db,
      userId,
      nowMs: 200,
      observation: { source: "desktop", timeZone: "America/Los_Angeles" },
    });
    expect((await readUserTimeContext(fixture.db, userId)).timeZone).toBe(
      "America/Los_Angeles"
    );
    expect(captured[0]?.requestTimeContext?.userTime.timeZone).toBe(
      "Asia/Taipei"
    );
    // Verified Queue/RPC input must keep its original anchor on republish.
    await signalMethods.publishTextSignal.call(
      target,
      signalMethods.buildTextSignal.call(builder, profile, "Retry"),
      captured[0]
    );
    expect(captured[1]?.requestTimeContext).toEqual(
      captured[0]?.requestTimeContext
    );
  } finally {
    clock.mockRestore();
  }
});

it("rejects a delayed zone change after a newer same-zone SQL observation", async () => {
  const fixture = await createWorkerPostgresFixture(env);
  const userId = crypto.randomUUID();
  await fixture.operator.query({
    text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $1, $2, 1, 1000, 1000)',
    values: [userId, `${userId}@example.test`],
  });
  for (const [nowMs, timeZone] of [
    [100, "Asia/Taipei"],
    [120, "Asia/Taipei"],
    [110, "America/Los_Angeles"],
  ] as const) {
    await recordUserTimeZoneObservation({
      db: fixture.db,
      userId,
      observation: { source: "web", timeZone },
      nowMs,
    });
  }
  expect(await readUserTimeContext(fixture.db, userId)).toEqual({
    timeZone: "Asia/Taipei",
    source: "web",
    observedAtMs: 120,
  });
});

it("stores one authenticated user zone with atomic interactive priority", async () => {
  const fixture = await createWorkerPostgresFixture(env);
  const userId = crypto.randomUUID();
  await fixture.operator.query({
    text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $1, $2, 1, 1000, 1000)',
    values: [userId, `${userId}@example.test`],
  });
  const nowMs = 100_000;
  const observe = (
    source: "web" | "desktop" | "service",
    timeZone: string,
    at = nowMs
  ) =>
    recordUserTimeZoneObservation({
      db: fixture.db,
      userId,
      nowMs: at,
      observation: { source, timeZone },
    });
  await observe("service", "America/New_York");
  await Promise.all([
    observe("web", "Asia/Taipei", nowMs + 1),
    observe("service", "America/Los_Angeles", nowMs + 2),
  ]);
  expect(await readUserTimeContext(fixture.db, userId)).toEqual({
    timeZone: "Asia/Taipei",
    source: "web",
    observedAtMs: nowMs + 1,
  });
  // A slower request and background Service cannot reverse the new observation.
  await observe("desktop", "America/Los_Angeles", nowMs);
  await observe("service", "America/New_York", nowMs + 10);
  await observe("desktop", "Asia/Taipei", nowMs + 20);
  expect((await readUserTimeContext(fixture.db, userId)).observedAtMs).toBe(
    nowMs + 20
  );
  const offlineAt = nowMs + 20 + USER_TIME_ZONE_INTERACTIVE_PRIORITY_MS + 1;
  expect((await readUserTimeContext(fixture.db, userId)).timeZone).toBe(
    "Asia/Taipei"
  );
  await observe("service", "America/New_York", offlineAt);
  expect((await readUserTimeContext(fixture.db, userId)).source).toBe(
    "service"
  );

  const context = {
    actorContext: {
      requestId: "request",
      openMeldProfileId: crypto.randomUUID(),
      profileKind: "human" as const,
      callerPrincipalId: userId,
      ownerUserId: userId,
    },
    userTimeZoneObservation: {
      source: "desktop" as const,
      timeZone: "America/Los_Angeles",
    },
  };
  const request = await resolveUserRequestTimeContext({
    db: fixture.db,
    context,
    submittedAtMs: offlineAt + 1,
  });
  expect(request.userTime.timeZone).toBe("America/Los_Angeles");
  // A new initiating client controls its own accepted input without changing
  // a previously captured Queue/retry anchor.
  await observe("web", "Asia/Taipei", offlineAt + 2);
  expect(request).toMatchObject({
    submittedAtMs: offlineAt + 1,
    userTime: { timeZone: "America/Los_Angeles" },
  });
  const unauthenticated = await resolveUserRequestTimeContext({
    db: fixture.db,
    context: {
      ...context,
      actorContext: { ...context.actorContext, callerPrincipalId: undefined },
    },
    submittedAtMs: offlineAt + 3,
  });
  expect(unauthenticated.userTime).toEqual({
    timeZone: "UTC",
    source: "utc",
    observedAtMs: null,
  });
  const impersonated = await resolveUserRequestTimeContext({
    db: fixture.db,
    context: {
      ...context,
      actorContext: { ...context.actorContext, ownerUserId: "another-user" },
    },
    submittedAtMs: offlineAt + 4,
  });
  expect(impersonated.userTime.source).toBe("utc");
  expect((await readUserTimeContext(fixture.db, userId)).timeZone).toBe(
    "Asia/Taipei"
  );
});
