import { env } from "cloudflare:test";
import {
  USER_TIME_ZONE_INTERACTIVE_PRIORITY_MS,
  USER_TIME_ZONE_OBSERVATION_REFRESH_MS,
} from "@openmeld/schemas";
import { expect, it } from "vitest";
import {
  readUserTimeContext,
  recordUserTimeZoneObservation,
  resolveUserRequestTimeContext,
} from "../src/user-time-context/user-time-context-repository";
import { createWorkerPostgresFixture } from "./postgresql.test-support";

it("stores one authenticated user zone with atomic interactive priority and bounded refresh", async () => {
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
    nowMs + 1
  );
  await observe(
    "web",
    "Asia/Taipei",
    nowMs + USER_TIME_ZONE_OBSERVATION_REFRESH_MS + 1
  );
  const refreshed = await readUserTimeContext(fixture.db, userId);
  expect(refreshed.observedAtMs).toBe(
    nowMs + USER_TIME_ZONE_OBSERVATION_REFRESH_MS + 1
  );
  const offlineAt =
    nowMs +
    USER_TIME_ZONE_OBSERVATION_REFRESH_MS +
    USER_TIME_ZONE_INTERACTIVE_PRIORITY_MS +
    2;
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
