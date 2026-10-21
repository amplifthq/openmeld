import { runInDurableObject } from "cloudflare:test";
import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import { env } from "../test-support/worker-env";

const OWNER_USER_ID = "owner-postgresql-owner";
const DEVICE_ID = "device-postgresql-owner";
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
  requireSpaceIndexDb(): PostgresDatabase;
};

async function schemaFaultFrom(
  label: string,
  run: () => Promise<unknown>
): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return `${label}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

describe("Space Durable Object reads use PostgreSQL", () => {
  it("reads dispatch traces and lookups through the native owner", async () => {
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace;
    const stub = namespace.get(
      namespace.idFromName("postgresql-owner-wake-reads")
    );

    const faults = await runInDurableObject(stub, async (rawInstance) => {
      const space = rawInstance as unknown as SpaceDoInternals;
      const collected = await Promise.all([
        schemaFaultFrom("readSpaceDispatchTrace", () =>
          space.readSpaceDispatchTrace("dispatch-postgresql-owner-fake")
        ),
        schemaFaultFrom("readSpaceDispatchLookup", () =>
          space.readSpaceDispatchLookup({
            sourceSignalId: "sig-postgresql-owner-fake",
          })
        ),
        schemaFaultFrom("readSpaceDispatchLookupByClientMessageId", () =>
          space.readSpaceDispatchLookupByClientMessageId({
            clientMessageId: "cm-postgresql-owner-fake",
          })
        ),
      ]);
      return collected.filter((entry): entry is string => entry !== null);
    });

    expect(faults).toEqual([]);
  });

  it("returns missing ledger evidence rather than a database failure", async () => {
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace;
    const stub = namespace.get(namespace.idFromName("postgresql-owner-ledger"));

    const evidence = await runInDurableObject(stub, (rawInstance) => {
      const space = rawInstance as unknown as SpaceDoInternals;
      return space.readDispatchLedgerEvidence(
        "idempotency-postgresql-owner-fake"
      );
    });

    expect(evidence.kind).toBe("missing");
  });

  it("reads the Space Index through the native owner", async () => {
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace;
    const stub = namespace.get(
      namespace.idFromName("postgresql-owner-space-index")
    );

    const tableExists = await runInDurableObject(stub, async (rawInstance) => {
      const space = rawInstance as unknown as SpaceDoInternals;
      const indexDb = space.requireSpaceIndexDb();
      const rows = await indexDb.query(
        'SELECT space_id FROM "openmeld"."space_index_memberships" LIMIT 1'
      );
      return rows.command === "SELECT";
    });

    expect(tableExists).toBe(true);
  });

  it("reads the owned runtime device display name", async () => {
    const localStateDb = getPostgresDatabase(env);
    await localStateDb.query({
      text: `INSERT INTO "openmeld"."users" (id, name, email, created_at, updated_at)
      VALUES ($1, 'Owner', 'device-owner@example.test', 1000, 1000)`,
      values: [OWNER_USER_ID],
    });
    const runtimeLookupInput = createRuntimeLookupInput({
      deviceId: DEVICE_ID,
      lane: "dev-local",
      owner: { id: OWNER_USER_ID, kind: "owner_account" },
    });
    const openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
      lookupInput: runtimeLookupInput,
      openMeldServiceRuntimeId: "runtime-postgresql-owner-display",
      source: "runtime_registry_authority",
    });
    await registerRuntimeRegistryRecord({
      db: localStateDb,
      record: { nowMs: NOW_MS, openMeldServiceRuntimeId, runtimeLookupInput },
    });
    await localStateDb.query({
      text: `INSERT INTO "openmeld"."openMeldDaemon_owned_devices"
      (owner_user_id, device_id, user_display_name, first_seen_at_ms, updated_at_ms) VALUES ($1, $2, $3, $4, $4)`,
      values: [OWNER_USER_ID, DEVICE_ID, "PostgreSQL Studio", NOW_MS],
    });

    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace;
    const stub = namespace.get(
      namespace.idFromName("postgresql-owner-runtime-name")
    );
    const displayName = await runInDurableObject(stub, (rawInstance) => {
      const space = rawInstance as unknown as SpaceDoInternals;
      return space.readWakeProgressRuntimeDeviceDisplayName({
        runtimeCoordinatorExecution: {
          openMeldServiceRuntimeId: { value: openMeldServiceRuntimeId.value },
        },
      });
    });

    expect(displayName).toBe("PostgreSQL Studio");
  });
});
