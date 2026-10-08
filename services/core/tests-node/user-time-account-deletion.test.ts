import { expect, it, vi } from "vitest";
import {
  readUserTimeContext,
  recordUserTimeZoneObservation,
} from "../src/user-time-context/user-time-context-repository";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

it("rejects an in-flight observation after account deletion commits", async () => {
  const harness = await createPostgresHarness();
  const userId = "closing-time-owner";
  let locked = false;
  let lateObservation: Promise<unknown> | undefined;
  const observe = (timeZone: string, nowMs: number) =>
    recordUserTimeZoneObservation({
      db: harness.db,
      userId,
      observation: { source: "web", timeZone },
      nowMs,
    });
  try {
    await harness.query({
      text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $1, $2)',
      values: [userId, `${userId}@example.test`],
    });
    await observe("Asia/Taipei", 100);
    await observe("America/Los_Angeles", 120);
    expect(await readUserTimeContext(harness.db, userId)).toEqual({
      timeZone: "America/Los_Angeles",
      source: "web",
      observedAtMs: 120,
    });

    // Auth accepts deletion under this same user lock, then erases the row.
    await harness.query("BEGIN");
    locked = true;
    await harness.query({
      text: 'SELECT 1 FROM "openmeld"."users" WHERE id=$1 FOR UPDATE',
      values: [userId],
    });
    await harness.query({
      text: 'UPDATE "openmeld"."users" SET deleted_at=200 WHERE id=$1',
      values: [userId],
    });
    await harness.query({
      text: 'DELETE FROM "openmeld"."user_time_contexts" WHERE user_id=$1',
      values: [userId],
    });
    lateObservation = observe("Asia/Taipei", 130).then(
      () => ({ status: "written" }),
      (error) => ({
        status: "rejected",
        code: error.code,
        message: error.message,
      })
    );
    await vi.waitFor(async () => {
      await harness.query("SELECT pg_stat_clear_snapshot()");
      const result = await harness.query<{ count: string }>(
        "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename='openmeld_pg_runtime' AND wait_event_type='Lock'"
      );
      expect(Number(result.rows[0]?.count)).toBe(1);
    });
    await harness.query("COMMIT");
    locked = false;
    expect(await lateObservation).toEqual({
      status: "rejected",
      code: "23514",
      message: "account_unavailable",
    });
    await expect(observe("Asia/Taipei", 140)).rejects.toMatchObject({
      code: "23514",
      message: "account_unavailable",
    });
    expect(
      await harness.queryFirst({
        text: 'SELECT 1 FROM "openmeld"."user_time_contexts" WHERE user_id=$1',
        values: [userId],
      })
    ).toBeNull();
  } finally {
    if (locked) {
      await harness.query("ROLLBACK");
    }
    await Promise.allSettled(lateObservation ? [lateObservation] : []);
    await harness.close();
  }
});
