import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  acceptRuntimeAgentControllerReportRecord,
  readCurrentRuntimeAgentControllerReport,
} from "../src/runtime-registry/infrastructure/d1/runtime-agent-controller-report-repo";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";
import {
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const lookupInput = (): RuntimeLookupInput =>
  createRuntimeLookupInput({
    owner: {
      kind: "owner_account",
      id: "owner-1",
    },
    deviceId: "device-1",
    lane: "openmeld-dev",
  });

const openMeldServiceRuntimeId = (
  lookup: RuntimeLookupInput,
  value: string
): AuthorityOpenMeldServiceRuntimeId =>
  createAuthorityOpenMeldServiceRuntimeId({
    lookupInput: lookup,
    openMeldServiceRuntimeId: value,
    source: "runtime_registry_authority",
  });

describe("runtime agent controller report repo write-side", () => {
  const CODEX_AGENT_CONTROLLER_INTERFACE = {
    agentControllerRef: "builtin:codex",
    auth: { status: "authenticated", label: "Signed in" },
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: false,
    },
    checkedAt: "2026-06-28T00:00:00.000Z",
    controllerId: "codex",
    displayName: "Codex",
    launch: {
      argsPrefix: [],
      commandPath: "/usr/local/bin/codex",
      installChoiceCount: 1,
      status: "ready",
    },
    message: null,
    models: [{ id: "gpt-5.5", displayName: "GPT-5.5" }],
    nativeInterface: "codex-app-server",
    schemaVersion: 1,
    skills: [],
    status: "ready",
    version: "0.1.0",
  } satisfies AgentControllerInterfaceSnapshot;

  it("creates and reads one current report for an existing registered Runtime", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    try {
      const runtimeLookupInput = lookupInput();
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

      await expect(
        acceptRuntimeAgentControllerReportRecord({
          db: harness.db,
          nowMs: 2000,
          report: {
            agentControllerRef: "builtin:codex",
            agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
            expiresAtMs: 5000,
            observedAtMs: 1000,
            reasonCodes: ["runtime.agent_controller_report.available"],
            openMeldServiceRuntimeId: registeredRuntimeId,
            status: "ready",
          },
        })
      ).resolves.toEqual({
        currentReport: {
          agentControllerRef: "builtin:codex",
          agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
          expiresAtMs: 5000,
          observedAtMs: 1000,
          reasonCodes: ["runtime.agent_controller_report.available"],
          openMeldServiceRuntimeId: registeredRuntimeId,
          status: "ready",
        },
        outcome: "created",
        status: "accepted",
      });

      await expect(
        readCurrentRuntimeAgentControllerReport({
          agentControllerRef: "builtin:codex",
          db: harness.db,
          openMeldServiceRuntimeId: registeredRuntimeId,
        })
      ).resolves.toEqual({
        agentControllerRef: "builtin:codex",
        agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
        expiresAtMs: 5000,
        observedAtMs: 1000,
        reasonCodes: ["runtime.agent_controller_report.available"],
        openMeldServiceRuntimeId: registeredRuntimeId,
        status: "ready",
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a current report for an unregistered Runtime without writing", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    try {
      const runtimeLookupInput = lookupInput();
      const unregisteredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        "runtime_unregistered"
      );

      await expect(
        acceptRuntimeAgentControllerReportRecord({
          db: harness.db,
          nowMs: 2000,
          report: {
            agentControllerRef: "builtin:codex",
            expiresAtMs: 5000,
            observedAtMs: 1000,
            reasonCodes: [],
            openMeldServiceRuntimeId: unregisteredRuntimeId,
            status: "ready",
          },
        })
      ).resolves.toEqual({
        reason: "runtime_missing",
        status: "rejected",
      });

      expect(
        harness.queryAll<{ openmeld_service_runtime_id: string }>({
          sql: "SELECT openmeld_service_runtime_id FROM openMeldDaemon_runtime_agent_controller_reports",
        })
      ).toEqual([]);
    } finally {
      harness.close();
    }
  });

  it("reuses the current report for an identical retry", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    try {
      const runtimeLookupInput = lookupInput();
      const registeredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        "runtime_opaque_1"
      );
      const report = {
        agentControllerRef: "builtin:codex",
        expiresAtMs: 5000,
        observedAtMs: 1000,
        reasonCodes: ["runtime.agent_controller_report.available"],
        openMeldServiceRuntimeId: registeredRuntimeId,
        status: "ready" as const,
      };
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
        nowMs: 2000,
        report,
      });

      await expect(
        acceptRuntimeAgentControllerReportRecord({
          db: harness.db,
          nowMs: 2500,
          report,
        })
      ).resolves.toEqual({
        currentReport: report,
        outcome: "reused",
        status: "accepted",
      });
      expect(
        harness.queryAll<{ openmeld_service_runtime_id: string }>({
          sql: "SELECT openmeld_service_runtime_id FROM openMeldDaemon_runtime_agent_controller_reports",
        })
      ).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("rejects an older report without mutating the current report", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    try {
      const runtimeLookupInput = lookupInput();
      const registeredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        "runtime_opaque_1"
      );
      const currentReport = {
        agentControllerRef: "builtin:codex",
        expiresAtMs: 8000,
        observedAtMs: 4000,
        reasonCodes: ["runtime.agent_controller_report.available"],
        openMeldServiceRuntimeId: registeredRuntimeId,
        status: "ready" as const,
      };
      const olderReport = {
        ...currentReport,
        expiresAtMs: 9000,
        observedAtMs: 3000,
        reasonCodes: ["runtime.agent_controller_report.old"],
        status: "unavailable" as const,
      };
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
        nowMs: 5000,
        report: currentReport,
      });

      await expect(
        acceptRuntimeAgentControllerReportRecord({
          db: harness.db,
          nowMs: 5500,
          report: olderReport,
        })
      ).resolves.toEqual({
        currentReport,
        reason: "out_of_order",
        status: "rejected",
      });
      await expect(
        readCurrentRuntimeAgentControllerReport({
          agentControllerRef: "builtin:codex",
          db: harness.db,
          openMeldServiceRuntimeId: registeredRuntimeId,
        })
      ).resolves.toEqual(currentReport);
    } finally {
      harness.close();
    }
  });

  it("rejects a conflicting same-observedAt report without mutating the current report", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    try {
      const runtimeLookupInput = lookupInput();
      const registeredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        "runtime_opaque_1"
      );
      const currentReport = {
        agentControllerRef: "builtin:codex",
        expiresAtMs: 8000,
        observedAtMs: 4000,
        reasonCodes: ["runtime.agent_controller_report.available"],
        openMeldServiceRuntimeId: registeredRuntimeId,
        status: "ready" as const,
      };
      const conflictingReport = {
        ...currentReport,
        reasonCodes: ["runtime.agent_controller_report.disabled"],
        status: "disabled" as const,
      };
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
        nowMs: 5000,
        report: currentReport,
      });

      await expect(
        acceptRuntimeAgentControllerReportRecord({
          db: harness.db,
          nowMs: 5500,
          report: conflictingReport,
        })
      ).resolves.toEqual({
        currentReport,
        reason: "conflict",
        status: "rejected",
      });
      await expect(
        readCurrentRuntimeAgentControllerReport({
          agentControllerRef: "builtin:codex",
          db: harness.db,
          openMeldServiceRuntimeId: registeredRuntimeId,
        })
      ).resolves.toEqual(currentReport);
    } finally {
      harness.close();
    }
  });

  it.each([
    "disabled",
    "unavailable",
    "unknown",
  ] as const)("accepts %s as a current Runtime report fact only", async (status) => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    try {
      const runtimeLookupInput = lookupInput();
      const registeredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        `runtime_${status}`
      );
      const report = {
        agentControllerRef: "builtin:codex",
        expiresAtMs: 5000,
        observedAtMs: 1000,
        reasonCodes: [`runtime.agent_controller_report.${status}`],
        openMeldServiceRuntimeId: registeredRuntimeId,
        status,
      };
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: 100,
          openMeldServiceRuntimeId: registeredRuntimeId,
          runtimeLookupInput,
        },
      });

      await expect(
        acceptRuntimeAgentControllerReportRecord({
          db: harness.db,
          nowMs: 2000,
          report,
        })
      ).resolves.toEqual({
        currentReport: report,
        outcome: "created",
        status: "accepted",
      });
      expect(
        harness.queryAll<{
          report_status: string;
        }>({
          sql: "SELECT report_status FROM openMeldDaemon_runtime_agent_controller_reports",
        })
      ).toEqual([{ report_status: status }]);
    } finally {
      harness.close();
    }
  });

  it("returns explicit missing when no current report exists", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    try {
      const runtimeLookupInput = lookupInput();
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

      await expect(
        readCurrentRuntimeAgentControllerReport({
          agentControllerRef: "builtin:codex",
          db: harness.db,
          openMeldServiceRuntimeId: registeredRuntimeId,
        })
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("converges concurrent duplicate reports to one current fact", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    try {
      const runtimeLookupInput = lookupInput();
      const registeredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        "runtime_opaque_1"
      );
      const report = {
        agentControllerRef: "builtin:codex",
        expiresAtMs: 5000,
        observedAtMs: 1000,
        reasonCodes: ["runtime.agent_controller_report.available"],
        openMeldServiceRuntimeId: registeredRuntimeId,
        status: "ready" as const,
      };
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: 100,
          openMeldServiceRuntimeId: registeredRuntimeId,
          runtimeLookupInput,
        },
      });

      const results = await Promise.all([
        acceptRuntimeAgentControllerReportRecord({
          db: harness.db,
          nowMs: 2000,
          report,
        }),
        acceptRuntimeAgentControllerReportRecord({
          db: harness.db,
          nowMs: 2001,
          report,
        }),
      ]);

      expect(results.map((result) => result.status)).toEqual([
        "accepted",
        "accepted",
      ]);
      expect(
        results.map((result) =>
          result.status === "accepted" ? result.currentReport : null
        )
      ).toEqual([report, report]);
      expect(
        harness.queryAll<{ openmeld_service_runtime_id: string }>({
          sql: "SELECT openmeld_service_runtime_id FROM openMeldDaemon_runtime_agent_controller_reports",
        })
      ).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("converges concurrent first reports so the newer observation wins", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    try {
      const runtimeLookupInput = lookupInput();
      const registeredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        "runtime_opaque_1"
      );
      const olderReport = {
        agentControllerRef: "builtin:codex",
        expiresAtMs: 5000,
        observedAtMs: 1000,
        reasonCodes: ["runtime.agent_controller_report.available"],
        openMeldServiceRuntimeId: registeredRuntimeId,
        status: "ready" as const,
      };
      const newerReport = {
        ...olderReport,
        expiresAtMs: 7000,
        observedAtMs: 3000,
        reasonCodes: ["runtime.agent_controller_report.disabled"],
        status: "disabled" as const,
      };
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: 100,
          openMeldServiceRuntimeId: registeredRuntimeId,
          runtimeLookupInput,
        },
      });

      const results = await Promise.all([
        acceptRuntimeAgentControllerReportRecord({
          db: harness.db,
          nowMs: 2000,
          report: olderReport,
        }),
        acceptRuntimeAgentControllerReportRecord({
          db: harness.db,
          nowMs: 4000,
          report: newerReport,
        }),
      ]);

      expect(results.map((result) => result.status)).toEqual([
        "accepted",
        "accepted",
      ]);
      await expect(
        readCurrentRuntimeAgentControllerReport({
          agentControllerRef: "builtin:codex",
          db: harness.db,
          openMeldServiceRuntimeId: registeredRuntimeId,
        })
      ).resolves.toEqual(newerReport);
      expect(
        harness.queryAll<{ openmeld_service_runtime_id: string }>({
          sql: "SELECT openmeld_service_runtime_id FROM openMeldDaemon_runtime_agent_controller_reports",
        })
      ).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("keeps the first current fact when concurrent first reports conflict at the same observedAt", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    try {
      const runtimeLookupInput = lookupInput();
      const registeredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        "runtime_opaque_1"
      );
      const readyReport = {
        agentControllerRef: "builtin:codex",
        expiresAtMs: 5000,
        observedAtMs: 1000,
        reasonCodes: ["runtime.agent_controller_report.available"],
        openMeldServiceRuntimeId: registeredRuntimeId,
        status: "ready" as const,
      };
      const disabledReport = {
        ...readyReport,
        reasonCodes: ["runtime.agent_controller_report.disabled"],
        status: "disabled" as const,
      };
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: 100,
          openMeldServiceRuntimeId: registeredRuntimeId,
          runtimeLookupInput,
        },
      });

      const results = await Promise.all([
        acceptRuntimeAgentControllerReportRecord({
          db: harness.db,
          nowMs: 2000,
          report: readyReport,
        }),
        acceptRuntimeAgentControllerReportRecord({
          db: harness.db,
          nowMs: 2001,
          report: disabledReport,
        }),
      ]);

      expect(results).toEqual([
        {
          currentReport: readyReport,
          outcome: "created",
          status: "accepted",
        },
        {
          currentReport: readyReport,
          reason: "conflict",
          status: "rejected",
        },
      ]);
      await expect(
        readCurrentRuntimeAgentControllerReport({
          agentControllerRef: "builtin:codex",
          db: harness.db,
          openMeldServiceRuntimeId: registeredRuntimeId,
        })
      ).resolves.toEqual(readyReport);
      expect(
        harness.queryAll<{ openmeld_service_runtime_id: string }>({
          sql: "SELECT openmeld_service_runtime_id FROM openMeldDaemon_runtime_agent_controller_reports",
        })
      ).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("replaces the current fact when a newer report arrives", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    try {
      const runtimeLookupInput = lookupInput();
      const registeredRuntimeId = openMeldServiceRuntimeId(
        runtimeLookupInput,
        "runtime_opaque_1"
      );
      const firstReport = {
        agentControllerRef: "builtin:codex",
        expiresAtMs: 5000,
        observedAtMs: 1000,
        reasonCodes: ["runtime.agent_controller_report.available"],
        openMeldServiceRuntimeId: registeredRuntimeId,
        status: "ready" as const,
      };
      const newerReport = {
        ...firstReport,
        expiresAtMs: 7000,
        observedAtMs: 3000,
        reasonCodes: ["runtime.agent_controller_report.disabled"],
        status: "disabled" as const,
      };
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
        nowMs: 2000,
        report: firstReport,
      });

      await expect(
        acceptRuntimeAgentControllerReportRecord({
          db: harness.db,
          nowMs: 4000,
          report: newerReport,
        })
      ).resolves.toEqual({
        currentReport: newerReport,
        outcome: "updated",
        status: "accepted",
      });
      await expect(
        readCurrentRuntimeAgentControllerReport({
          agentControllerRef: "builtin:codex",
          db: harness.db,
          openMeldServiceRuntimeId: registeredRuntimeId,
        })
      ).resolves.toEqual(newerReport);
      expect(
        harness.queryAll<{ openmeld_service_runtime_id: string }>({
          sql: "SELECT openmeld_service_runtime_id FROM openMeldDaemon_runtime_agent_controller_reports",
        })
      ).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("rejects a stale report without writing current facts", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    try {
      const runtimeLookupInput = lookupInput();
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

      await expect(
        acceptRuntimeAgentControllerReportRecord({
          db: harness.db,
          nowMs: 5000,
          report: {
            agentControllerRef: "builtin:codex",
            expiresAtMs: 5000,
            observedAtMs: 1000,
            reasonCodes: [],
            openMeldServiceRuntimeId: registeredRuntimeId,
            status: "ready",
          },
        })
      ).resolves.toEqual({
        reason: "stale",
        status: "rejected",
      });
      expect(
        harness.queryAll<{ openmeld_service_runtime_id: string }>({
          sql: "SELECT openmeld_service_runtime_id FROM openMeldDaemon_runtime_agent_controller_reports",
        })
      ).toEqual([]);
    } finally {
      harness.close();
    }
  });
});
