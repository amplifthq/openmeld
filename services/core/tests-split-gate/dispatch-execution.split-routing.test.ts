import { env } from "cloudflare:test";
import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  ensurePrimaryAgentProfileBindingRecord,
  readPrimaryAgentProfileBindingRecord,
} from "../src/agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import { deliverDispatchMessageToDaemon } from "../src/dispatch/application/dispatch-execution-service";
import {
  type CoreBindings,
  localStateDb,
  wakeEvidenceDb,
} from "../src/lib/bindings";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";

// Physical DB split routing gate (physical-db-split.md Stage B safety net).
//
// This gate drives the Wake dispatch EXECUTION path — not just the queue hot
// path (dispatch-queue-hot-path.split-routing.test.ts probes an empty batch) —
// under a per-domain-only D1 env (OPENMELD_LOCAL_STATE_DB / OPENMELD_WAKE_EVIDENCE_DB /
// OPENMELD_PROJECTIONS_DB bound, OPENMELD_DB left as the empty misroute trap).
//
// A real bug shipped+rolled-back because the dispatch path read the LOCAL-STATE
// table `openMeldDaemon_agent_profile_bindings` on the WAKE-EVIDENCE handle threaded as
// `db` → `no such table` after the split. The fix resolves `localStateDb(env)`
// for local-state reads inside the dispatch path. This test reaches those reads
// on the REAL wiring and asserts the only failure mode that fails it is a schema
// fault (a cross-domain misroute), the negative control proving the trap is live.

const OWNER_USER_ID = "owner-dispatch-split-gate";
const DEVICE_ID = "device-dispatch-split-gate";
const TARGET_PROFILE_ID = "agt_f3333333-3333-4333-8333-333333333333";
const BINDING_ID = "binding-dispatch-split-gate";
const RUNTIME_ID = "runtime-dispatch-split-gate";
const AGENT_CONTROLLER_REF = "builtin:codex";
const NOW_MS = Date.parse("2026-06-14T00:00:00.000Z");

const SCHEMA_FAULT = /no such table|no such column/i;
// An offline / update-required / daemon route abort — the EXPECTED terminal
// error once the local-state reads succeed and the offline RuntimeTransport route
// aborts delivery. Distinct from a schema fault (a cross-domain misroute).
const ROUTE_ABORTED = /offline|service\.update_required|daemon/i;

// Returns a schema-fault message iff the call misrouted (or hit the empty trap);
// null otherwise. Kept out of expect() so the assertion stays inside it(). A
// route-offline / route-blocked validation error is NOT a schema fault: it means
// the local-state reads reached local-state (found the seeded binding/registry,
// then the offline RuntimeTransport route aborts delivery) before returning.
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

// A split env that binds ONLY the three per-domain D1 databases (plus the DO
// namespaces the dispatch path needs). OPENMELD_DB is deliberately omitted, so the
// `?? OPENMELD_DB` accessor fallback yields undefined for it — any local-state read
// that lands on the wake-evidence handle throws `no such table`, because the
// binding/registry tables are absent from the wake-evidence baseline.
function buildSplitEnv(): CoreBindings {
  return {
    OPENMELD_LOCAL_STATE_DB: env.OPENMELD_LOCAL_STATE_DB,
    OPENMELD_WAKE_EVIDENCE_DB: env.OPENMELD_WAKE_EVIDENCE_DB,
    OPENMELD_PROJECTIONS_DB: env.OPENMELD_PROJECTIONS_DB,
    OPENMELD_RUNTIME_TRANSPORT: env.OPENMELD_RUNTIME_TRANSPORT,
    OPENMELD_SPACES: env.OPENMELD_SPACES,
  } as unknown as CoreBindings;
}

// A valid v2 dispatch queue message. targetProfileNameSnapshot AND
// targetProfileMentionLabel are both set so the entry skips the auth-RPC
// identity resolution (no OPENMELD_AUTH_WORKER bound here). sourceSignalSnapshot
// carries deterministic text so the source-signal read returns from the
// snapshot and never touches `db`.
function buildDispatchMessage(): OpenMeldDaemonDispatchQueueMessage {
  return {
    v: 2,
    dispatchId: "dispatch-split-gate-exec",
    spaceId: "space-dispatch-split-gate",
    sourceEventId: "sig-dispatch-split-gate",
    targetProfileId: TARGET_PROFILE_ID,
    targetProfileMentionLabel: "Split Gate Agent",
    targetProfileNameSnapshot: "Split Gate Agent",
    dispatchChainId: "dispatch-split-gate-exec",
    autoRelayDepth: 0,
    visitedProfileIds: [],
    visitedProfileIdsHash: "stable32:dispatchsplitgate",
    dispatchContractVersion: 2,
    dispatchPolicy: "mention_only",
    ruleSource: "registry",
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
    taskId: "task-dispatch-split-gate",
    transportMode: "local-cli",
    controllerSnapshot: {
      targetBindingState: "bound",
      targetBindingEnabled: true,
      agentControllerRef: AGENT_CONTROLLER_REF,
    },
    contextIdMappingSpec: {
      sourceField: "CODEX_SESSION_ID",
      mappingVersion: 1,
    },
    dispatchRulesSnapshot: {
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
    },
    dispatchSnapshot: {
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      targetBindingState: "bound",
      targetBindingEnabled: true,
    },
    sourceSignalSnapshot: {
      text: "@Split Gate Agent please take this",
      profileId: "hum_dispatch_split_gate_author",
      profileKind: "human",
    },
    idempotencyKey: `8:sig-dispatch-split-gate|40:${TARGET_PROFILE_ID}`,
    enqueuedAtMs: NOW_MS,
  };
}

// Seed an enabled_primary binding + a matching runtime registry record in
// OPENMELD_LOCAL_STATE_DB. The binding's openmeld_service_runtime_id MUST equal the
// registry record's id so the offline blocker's second read
// (readRuntimeRegistryRecordByRuntimeId(binding.openMeldServiceRuntimeId)) also
// resolves — exercising BOTH local-state reads end-to-end before the offline
// RuntimeTransport route aborts delivery.
async function seedLocalStateRouteEvidence(): Promise<void> {
  const localStateDbHandle = env.OPENMELD_LOCAL_STATE_DB as D1Database;
  const runtimeLookupInput = createRuntimeLookupInput({
    deviceId: DEVICE_ID,
    lane: "dev-local",
    owner: { id: OWNER_USER_ID, kind: "owner_account" },
  });
  const openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
    lookupInput: runtimeLookupInput,
    openMeldServiceRuntimeId: RUNTIME_ID,
    source: "runtime_registry_authority",
  });
  await registerRuntimeRegistryRecord({
    db: localStateDbHandle,
    record: { nowMs: NOW_MS, openMeldServiceRuntimeId, runtimeLookupInput },
  });
  await ensurePrimaryAgentProfileBindingRecord({
    db: localStateDbHandle,
    record: {
      agentProfileId: TARGET_PROFILE_ID,
      bindingId: BINDING_ID,
      agentControllerRef: AGENT_CONTROLLER_REF,
      createdAtMs: NOW_MS,
      owner: { id: OWNER_USER_ID, kind: "owner_account" },
      openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
      updatedAtMs: NOW_MS,
    },
  });
}

describe("dispatch execution path routes local-state reads under the split schema", () => {
  it("reaches the offline-route local-state reads on OPENMELD_LOCAL_STATE_DB (no misroute to wake-evidence)", async () => {
    await seedLocalStateRouteEvidence();
    const splitEnv = buildSplitEnv();
    const wakeEvidenceDbHandle = wakeEvidenceDb(splitEnv);
    if (!wakeEvidenceDbHandle) {
      throw new Error(
        "split-gate requires OPENMELD_WAKE_EVIDENCE_DB to be bound"
      );
    }

    // No RuntimeTransport registration ⇒ lookupRuntimeTransportRoute returns offline ⇒ the
    // offline branch runs resolveOfflineRouteServiceUpdateBlocker, which reads
    // openMeldDaemon_agent_profile_bindings then openMeldDaemon_runtime_registry_records (LOCAL
    // STATE) on the resolved local-state handle. With the bug those reads ran
    // on `db` (wake-evidence) and raised `no such table`. The call then aborts
    // with a route-offline validation error — EXPECTED, and proof the reads
    // succeeded before delivery aborted.
    const fault = await schemaFaultFrom(
      "deliverDispatchMessageToDaemon(offline route)",
      () =>
        deliverDispatchMessageToDaemon({
          attemptId: "attempt-dispatch-split-gate",
          db: wakeEvidenceDbHandle,
          env: splitEnv,
          message: buildDispatchMessage(),
          targetOwnerUserId: OWNER_USER_ID,
        })
    );

    expect(fault).toBeNull();
  });

  it("confirms the route-offline error fires (not a swallowed pass) so the local-state reads truly ran", async () => {
    await seedLocalStateRouteEvidence();
    const splitEnv = buildSplitEnv();
    const wakeEvidenceDbHandle = wakeEvidenceDb(splitEnv);
    if (!wakeEvidenceDbHandle) {
      throw new Error(
        "split-gate requires OPENMELD_WAKE_EVIDENCE_DB to be bound"
      );
    }

    // The dispatch path must THROW (offline route): a non-throwing return would
    // mean the path short-circuited before reaching the local-state reads, which
    // would make the "no schema fault" assertion vacuous. The thrown error must
    // NOT be a schema fault.
    await expect(
      deliverDispatchMessageToDaemon({
        attemptId: "attempt-dispatch-split-gate-2",
        db: wakeEvidenceDbHandle,
        env: splitEnv,
        message: buildDispatchMessage(),
        targetOwnerUserId: OWNER_USER_ID,
      })
    ).rejects.toThrow(ROUTE_ABORTED);

    const fault = await schemaFaultFrom(
      "deliverDispatchMessageToDaemon(offline route, repeat)",
      () =>
        deliverDispatchMessageToDaemon({
          attemptId: "attempt-dispatch-split-gate-3",
          db: wakeEvidenceDbHandle,
          env: splitEnv,
          message: buildDispatchMessage(),
          targetOwnerUserId: OWNER_USER_ID,
        })
    );
    expect(fault).toBeNull();
  });

  it("NEGATIVE CONTROL: the SAME local-state read on the wake-evidence handle throws no such table", async () => {
    await seedLocalStateRouteEvidence();
    const splitEnv = buildSplitEnv();
    const wakeEvidenceDbHandle = wakeEvidenceDb(splitEnv);
    const localStateDbHandle = localStateDb(splitEnv);
    if (!(wakeEvidenceDbHandle && localStateDbHandle)) {
      throw new Error(
        "split-gate requires both per-domain handles to be bound"
      );
    }

    // Proves the trap is live: the binding table genuinely does NOT exist on the
    // wake-evidence DB, so step-1's "no schema fault" is real evidence the fix
    // routes to local-state — not a vacuous pass against a DB that happens to
    // hold every table. The exact read the offline blocker performs
    // (readPrimaryAgentProfileBindingRecord) is driven on the WRONG domain.
    await expect(
      readPrimaryAgentProfileBindingRecord({
        agentProfileId: TARGET_PROFILE_ID,
        db: wakeEvidenceDbHandle,
        owner: { id: OWNER_USER_ID, kind: "owner_account" },
      })
    ).rejects.toThrow(SCHEMA_FAULT);

    // ...and the same read on the CORRECT domain returns the seeded binding,
    // confirming the seed landed and the read itself is sound.
    const binding = await readPrimaryAgentProfileBindingRecord({
      agentProfileId: TARGET_PROFILE_ID,
      db: localStateDbHandle,
      owner: { id: OWNER_USER_ID, kind: "owner_account" },
    });
    expect(binding?.bindingState).toBe("enabled_primary");
  });
});
