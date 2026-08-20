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
import {
  listOwnedDeviceExecutionTargetRecords,
  registerRuntimeRegistryRecord,
} from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";
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

  it("projects fresh, stale, unsupported, and multiple usage windows without dropping the controller", async () => {
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
      await acceptRuntimeAgentControllerReportRecord({
        db: harness.db,
        nowMs: 2000,
        report: {
          agentControllerRef: "builtin:codex",
          agentControllerInterface: usageSnapshot(),
          expiresAtMs: 2_000_000,
          observedAtMs: 1000,
          reasonCodes: ["runtime.agent_controller_report.ready"],
          openMeldServiceRuntimeId: registeredRuntimeId,
          status: "ready",
        },
      });

      const storedReports = await readCurrentRuntimeAgentControllerReports({
        db: harness.db,
        openMeldServiceRuntimeId: registeredRuntimeId,
      });
      expect(
        storedReports[0]?.agentControllerInterface?.usageLimits
      ).toMatchObject([
        { key: "codex:primary", status: "available", usedPercent: 42 },
        { key: "codex:secondary", status: "exhausted", usedPercent: 100 },
        {
          key: "provider-unavailable",
          status: "unavailable",
          usedPercent: null,
        },
        { key: "provider", status: "unsupported", usedPercent: null },
      ]);

      const fresh = await listOwnedDeviceExecutionTargetRecords({
        db: harness.db,
        nowMs: 1_200_999,
        userId: "owner-1",
      });
      expect(fresh[0]?.agentControllerInterface?.usageLimits).toMatchObject([
        { key: "codex:primary", status: "available", usedPercent: 42 },
        { key: "codex:secondary", status: "exhausted", usedPercent: 100 },
        {
          key: "provider-unavailable",
          status: "unavailable",
          usedPercent: null,
        },
        { key: "provider", status: "unsupported", usedPercent: null },
      ]);

      const stale = await listOwnedDeviceExecutionTargetRecords({
        db: harness.db,
        nowMs: 1_201_000,
        userId: "owner-1",
      });
      expect(stale[0]?.capabilityStatus).toBe("ready");
      expect(stale[0]?.agentControllerInterface?.usageLimits).toMatchObject([
        { key: "codex:primary", status: "stale", usedPercent: 42 },
        { key: "codex:secondary", status: "stale", usedPercent: 100 },
        {
          key: "provider-unavailable",
          status: "unavailable",
          usedPercent: null,
        },
        { key: "provider", status: "unsupported", usedPercent: null },
      ]);

      const offline = await listOwnedDeviceExecutionTargetRecords({
        db: harness.db,
        nowMs: 2_000_000,
        userId: "owner-1",
      });
      expect(offline[0]?.capabilityStatus).toBe("stale");
      expect(offline[0]?.agentControllerInterface?.usageLimits).toMatchObject([
        { key: "codex:primary", status: "stale", usedPercent: 42 },
        { key: "codex:secondary", status: "stale", usedPercent: 100 },
        {
          key: "provider-unavailable",
          status: "unavailable",
          usedPercent: null,
        },
        { key: "provider", status: "unsupported", usedPercent: null },
      ]);
    } finally {
      harness.close();
    }
  });
});

function usageSnapshot() {
  const observedAt = "1970-01-01T00:00:01.000Z";
  return {
    agentControllerRef: "builtin:codex",
    auth: { status: "authenticated" as const },
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: false,
    },
    checkedAt: observedAt,
    controllerId: "codex",
    displayName: "Codex",
    launch: {
      argsPrefix: [],
      commandPath: "/usr/local/bin/codex",
      installChoiceCount: 1,
      status: "ready" as const,
    },
    message: null,
    models: [],
    nativeInterface: "codex-app-server" as const,
    schemaVersion: 1 as const,
    skills: [],
    status: "ready" as const,
    usageLimits: [
      {
        key: "codex:primary",
        label: "5-hour usage",
        observedAt,
        resetsAt: "1970-01-01T05:00:01.000Z",
        status: "available" as const,
        usedPercent: 42,
      },
      {
        key: "codex:secondary",
        label: "Weekly usage",
        observedAt,
        resetsAt: "1970-01-08T00:00:01.000Z",
        status: "exhausted" as const,
        usedPercent: 100,
      },
      {
        key: "provider-unavailable",
        label: "Usage limits",
        observedAt,
        resetsAt: null,
        status: "unavailable" as const,
        usedPercent: null,
      },
      {
        key: "provider",
        label: "Usage limits",
        observedAt,
        resetsAt: null,
        status: "unsupported" as const,
        usedPercent: null,
      },
    ],
    version: "0.148.0",
  };
}

function lookupInput(ownerId: string, deviceId: string): RuntimeLookupInput {
  return createRuntimeLookupInput({
    deviceId,
    lane: "dev-local",
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
