import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import {
  acceptRuntimeAgentControllerReportRecord,
  readCurrentRuntimeAgentControllerReports,
} from "../src/runtime-registry/infrastructure/d1/runtime-agent-controller-report-repo";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";
import {
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("runtime agent controller report repo read-side", () => {
  it("reads current reports for one authority Runtime without returning other Runtime facts", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    try {
      const firstLookupInput = lookupInput("owner-1", "device-1");
      const secondLookupInput = lookupInput("owner-2", "device-2");
      const firstRuntimeId = openMeldServiceRuntimeId(
        firstLookupInput,
        "runtime_opaque_1"
      );
      const secondRuntimeId = openMeldServiceRuntimeId(
        secondLookupInput,
        "runtime_opaque_2"
      );
      await registerRuntime(harness.db, firstLookupInput, firstRuntimeId);
      await registerRuntime(harness.db, secondLookupInput, secondRuntimeId);
      await writeReport(harness.db, firstRuntimeId, "builtin:codex", "ready");
      await writeReport(
        harness.db,
        firstRuntimeId,
        "builtin:claude",
        "disabled"
      );
      await writeReport(harness.db, secondRuntimeId, "builtin:codex", "ready");

      await expect(
        readCurrentRuntimeAgentControllerReports({
          db: harness.db,
          openMeldServiceRuntimeId: firstRuntimeId,
        })
      ).resolves.toMatchObject([
        {
          agentControllerRef: "builtin:claude",
          openMeldServiceRuntimeId: firstRuntimeId,
          status: "disabled",
        },
        {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: firstRuntimeId,
          status: "ready",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("filters current reports by valid Agent Controller refs", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
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
      await writeReport(
        harness.db,
        registeredRuntimeId,
        "builtin:codex",
        "ready"
      );
      await writeReport(
        harness.db,
        registeredRuntimeId,
        "builtin:claude",
        "disabled"
      );

      await expect(
        readCurrentRuntimeAgentControllerReports({
          agentControllerRefs: ["builtin:codex"],
          db: harness.db,
          openMeldServiceRuntimeId: registeredRuntimeId,
        })
      ).resolves.toMatchObject([
        {
          agentControllerRef: "builtin:codex",
          status: "ready",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("rejects openMeldServiceRuntimeId values that do not carry Runtime Registry authority source", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    try {
      await expect(
        readCurrentRuntimeAgentControllerReports({
          db: harness.db,
          openMeldServiceRuntimeId: {
            source: "client_computed",
            value: "runtime_opaque_1",
          } as unknown as AuthorityOpenMeldServiceRuntimeId,
        })
      ).rejects.toThrow(
        "openMeldServiceRuntimeId must come from Runtime Registry authority"
      );
    } finally {
      harness.close();
    }
  });
});

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

async function writeReport(
  db: D1Database,
  openMeldServiceRuntimeIdValue: AuthorityOpenMeldServiceRuntimeId,
  agentControllerRef: string,
  status: "disabled" | "ready"
): Promise<void> {
  await acceptRuntimeAgentControllerReportRecord({
    db,
    nowMs: 2000,
    report: {
      agentControllerRef,
      expiresAtMs: 5000,
      observedAtMs: 1000,
      reasonCodes: [`runtime.agent_controller_report.${status}`],
      openMeldServiceRuntimeId: openMeldServiceRuntimeIdValue,
      status,
    },
  });
}
