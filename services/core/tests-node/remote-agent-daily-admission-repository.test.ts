import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMOTE_AGENT_DAILY_ADMISSION_LIMIT,
  resolveRemoteAgentDailyAdmissionLimit,
} from "../src/remote-agent/application/daily-admission-policy";
import { admitRemoteAgentDailyDelivery } from "../src/remote-agent/infrastructure/d1/daily-admission-repo";
import { upsertRemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const NOW_MS = Date.parse("2026-07-12T12:00:00.000Z");

describe("Remote Agent daily admission repository", () => {
  it("defaults invalid configuration to 200 and accepts a positive override", () => {
    expect(DEFAULT_REMOTE_AGENT_DAILY_ADMISSION_LIMIT).toBe(200);
    expect(resolveRemoteAgentDailyAdmissionLimit(undefined)).toBe(200);
    expect(resolveRemoteAgentDailyAdmissionLimit("not-a-number")).toBe(200);
    expect(resolveRemoteAgentDailyAdmissionLimit("0")).toBe(200);
    expect(resolveRemoteAgentDailyAdmissionLimit("1")).toBe(1);
  });

  it("counts the first admission once and rejects the 201st admission", async () => {
    const harness = createAdmissionHarness();

    try {
      const results: string[] = [];
      for (let index = 1; index <= 201; index += 1) {
        const idempotencyKey = `daily_admission_${index}`;
        await seedDelivery(harness.db, idempotencyKey, index);
        const result = await admitRemoteAgentDailyDelivery({
          db: harness.db,
          idempotencyKey,
          limit: 200,
          nowMs: NOW_MS,
          organizationId: "org_1",
        });
        results.push(result.status);

        if (index === 1) {
          expect(readDailyCount(harness, "2026-07-12")).toBe(1);
        }
      }

      expect(results.slice(0, 200)).toEqual(
        Array.from({ length: 200 }, () => "admitted")
      );
      expect(results[200]).toBe("rejected");
      expect(readDailyCount(harness, "2026-07-12")).toBe(200);
    } finally {
      harness.close();
    }
  });

  it("starts a fresh counter after 00:00 UTC", async () => {
    const harness = createAdmissionHarness();

    try {
      await seedDelivery(harness.db, "day_one", 1);
      await seedDelivery(harness.db, "day_two", 2);

      await expect(
        admitRemoteAgentDailyDelivery({
          db: harness.db,
          idempotencyKey: "day_one",
          limit: 1,
          nowMs: NOW_MS,
          organizationId: "org_1",
        })
      ).resolves.toMatchObject({ status: "admitted" });
      await expect(
        admitRemoteAgentDailyDelivery({
          db: harness.db,
          idempotencyKey: "day_two",
          limit: 1,
          nowMs: Date.parse("2026-07-13T00:00:00.000Z"),
          organizationId: "org_1",
        })
      ).resolves.toMatchObject({ status: "admitted" });

      expect(readDailyCount(harness, "2026-07-12")).toBe(1);
      expect(readDailyCount(harness, "2026-07-13")).toBe(1);
    } finally {
      harness.close();
    }
  });

  it("does not recount concurrent or next-day retries of one admission", async () => {
    const harness = createAdmissionHarness();

    try {
      await seedDelivery(harness.db, "retry_key", 1);
      const concurrent = await Promise.all([
        admitRemoteAgentDailyDelivery({
          db: harness.db,
          idempotencyKey: "retry_key",
          limit: 1,
          nowMs: NOW_MS,
          organizationId: "org_1",
        }),
        admitRemoteAgentDailyDelivery({
          db: harness.db,
          idempotencyKey: "retry_key",
          limit: 1,
          nowMs: NOW_MS,
          organizationId: "org_1",
        }),
      ]);

      expect(concurrent).toEqual([
        expect.objectContaining({ status: "admitted" }),
        expect.objectContaining({ status: "admitted" }),
      ]);
      expect(readDailyCount(harness, "2026-07-12")).toBe(1);

      await expect(
        admitRemoteAgentDailyDelivery({
          db: harness.db,
          idempotencyKey: "retry_key",
          limit: 1,
          nowMs: Date.parse("2026-07-13T00:00:00.000Z"),
          organizationId: "org_1",
        })
      ).resolves.toMatchObject({ status: "admitted" });
      expect(readDailyCount(harness, "2026-07-13")).toBeNull();
    } finally {
      harness.close();
    }
  });

  it("admits only one of two distinct concurrent requests at the limit", async () => {
    const harness = createAdmissionHarness();

    try {
      await seedDelivery(harness.db, "concurrent_a", 1);
      await seedDelivery(harness.db, "concurrent_b", 2);
      const results = await Promise.all([
        admitRemoteAgentDailyDelivery({
          db: harness.db,
          idempotencyKey: "concurrent_a",
          limit: 1,
          nowMs: NOW_MS,
          organizationId: "org_1",
        }),
        admitRemoteAgentDailyDelivery({
          db: harness.db,
          idempotencyKey: "concurrent_b",
          limit: 1,
          nowMs: NOW_MS,
          organizationId: "org_1",
        }),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        "admitted",
        "rejected",
      ]);
      expect(readDailyCount(harness, "2026-07-12")).toBe(1);
    } finally {
      harness.close();
    }
  });
});

function createAdmissionHarness() {
  const harness = createSqliteD1Harness();
  applyMigrationForTable(harness, "openMeldRemoteAgent_native_delivery_ledger");
  applyMigrationForTable(harness, "openMeldRemoteAgent_daily_admissions");
  return harness;
}

async function seedDelivery(
  db: D1Database,
  idempotencyKey: string,
  index: number
): Promise<void> {
  await upsertRemoteAgentNativeDeliveryRecord({
    attemptId: `attempt_${index}`,
    bindingId: "binding_1",
    db,
    dispatchId: `dispatch_${index}`,
    idempotencyKey,
    nowMs: NOW_MS,
    organizationId: "org_1",
    profileId: "agt_1",
    spaceId: "space_1",
    status: "submitted",
    triggerMessageId: `signal_${index}`,
  });
}

function readDailyCount(
  harness: ReturnType<typeof createSqliteD1Harness>,
  dayUtc: string
): number | null {
  return (
    harness.queryFirst<{ admitted_count: number }>({
      params: ["org_1", dayUtc],
      sql: `
        SELECT admitted_count
        FROM openMeldRemoteAgent_daily_admissions
        WHERE organization_id = ? AND day_utc = ?
      `,
    })?.admitted_count ?? null
  );
}
