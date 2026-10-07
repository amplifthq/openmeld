import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { rpcGetPrepareReadiness } from "../src/rpc/methods";
import { acceptRuntimeAgentControllerReportRecord } from "../src/runtime-registry/infrastructure/postgresql/runtime-agent-controller-report-repo";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

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
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
});

function coreEnv(db: PostgresDatabase): CoreBindings {
  return {
    OPENMELD_POSTGRESQL: postgresTestBinding(db),
    OPENMELD_SPACES: {} as CoreBindings["OPENMELD_SPACES"],
  };
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
