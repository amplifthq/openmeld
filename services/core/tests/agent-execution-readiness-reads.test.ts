import { env } from "cloudflare:test";
import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { describe, expect, it, vi } from "vitest";
import { createAgentExecutionReadinessReads } from "../src/agent-execution/application/agent-execution-readiness-reads";
import type { AuthProfileFacts } from "../src/auth/application/profile-facts-reader";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";

describe("request-scoped readiness reads", () => {
  it("preserves missing, disabled and unavailable Auth facts without scalar retries", async () => {
    const disabled = {
      profileId: "disabled",
      profileName: "Agent",
      profileHandle: "agent",
      profileKind: "agent" as const,
      status: "disabled" as const,
      ownerUserId: "owner",
    };
    const profileFacts: AuthProfileFacts = new Map([
      ["disabled", disabled],
      ["missing", null],
    ]);
    const resolveProfileById = vi.fn().mockResolvedValue({
      ok: false,
      code: "profile.not_found",
      message: "Profile not found.",
    });
    const authWorker = { resolveProfileById };
    const reads = createAgentExecutionReadinessReads({ profileFacts });
    expect(
      await reads.resolveProfileById({ authWorker, profileId: "disabled" })
    ).toEqual({ ok: true, profile: disabled });
    expect(
      await reads.resolveProfileById({ authWorker, profileId: "missing" })
    ).toMatchObject({ ok: false, code: "profile.not_found" });
    expect(
      await createAgentExecutionReadinessReads({
        profileFacts: null,
      }).resolveProfileById({ authWorker, profileId: "disabled" })
    ).toMatchObject({ ok: false, code: "profile.lookup_failed" });
    expect(resolveProfileById).not.toHaveBeenCalled();
    // A conflicting Profile outside the initial batch still needs current Auth facts.
    await reads.resolveProfileById({ authWorker, profileId: "conflict" });
    expect(resolveProfileById).toHaveBeenCalledExactlyOnceWith({
      openMeldProfileId: "conflict",
    });
    await createAgentExecutionReadinessReads().resolveProfileById({
      authWorker,
      profileId: "disabled",
    });
    expect(resolveProfileById).toHaveBeenCalledTimes(2);
  });
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
