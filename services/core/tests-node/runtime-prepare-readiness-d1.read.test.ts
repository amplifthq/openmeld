import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import { acceptRuntimeAgentControllerReportRecord } from "../src/runtime-registry/infrastructure/d1/runtime-agent-controller-report-repo";
import { resolveRuntimePrepareReadinessFromD1 } from "../src/runtime-registry/infrastructure/d1/runtime-prepare-readiness-d1";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";
import {
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("runtime prepare readiness D1 read model", () => {
  it("returns missing Runtime evidence from D1 without reading agent controller report storage", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    try {
      await expect(
        resolveRuntimePrepareReadinessFromD1({
          agentControllerRefsToEvaluate: ["builtin:codex"],
          db: harness.db,
          nowMs: 2000,
          runtimeLookupInput: lookupInput("owner-1", "device-1"),
        })
      ).resolves.toMatchObject({
        agentControllerReportsRead: false,
        reason: "runtime_missing",
        status: "not_ready",
        summary: {
          ready: false,
          reasonCodes: ["runtime.missing"],
        },
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a supplied openMeldServiceRuntimeId that does not match Runtime Registry lookup", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    try {
      const runtimeLookupInput = lookupInput("owner-1", "device-1");
      const registeredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        "runtime_registered"
      );
      await registerRuntime(
        harness.db,
        runtimeLookupInput,
        registeredRuntimeId
      );

      await expect(
        resolveRuntimePrepareReadinessFromD1({
          agentControllerRefsToEvaluate: ["builtin:codex"],
          db: harness.db,
          nowMs: 2000,
          openMeldServiceRuntimeId: openMeldServiceRuntimeId(
            runtimeLookupInput,
            "runtime_submitted"
          ),
          runtimeLookupInput,
        })
      ).resolves.toMatchObject({
        agentControllerReportsRead: false,
        reason: "openmeld_service_runtime_id_mismatch",
        status: "not_ready",
        summary: {
          ready: false,
          reasonCodes: ["runtime.id_mismatch"],
        },
      });
    } finally {
      harness.close();
    }
  });

  it("returns invalid capability evidence without reading agent controller report storage", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    try {
      const runtimeLookupInput = lookupInput("owner-1", "device-1");
      const registeredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        "runtime_opaque_1"
      );
      await registerRuntime(
        harness.db,
        runtimeLookupInput,
        registeredRuntimeId
      );

      await expect(
        resolveRuntimePrepareReadinessFromD1({
          agentControllerRefsToEvaluate: ["codex"],
          db: harness.db,
          nowMs: 2000,
          runtimeLookupInput,
        })
      ).resolves.toMatchObject({
        agentControllerReportsRead: false,
        nonRunnableCapabilities: [
          {
            agentControllerRef: "codex",
            reasonCodes: ["runtime.agent_controller_ref_invalid"],
            status: "invalid",
          },
        ],
        reason: "runtime_not_ready",
        status: "not_ready",
        summary: {
          ready: false,
        },
      });
    } finally {
      harness.close();
    }
  });

  it("uses Runtime Registry and current agent controller report facts without marking stale facts ready", async () => {
    const harness = createSqliteD1Harness();
    applyRuntimeReadinessMigrations(harness);
    try {
      const runtimeLookupInput = lookupInput("owner-1", "device-1");
      const registeredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        "runtime_opaque_1"
      );
      await registerRuntime(
        harness.db,
        runtimeLookupInput,
        registeredRuntimeId
      );
      await writeReport({
        agentControllerRef: "builtin:codex",
        db: harness.db,
        expiresAtMs: 2000,
        openMeldServiceRuntimeId: registeredRuntimeId,
        status: "ready",
        writeNowMs: 1000,
      });

      await expect(
        resolveRuntimePrepareReadinessFromD1({
          agentControllerRefsToEvaluate: ["builtin:codex"],
          db: harness.db,
          nowMs: 2000,
          runtimeLookupInput,
        })
      ).resolves.toMatchObject({
        agentControllerReportsRead: true,
        nonRunnableCapabilities: [
          {
            agentControllerRef: "builtin:codex",
            status: "stale",
          },
        ],
        reason: "runtime_not_ready",
        runnableCapabilities: [],
        status: "not_ready",
      });
    } finally {
      harness.close();
    }
  });

  it("uses fresh current agent controller report facts as runnable Prepare readiness evidence only", async () => {
    const harness = createSqliteD1Harness();
    applyRuntimeReadinessMigrations(harness);
    try {
      const runtimeLookupInput = lookupInput("owner-1", "device-1");
      const registeredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        "runtime_opaque_1"
      );
      await registerRuntime(
        harness.db,
        runtimeLookupInput,
        registeredRuntimeId
      );
      await writeReport({
        agentControllerRef: "builtin:codex",
        db: harness.db,
        expiresAtMs: 5000,
        openMeldServiceRuntimeId: registeredRuntimeId,
        status: "ready",
      });

      const result = await resolveRuntimePrepareReadinessFromD1({
        agentControllerRefsToEvaluate: ["builtin:codex"],
        db: harness.db,
        nowMs: 2000,
        runtimeLookupInput,
      });

      expect(result).toMatchObject({
        agentControllerReportsRead: true,
        nonRunnableCapabilities: [],
        runnableCapabilities: [
          {
            agentControllerRef: "builtin:codex",
            status: "ready",
          },
        ],
        status: "ready",
      });
      expect(Object.keys(result).sort()).toEqual([
        "agentControllerReportsRead",
        "nonRunnableCapabilities",
        "openMeldServiceRuntimeId",
        "projection",
        "runnableCapabilities",
        "status",
        "summary",
      ]);
    } finally {
      harness.close();
    }
  });

  it("keeps non-runnable current agent controller report facts from becoming ready", async () => {
    const harness = createSqliteD1Harness();
    applyRuntimeReadinessMigrations(harness);
    try {
      const runtimeLookupInput = lookupInput("owner-1", "device-1");
      const registeredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        "runtime_opaque_1"
      );
      await registerRuntime(
        harness.db,
        runtimeLookupInput,
        registeredRuntimeId
      );
      await writeReport({
        agentControllerRef: "builtin:codex",
        db: harness.db,
        expiresAtMs: 5000,
        openMeldServiceRuntimeId: registeredRuntimeId,
        status: "disabled",
      });

      await expect(
        resolveRuntimePrepareReadinessFromD1({
          agentControllerRefsToEvaluate: ["builtin:codex"],
          db: harness.db,
          nowMs: 2000,
          runtimeLookupInput,
        })
      ).resolves.toMatchObject({
        agentControllerReportsRead: true,
        nonRunnableCapabilities: [
          {
            agentControllerRef: "builtin:codex",
            status: "disabled",
          },
        ],
        reason: "runtime_not_ready",
        runnableCapabilities: [],
        status: "not_ready",
      });
    } finally {
      harness.close();
    }
  });
});

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

async function registerRuntime(
  db: D1Database,
  runtimeLookupInput: RuntimeLookupInput,
  openMeldServiceRuntimeIdValue: AuthorityOpenMeldServiceRuntimeId
): Promise<void> {
  await registerRuntimeRegistryRecord({
    db,
    record: {
      nowMs: 100,
      openMeldServiceRuntimeId: openMeldServiceRuntimeIdValue,
      runtimeLookupInput,
    },
  });
}

async function writeReport(input: {
  agentControllerRef: string;
  db: D1Database;
  expiresAtMs: number;
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  status: "disabled" | "ready";
  writeNowMs?: number;
}): Promise<void> {
  await acceptRuntimeAgentControllerReportRecord({
    db: input.db,
    nowMs: input.writeNowMs ?? 2000,
    report: {
      agentControllerRef: input.agentControllerRef,
      expiresAtMs: input.expiresAtMs,
      observedAtMs: 1000,
      reasonCodes: [`runtime.agent_controller_report.${input.status}`],
      openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
      status: input.status,
    },
  });
}
