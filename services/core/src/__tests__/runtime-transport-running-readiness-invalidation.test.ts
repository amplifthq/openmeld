import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { afterEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as readinessImpactRepo from "../agent-execution/infrastructure/postgresql/agent-execution-readiness-impact-repo";
import { clearAgentExecutionReadinessImpactForExecutionRunning } from "../agent-execution/infrastructure/postgresql/agent-execution-readiness-impact-repo";
import { RuntimeTransportHub } from "../runtime-transport/transport/do/runtime-transport-hub";

const PROFILE_ID = "agt_00000000-0000-4000-8000-000000000001";

type RunningLifecycleHub = {
  clearReadinessImpactFromRunningLifecycle: (input: {
    executionAuthorizedAtMs: number;
    request: { attemptId: string; dispatchId: string; phase: string };
    tokenValidationContext: {
      authorityScope: {
        agentControllerRef: string;
        bindingId: string;
        openMeldServiceRuntimeId: string;
      };
      executionScope: { targetProfileId: string };
    };
  }) => Promise<void>;
  publishAgentReadinessInvalidated: (input: {
    profileIds: readonly string[];
    reason: string;
  }) => void;
};

function createRunningLifecycleHub() {
  const hub = Object.create(
    RuntimeTransportHub.prototype
  ) as RunningLifecycleHub;
  Object.defineProperty(hub, "env", {
    value: { OPENMELD_POSTGRESQL: { connectionString: "postgres://test" } },
  });
  const publish = vi.fn();
  hub.publishAgentReadinessInvalidated = publish;
  return { hub, publish };
}

function runningLifecycleInput(phase = "running") {
  return {
    executionAuthorizedAtMs: 1000,
    request: { attemptId: "attempt-1", dispatchId: "dispatch-1", phase },
    tokenValidationContext: {
      authorityScope: {
        agentControllerRef: "codex",
        bindingId: "binding-1",
        openMeldServiceRuntimeId: "runtime-1",
      },
      executionScope: { targetProfileId: PROFILE_ID },
    },
  };
}

describe("running lifecycle readiness invalidation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("broadcasts only when a running frame actually clears a readiness impact", async () => {
    const clear = vi
      .spyOn(
        readinessImpactRepo,
        "clearAgentExecutionReadinessImpactForExecutionRunning"
      )
      .mockResolvedValueOnce("cleared")
      .mockResolvedValue("unchanged");
    const { hub, publish } = createRunningLifecycleHub();

    // The first running frame clears the stale impact; the repeated progress
    // and keepalive frames of the same run find nothing left to clear.
    await hub.clearReadinessImpactFromRunningLifecycle(runningLifecycleInput());
    await hub.clearReadinessImpactFromRunningLifecycle(runningLifecycleInput());
    await hub.clearReadinessImpactFromRunningLifecycle(runningLifecycleInput());

    expect(clear).toHaveBeenCalledTimes(3);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      profileIds: [PROFILE_ID],
      reason: "matching_execution_running",
    });
  });

  it("broadcasts again when a later running frame clears a newly written impact", async () => {
    vi.spyOn(
      readinessImpactRepo,
      "clearAgentExecutionReadinessImpactForExecutionRunning"
    )
      .mockResolvedValueOnce("unchanged")
      .mockResolvedValueOnce("cleared");
    const { hub, publish } = createRunningLifecycleHub();

    await hub.clearReadinessImpactFromRunningLifecycle(runningLifecycleInput());
    expect(publish).not.toHaveBeenCalled();
    await hub.clearReadinessImpactFromRunningLifecycle(runningLifecycleInput());
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("neither clears nor broadcasts for non-running phases", async () => {
    const clear = vi.spyOn(
      readinessImpactRepo,
      "clearAgentExecutionReadinessImpactForExecutionRunning"
    );
    const { hub, publish } = createRunningLifecycleHub();

    await hub.clearReadinessImpactFromRunningLifecycle(
      runningLifecycleInput("accepted")
    );

    expect(clear).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("readiness impact clear result", () => {
  function createDb(rowCount: number | null) {
    const query = vi.fn(async () => ({ rowCount, rows: [] }));
    return { db: { query } as unknown as PostgresDatabase, query };
  }

  const clearInput = (db: PostgresDatabase) => ({
    agentProfileId: PROFILE_ID,
    clearedAtMs: 2000,
    db,
    executionAuthorizedAtMs: 1000,
    executionIdentity: {
      agentControllerRef: "codex",
      bindingId: "binding-1",
      openMeldServiceRuntimeId: "runtime-1",
    },
    sourceDispatchId: "dispatch-1",
  });

  it("reports cleared when the UPDATE changed a row", async () => {
    const { db, query } = createDb(1);
    await expect(
      clearAgentExecutionReadinessImpactForExecutionRunning(clearInput(db))
    ).resolves.toBe("cleared");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("reports unchanged when no current impact matched", async () => {
    const { db } = createDb(0);
    await expect(
      clearAgentExecutionReadinessImpactForExecutionRunning(clearInput(db))
    ).resolves.toBe("unchanged");
  });

  it("keeps the invalidation when the driver reports no row count", async () => {
    const { db } = createDb(null);
    await expect(
      clearAgentExecutionReadinessImpactForExecutionRunning(clearInput(db))
    ).resolves.toBe("cleared");
  });
});
