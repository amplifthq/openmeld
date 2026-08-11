import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectCoreDispatchStorageReadiness } from "../db/runtime-facts";

// After the physical DB split, dispatch storage readiness is a PER-DOMAIN probe:
// one sentinel table is read through each domain accessor (local-state /
// wake-evidence / projections). A single handle can no longer see every table,
// so a cross-domain full-schema check would falsely report not-ready post-cutover.

const reachableDb = (): D1Database =>
  ({
    prepare: () => ({
      all: () => Promise.resolve({ results: [], success: true }),
    }),
  }) as unknown as D1Database;

const missingTableDb = (table: string): D1Database =>
  ({
    prepare: (sql: string) => ({
      all: () =>
        sql.includes(table)
          ? Promise.reject(
              new Error(`D1_ERROR: no such table: ${table}: SQLITE_ERROR`)
            )
          : Promise.resolve({ results: [], success: true }),
    }),
  }) as unknown as D1Database;

describe("core dispatch storage runtime facts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports ready when every per-domain dispatch store is reachable", async () => {
    const readiness = await inspectCoreDispatchStorageReadiness({
      OPENMELD_LOCAL_STATE_DB: reachableDb(),
      OPENMELD_WAKE_EVIDENCE_DB: reachableDb(),
      OPENMELD_PROJECTIONS_DB: reachableDb(),
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.detail).toBeNull();
  });

  it("reports the offending domain when its sentinel table is missing", async () => {
    const readiness = await inspectCoreDispatchStorageReadiness({
      OPENMELD_LOCAL_STATE_DB: reachableDb(),
      OPENMELD_WAKE_EVIDENCE_DB: missingTableDb(
        "openMeldDaemon_dispatch_ledger"
      ),
      OPENMELD_PROJECTIONS_DB: reachableDb(),
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.detail).toContain("wake-evidence");
    expect(readiness.detail).toContain("openMeldDaemon_dispatch_ledger");
  });

  it("reports not ready when a per-domain binding is missing", async () => {
    const readiness = await inspectCoreDispatchStorageReadiness({
      OPENMELD_LOCAL_STATE_DB: reachableDb(),
      OPENMELD_WAKE_EVIDENCE_DB: reachableDb(),
      // OPENMELD_PROJECTIONS_DB intentionally absent (and no OPENMELD_DB fallback)
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.detail).toContain("projections");
  });
});
