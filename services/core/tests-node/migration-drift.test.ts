import { LATEST_SHARED_MIGRATION_ID } from "@openmeld/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateSharedDbMigrationDrift,
  resetSharedDbMigrationDriftCheckForTests,
  warnOnSharedDbMigrationDriftOnce,
} from "../src/db/migration-drift";

const buildDbStub = (maxId: number | null) => {
  const first = vi.fn().mockResolvedValue({ maxId });
  const prepare = vi.fn().mockReturnValue({ first });
  return { db: { prepare } as unknown as D1Database, first, prepare };
};

afterEach(() => {
  resetSharedDbMigrationDriftCheckForTests();
  vi.restoreAllMocks();
});

describe("evaluateSharedDbMigrationDrift", () => {
  it("returns null when the applied migration id is current", () => {
    expect(
      evaluateSharedDbMigrationDrift(LATEST_SHARED_MIGRATION_ID)
    ).toBeNull();
  });

  it("returns a loud warning when the applied migration id is behind", () => {
    const warning = evaluateSharedDbMigrationDrift(
      LATEST_SHARED_MIGRATION_ID - 1
    );
    expect(warning).not.toBeNull();
    expect(warning).toContain("migration drift");
    expect(warning).toContain("pnpm db:migrate:dev");
  });
});

describe("warnOnSharedDbMigrationDriftOnce", () => {
  it("skips the probe outside the local worker environment", () => {
    const { db, prepare } = buildDbStub(1);
    warnOnSharedDbMigrationDriftOnce({
      OPENMELD_DB: db,
      OPENMELD_WORKER_ENVIRONMENT: "prod",
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("probes once on local and warns when the database is behind", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { db, prepare } = buildDbStub(LATEST_SHARED_MIGRATION_ID - 1);
    const pending: Promise<unknown>[] = [];

    warnOnSharedDbMigrationDriftOnce(
      { OPENMELD_DB: db, OPENMELD_WORKER_ENVIRONMENT: "local" },
      (promise) => {
        pending.push(promise);
      }
    );
    await Promise.all(pending);

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0] ?? "")).toContain("migration drift");
  });

  it("stays silent on local when the database is current", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { db } = buildDbStub(LATEST_SHARED_MIGRATION_ID);
    const pending: Promise<unknown>[] = [];

    warnOnSharedDbMigrationDriftOnce(
      { OPENMELD_DB: db, OPENMELD_WORKER_ENVIRONMENT: "local" },
      (promise) => {
        pending.push(promise);
      }
    );
    await Promise.all(pending);

    expect(warn).not.toHaveBeenCalled();
  });

  it("only probes once per isolate", () => {
    const { db, prepare } = buildDbStub(LATEST_SHARED_MIGRATION_ID);
    const pending: Promise<unknown>[] = [];
    const waitUntil = (promise: Promise<unknown>) => {
      pending.push(promise);
    };

    warnOnSharedDbMigrationDriftOnce(
      { OPENMELD_DB: db, OPENMELD_WORKER_ENVIRONMENT: "local" },
      waitUntil
    );
    warnOnSharedDbMigrationDriftOnce(
      { OPENMELD_DB: db, OPENMELD_WORKER_ENVIRONMENT: "local" },
      waitUntil
    );

    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
