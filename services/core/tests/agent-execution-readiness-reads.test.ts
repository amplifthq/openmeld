import { env } from "cloudflare:test";
import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import { createAgentExecutionReadinessReads } from "../src/agent-execution/application/agent-execution-readiness-reads";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";

describe("request-scoped readiness reads", () => {
  it("shares Runtime facts for 50 profiles, isolates identities, and refreshes on the next request", async () => {
    const suffix = crypto.randomUUID();
    const runtimeId = `readiness-reads-${suffix}`;
    const lookup = createRuntimeLookupInput({
      owner: { kind: "owner_account", id: `owner-${suffix}` },
      deviceId: `device-${suffix}`,
      lane: "dev-local",
    });
    const runtime = createAuthorityOpenMeldServiceRuntimeId({
      openMeldServiceRuntimeId: runtimeId,
      source: "runtime_registry_authority",
    });
    let queryCount = 0;
    // Count real D1 reads; no repository result is mocked.
    const db = {
      prepare(query: string) {
        queryCount += 1;
        return env.OPENMELD_DB.prepare(query);
      },
    } as D1Database;
    const reads = createAgentExecutionReadinessReads();
    const before = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const [byId, byLookup, reports] = await Promise.all([
          reads.readRuntimeRegistryRecordByRuntimeId({
            db,
            openMeldServiceRuntimeId: runtimeId,
          }),
          reads.readRuntimeRegistryRecord({ db, runtimeLookupInput: lookup }),
          reads.readCurrentRuntimeAgentControllerReports({
            db,
            openMeldServiceRuntimeId: runtime,
            agentControllerRefs: ["builtin:codex"],
          }),
        ]);
        return { byId, byLookup, reports };
      })
    );
    expect(queryCount).toBe(3);
    for (const result of before) {
      expect(result.byId.status).toBe("missing");
      expect(result.byLookup.status).toBe("missing");
      expect(result.reports).toEqual([]);
    }

    await registerRuntimeRegistryRecord({
      db: env.OPENMELD_DB,
      record: {
        nowMs: Date.now(),
        runtimeLookupInput: lookup,
        openMeldServiceRuntimeId: runtime,
      },
    });
    const nextRequest = createAgentExecutionReadinessReads();
    expect(
      await nextRequest.readRuntimeRegistryRecordByRuntimeId({
        db,
        openMeldServiceRuntimeId: runtimeId,
      })
    ).toMatchObject({ status: "found" });
    expect(
      await nextRequest.readRuntimeRegistryRecord({
        db,
        runtimeLookupInput: lookup,
      })
    ).toMatchObject({ status: "found" });
    expect(
      await nextRequest.readRuntimeRegistryRecord({
        db,
        runtimeLookupInput: {
          ...lookup,
          owner: { kind: "owner_account", id: `other-${suffix}` },
        },
      })
    ).toMatchObject({ status: "missing" });
    expect(
      await nextRequest.readRuntimeRegistryRecord({
        db,
        runtimeLookupInput: { ...lookup, deviceId: `other-${suffix}` },
      })
    ).toMatchObject({ status: "missing" });
    expect(
      await nextRequest.readRuntimeRegistryRecord({
        db,
        runtimeLookupInput: { ...lookup, lane: "prod" },
      })
    ).toMatchObject({ status: "missing" });
    expect(queryCount).toBe(8);
  });
});
