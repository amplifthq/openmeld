import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { rpcGetPrepareReadiness } from "../src/rpc/methods";
import { acceptRuntimeAgentControllerReportRecord } from "../src/runtime-registry/infrastructure/d1/runtime-agent-controller-report-repo";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";
import {
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const DEFAULT_CONTEXT: OpenMeldRequestContext = {
  actorContext: {
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "owner-1",
    profileKind: "human",
    profileName: "Mira",
    requestId: "req-prepare-readiness",
  },
};

describe("prepare readiness Core RPC read", () => {
  it("returns fresh ready evidence from Runtime Registry and Runtime Agent Controller Report facts", async () => {
    const harness = createSqliteD1Harness();
    applyRuntimeReadinessMigrations(harness);
    try {
      const nowMs = Date.now();
      const runtimeLookupInput = lookupInput("owner-1", "device-1");
      const registeredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        "runtime_opaque_1"
      );
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: 100,
          openMeldServiceRuntimeId: registeredRuntimeId,
          runtimeLookupInput,
        },
      });
      await acceptRuntimeAgentControllerReportRecord({
        db: harness.db,
        nowMs,
        report: {
          agentControllerRef: "builtin:codex",
          expiresAtMs: nowMs + 60_000,
          observedAtMs: nowMs,
          reasonCodes: ["runtime.agent_controller_report.ready"],
          openMeldServiceRuntimeId: registeredRuntimeId,
          status: "ready",
        },
      });

      await expect(
        rpcGetPrepareReadiness(coreEnv(harness.db), {
          agentControllerRefs: ["builtin:codex"],
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
        })
      ).resolves.toMatchObject({
        agentControllerReportsRead: true,
        nonRunnableCapabilities: [],
        runnableCapabilities: [
          {
            agentControllerRef: "builtin:codex",
            status: "ready",
          },
        ],
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
        status: "ready",
        summary: {
          ready: true,
        },
      });
    } finally {
      harness.close();
    }
  });
});

function coreEnv(db: D1Database): CoreBindings {
  return {
    OPENMELD_DB: db,
    OPENMELD_SPACES: {} as CoreBindings["OPENMELD_SPACES"],
  };
}

function applyRuntimeReadinessMigrations(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
  applyMigrationForTable(
    harness,
    "openMeldDaemon_runtime_agent_controller_reports"
  );
}

function lookupInput(ownerId: string, deviceId: string): RuntimeLookupInput {
  return createRuntimeLookupInput({
    deviceId,
    lane: "openmeld-dev",
    owner: {
      id: ownerId,
      kind: "owner_account",
    },
  });
}

function openMeldServiceRuntimeId(
  lookup: RuntimeLookupInput,
  value: string
): AuthorityOpenMeldServiceRuntimeId {
  return createAuthorityOpenMeldServiceRuntimeId({
    lookupInput: lookup,
    openMeldServiceRuntimeId: value,
    source: "runtime_registry_authority",
  });
}
