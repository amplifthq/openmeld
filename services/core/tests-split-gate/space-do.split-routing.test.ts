import { env, runInDurableObject } from "cloudflare:test";
import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";

// Physical DB split routing gate (physical-db-split.md Stage B safety net).
//
// Space DO's rewired this.bindings.OPENMELD_DB sites are exercised through real DO
// instances under the split env (3 per-domain D1 + empty OPENMELD_DB trap). Because
// table names are disjoint across the four baselines, a read that reaches the
// correct domain returns rows/empty (no throw); a misroute — or an un-rewired
// read landing on the empty OPENMELD_DB trap — raises `no such table`.

const OWNER_USER_ID = "owner-split-gate";
const DEVICE_ID = "device-split-gate";
const NOW_MS = Date.parse("2026-06-14T00:00:00.000Z");

type SpaceDoInternals = {
  readSpaceDispatchTrace(dispatchId: string): Promise<unknown>;
  readSpaceDispatchLookup(input: {
    clientMessageId?: string | null;
    sourceSignalId: string;
    targetProfileId?: string;
  }): Promise<unknown>;
  readSpaceDispatchLookupByClientMessageId(input: {
    clientMessageId: string;
    targetProfileId?: string;
  }): Promise<unknown>;
  readWakeProgressRuntimeDeviceDisplayName(
    trace: unknown
  ): Promise<string | null>;
  readDispatchLedgerEvidence(idempotencyKey: string): Promise<{ kind: string }>;
  requireSpaceIndexDb(): D1Database;
};

const SCHEMA_FAULT = /no such table|no such column/i;

// Returns a schema-fault message iff the call misrouted (or hit the empty trap);
// null otherwise. Kept out of expect() so the assertion stays inside it().
async function schemaFaultFrom(
  label: string,
  run: () => Promise<unknown>
): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return SCHEMA_FAULT.test(message) ? `${label}: ${message}` : null;
  }
}

describe("Space DO rewired reads route to their domain under the split schema", () => {
  it("routes the dispatch trace/lookup reads to openmeld-wake-evidence", async () => {
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace;
    const stub = namespace.get(namespace.idFromName("split-gate-wake-reads"));

    const faults = await runInDurableObject(stub, async (rawInstance) => {
      const space = rawInstance as unknown as SpaceDoInternals;
      // Each fake id reaches the wake-evidence query and returns empty; a misroute
      // to local-state/projections (or the empty trap) would raise no such table.
      const collected = await Promise.all([
        schemaFaultFrom("readSpaceDispatchTrace", () =>
          space.readSpaceDispatchTrace("dispatch-split-gate-fake")
        ),
        schemaFaultFrom("readSpaceDispatchLookup", () =>
          space.readSpaceDispatchLookup({
            sourceSignalId: "sig-split-gate-fake",
          })
        ),
        schemaFaultFrom("readSpaceDispatchLookupByClientMessageId", () =>
          space.readSpaceDispatchLookupByClientMessageId({
            clientMessageId: "cm-split-gate-fake",
          })
        ),
      ]);
      return collected.filter((entry): entry is string => entry !== null);
    });

    expect(faults).toEqual([]);
  });

  it("routes the dispatch ledger evidence read to openmeld-wake-evidence", async () => {
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace;
    const stub = namespace.get(namespace.idFromName("split-gate-ledger"));

    // readDispatchLedgerEvidence swallows read errors into a reasonCode, so a
    // misroute can't be caught by "no throw". A fake key against the correct
    // (wake-evidence) domain returns kind "missing"; a misroute raises no such
    // table → onReadError → kind "unavailable" (dispatch_ledger_read_failed).
    const evidence = await runInDurableObject(stub, (rawInstance) => {
      const space = rawInstance as unknown as SpaceDoInternals;
      return space.readDispatchLedgerEvidence("idempotency-split-gate-fake");
    });

    expect(evidence.kind).toBe("missing");
  });

  it("resolves the Space Index handle to openmeld-projections", async () => {
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace;
    const stub = namespace.get(namespace.idFromName("split-gate-space-index"));

    const tableExists = await runInDurableObject(stub, async (rawInstance) => {
      const space = rawInstance as unknown as SpaceDoInternals;
      // requireSpaceIndexDb() resolves projectionsDb(this.bindings); querying the
      // projections-only table through that handle proves the classification —
      // a misroute to wake-evidence/local-state lacks space_index_memberships.
      const indexDb = space.requireSpaceIndexDb();
      const rows = await indexDb
        .prepare("SELECT space_id FROM space_index_memberships LIMIT 1")
        .all();
      return rows.success;
    });

    expect(tableExists).toBe(true);
  });

  it("reads the wake-progress runtime device name from openmeld-local-state", async () => {
    // The runtime device-name read swallows DB errors, so a misroute can't be
    // caught by "no throw". Seed the local-state join (runtime registry + owned
    // device) and assert the name actually surfaces — a misroute to
    // wake-evidence/projections lacks both tables and yields null.
    const localStateDb = env.OPENMELD_LOCAL_STATE_DB as D1Database;
    const runtimeLookupInput = createRuntimeLookupInput({
      deviceId: DEVICE_ID,
      lane: "dev-local",
      owner: { id: OWNER_USER_ID, kind: "owner_account" },
    });
    const openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
      lookupInput: runtimeLookupInput,
      openMeldServiceRuntimeId: "runtime-split-gate-display",
      source: "runtime_registry_authority",
    });
    await registerRuntimeRegistryRecord({
      db: localStateDb,
      record: { nowMs: NOW_MS, openMeldServiceRuntimeId, runtimeLookupInput },
    });
    await localStateDb
      .prepare(
        `INSERT INTO openMeldDaemon_owned_devices
           (owner_user_id, device_id, user_display_name, first_seen_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(OWNER_USER_ID, DEVICE_ID, "Split Gate Studio", NOW_MS, NOW_MS)
      .run();

    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace;
    const stub = namespace.get(namespace.idFromName("split-gate-runtime-name"));
    const displayName = await runInDurableObject(stub, (rawInstance) => {
      const space = rawInstance as unknown as SpaceDoInternals;
      return space.readWakeProgressRuntimeDeviceDisplayName({
        runtimeCoordinatorExecution: {
          openMeldServiceRuntimeId: { value: openMeldServiceRuntimeId.value },
        },
      });
    });

    expect(displayName).toBe("Split Gate Studio");
  });
});
