import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  ensurePrimaryAgentProfileBindingRecord,
  readPrimaryAgentProfileBindingRecord,
} from "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import { deliverDispatchMessageToDaemon } from "../src/dispatch/application/dispatch-execution-service";
import type { CoreBindings } from "../src/lib/bindings";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import { env } from "../test-support/worker-env";

const WAKE_READINESS_ERROR_PATTERN = /offline|service\.update_required|daemon/i;

const OWNER_USER_ID = "owner-dispatch-postgresql";
const DEVICE_ID = "device-dispatch-postgresql";
const TARGET_PROFILE_ID = "agt_f3333333-3333-4333-8333-333333333333";
const BINDING_ID = "binding-dispatch-postgresql";
const RUNTIME_ID = "runtime-dispatch-postgresql";
const AGENT_CONTROLLER_REF = "builtin:codex";
const NOW_MS = Date.parse("2026-06-14T00:00:00.000Z");
function buildDispatchMessage(): OpenMeldDaemonDispatchQueueMessage {
  return {
    v: 2,
    dispatchId: "dispatch-postgresql-owner-exec",
    spaceId: "space-dispatch-postgresql-owner",
    sourceEventId: "sig-dispatch-postgresql-owner",
    targetProfileId: TARGET_PROFILE_ID,
    targetProfileMentionLabel: "PostgreSQL Agent",
    targetProfileNameSnapshot: "PostgreSQL Agent",
    dispatchChainId: "dispatch-postgresql-owner-exec",
    autoRelayDepth: 0,
    visitedProfileIds: [],
    visitedProfileIdsHash: "stable32:dispatchsplitgate",
    dispatchContractVersion: 2,
    dispatchPolicy: "mention_only",
    ruleSource: "registry",
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
    taskId: "task-dispatch-postgresql-owner",
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
      text: "@PostgreSQL Agent please take this",
      profileId: "hum_dispatch_split_gate_author",
      profileKind: "human",
    },
    idempotencyKey: `8:sig-dispatch-postgresql-owner|40:${TARGET_PROFILE_ID}`,
    enqueuedAtMs: NOW_MS,
  };
}

async function seedRouteEvidence() {
  const db = getPostgresDatabase(env);
  await db.query({
    text: `INSERT INTO "openmeld"."users" (id, name, email, created_at, updated_at)
    VALUES ($1, 'Owner', 'dispatch-owner@example.test', $2, $2) ON CONFLICT DO NOTHING`,
    values: [OWNER_USER_ID, NOW_MS],
  });
  await db.query(`INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
    VALUES ('org-dispatch-postgresql', 'Organization', 'dispatch-postgresql', 1000) ON CONFLICT DO NOTHING`);
  await db.query({
    text: `INSERT INTO "openmeld"."openmeld_profiles"
    (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, source)
    VALUES ($1, 'Agent', 'postgresql-dispatch', 'agent', 'org-dispatch-postgresql', $2, 'migration') ON CONFLICT DO NOTHING`,
    values: [TARGET_PROFILE_ID, OWNER_USER_ID],
  });
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
    db,
    record: { nowMs: NOW_MS, openMeldServiceRuntimeId, runtimeLookupInput },
  });
  await ensurePrimaryAgentProfileBindingRecord({
    db,
    record: {
      agentProfileId: TARGET_PROFILE_ID,
      bindingId: BINDING_ID,
      agentControllerRef: AGENT_CONTROLLER_REF,
      createdAtMs: NOW_MS,
      owner: { id: OWNER_USER_ID, kind: "owner_account" },
      openMeldServiceRuntimeId: RUNTIME_ID,
      updatedAtMs: NOW_MS,
    },
  });
  return db;
}
describe("PostgreSQL dispatch execution wiring", () => {
  it("reads the canonical Binding and Runtime before reporting the real offline transport outcome", async () => {
    const db = await seedRouteEvidence();
    expect(
      await readPrimaryAgentProfileBindingRecord({
        db,
        agentProfileId: TARGET_PROFILE_ID,
        owner: { id: OWNER_USER_ID, kind: "owner_account" },
      })
    ).toMatchObject({ bindingId: BINDING_ID, bindingState: "enabled_primary" });
    await expect(
      deliverDispatchMessageToDaemon({
        db,
        env: env as CoreBindings,
        attemptId: "attempt-postgresql-owner",
        message: buildDispatchMessage(),
        targetOwnerUserId: OWNER_USER_ID,
      })
    ).rejects.toThrow(WAKE_READINESS_ERROR_PATTERN);
  });
});
