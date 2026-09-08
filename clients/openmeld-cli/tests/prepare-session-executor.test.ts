import {
  createCurrentDeviceApi,
  createPrepareReadinessApi,
} from "@openmeld/api-client";
import type {
  PrepareLocalReadinessSnapshot,
  PrepareSessionSnapshot,
  PrepareStepId,
  PrepareStepState,
} from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileNewRunnableBuiltinAgentsForSetup } from "../src/agents/registry";
import { runAgentsRepair } from "../src/commands/agents";
import type { PrepareSessionStream } from "../src/commands/prepare-session-executor";
import {
  assertCompletedPrepareSessionMatchesTerminalSelection,
  buildPrepareSessionClientHelloFrame,
  buildTerminalStep,
  formatTerminalStepFailureMessage,
  isLegacyPrepareSessionClientHelloRejection,
  isPrepareSessionFrameSchemaRejection,
  PrepareSessionCancelledError,
  PrepareSessionConnectionInterruptedError,
  reportLocalAgentCatalogForSelection,
  reportPrepareHandoffStopped,
  resolveAgentSelection,
  resolveNextTerminalPrepareStep,
  resolvePrepareSessionTerminalAuthCheck,
  resolveTerminalSelectedLocalAgentIds,
  runPrepareSessionExecutor,
  runTerminalStep,
  waitForSnapshotWithProgress,
} from "../src/commands/prepare-session-executor";
import type { AuthSessionStateResult } from "../src/config/auth-session";
import { readDaemonServiceContract } from "../src/config/daemon-service-contract";
import {
  assertSelectedAgentControllerReportSubmissionsAccepted,
  resolveSelectedAgentControllerReadiness,
  submitSelectedAgentControllerReports,
} from "../src/local-service/reporting/selected-agent-controller-reporting";
import { buildLocalAgentCatalogFromReadiness } from "../src/local-service/state/current-device-identity";
import { notifyDaemonRouteCatalogChanged } from "../src/local-service/state/route-catalog-sync-notifier";
import { fetchSpaceRequestWithTimeout } from "../src/space/fetch-with-timeout";
import { runStartLocalAgentsEnable } from "../src/start-local/agents-local";
import { collectStartLocalReadiness } from "../src/start-local/readiness";
import type { StartReadinessSnapshot } from "../src/start-local/readiness-types";
import {
  LocalMachineFailureError,
  toLocalMachineFailureError,
} from "../src/system/local-machine-recovery";
import { runDaemonServiceParticipationGate } from "../src/system/local-service-participation-gate";
import { collectObservedDeviceMetadata } from "../src/system/observed-device-metadata";
import { connectWebSocket } from "../src/transport/ws";
import { resolveControllingTerminalSession } from "../src/ui/controlling-terminal";
import { promptSearchSelect } from "../src/ui/search-select";

vi.mock("@openmeld/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openmeld/api-client")>();
  return {
    ...actual,
    createCurrentDeviceApi: vi.fn(),
    createPrepareReadinessApi: vi.fn(),
  };
});

vi.mock("../src/config/daemon-service-contract", () => ({
  readDaemonServiceContract: vi.fn(),
}));

vi.mock("../src/agents/registry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/agents/registry")>();
  return {
    ...actual,
    reconcileNewRunnableBuiltinAgentsForSetup: vi.fn(),
  };
});

vi.mock("../src/local-service/state/route-catalog-sync-notifier", () => ({
  notifyDaemonRouteCatalogChanged: vi.fn(),
}));

vi.mock("../src/start-local/readiness", () => ({
  collectStartLocalReadiness: vi.fn(),
}));

vi.mock("../src/start-local/agents-local", () => ({
  runStartLocalAgentsEnable: vi.fn(),
}));

vi.mock("../src/commands/agents", () => ({
  runAgentsRepair: vi.fn(),
}));

vi.mock("../src/commands/setup-service-update-truth", () => ({
  assertSetupServiceUpdateComplete: vi.fn(async () => undefined),
}));

vi.mock("../src/system/observed-device-metadata", () => ({
  collectObservedDeviceMetadata: vi.fn(),
}));

vi.mock("../src/system/local-service-participation-gate", () => ({
  runDaemonServiceParticipationGate: vi.fn(),
}));

vi.mock("../src/ui/controlling-terminal", () => ({
  resolveControllingTerminalSession: vi.fn(() => null),
}));

vi.mock("../src/ui/search-select", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/ui/search-select")>();
  return {
    ...actual,
    promptSearchSelect: vi.fn(),
  };
});

vi.mock("../src/space/fetch-with-timeout", () => ({
  fetchSpaceRequestWithTimeout: vi.fn(),
}));

vi.mock("../src/transport/ws", () => ({
  connectWebSocket: vi.fn(),
}));

vi.mock(
  "../src/local-service/reporting/selected-agent-controller-reporting",
  () => ({
    assertSelectedAgentControllerReportSubmissionsAccepted: vi.fn(),
    resolveSelectedAgentControllerReadiness: vi.fn(),
    submitSelectedAgentControllerReports: vi.fn(),
  })
);

const PREPARE_STEP_IDS: readonly PrepareStepId[] = [
  "computer",
  "connect_terminal",
  "choose_local_agents",
  "prepare_selected_agents",
  "refresh_service",
  "report_runtime",
  "verify_setup",
  "ready",
];

describe("prepare session executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENMELD_SETUP_FORCE_SERVICE_REFRESH = undefined;
    vi.mocked(reconcileNewRunnableBuiltinAgentsForSetup).mockResolvedValue({
      registeredAgentIds: [],
      preservedDisabledAgentIds: [],
      preservedEnabledAgentIds: [],
    });
    vi.mocked(runAgentsRepair).mockResolvedValue({
      status: "completed",
      summary: {
        allMode: false,
        errors: [],
        repaired: [],
        requested: [],
        skipped: [],
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resumes from the first unfinished Terminal-owned step", () => {
    expect(
      resolveNextTerminalPrepareStep(
        buildSnapshot({
          prepare_selected_agents: "complete",
          refresh_service: "complete",
          report_runtime: "blocked",
        })
      )
    ).toBe("report_runtime");
  });

  it("does not run Terminal-owned work when no local agents are selected", () => {
    expect(resolveNextTerminalPrepareStep(buildSnapshot({}, []))).toBe(
      "refresh_service"
    );
  });

  it("finishes after Service alignment when no local agents are selected", () => {
    expect(
      resolveNextTerminalPrepareStep(
        buildSnapshot({ refresh_service: "complete" }, [])
      )
    ).toBeNull();
  });

  it("stops once all Terminal-owned steps are complete", () => {
    expect(
      resolveNextTerminalPrepareStep(
        buildSnapshot({
          prepare_selected_agents: "complete",
          refresh_service: "complete",
          report_runtime: "complete",
          verify_setup: "complete",
        })
      )
    ).toBeNull();
  });

  it("builds a Prepare Session client hello frame with CLI and protocol versions", () => {
    expect(
      buildPrepareSessionClientHelloFrame({ cliVersion: "0.7.71" })
    ).toEqual({
      type: "client.hello",
      payload: {
        cliVersion: "0.7.71",
        protocolVersion: 1,
      },
    });
  });

  it("recognizes the legacy Core error for optional client hello", () => {
    expect(
      isLegacyPrepareSessionClientHelloRejection({
        code: "schema.invalid",
        message: "Invalid prepare session frame.",
      })
    ).toBe(true);
    expect(
      isLegacyPrepareSessionClientHelloRejection({
        code: "prepare.session.protocol_mismatch",
        message:
          "This OpenMeld CLI does not match the current setup protocol. Update OpenMeld, copy a fresh Agent Interface prompt, and run setup again.",
      })
    ).toBe(false);
  });

  it("repairs enabled local agents before reporting the setup catalog", async () => {
    const snapshot = buildSnapshot({ choose_local_agents: "active" });
    const reportedSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      localAgentCatalog: buildSnapshotWithLocalAgentCatalog().localAgentCatalog,
      sessionRevision: snapshot.sessionRevision + 1,
    };
    vi.mocked(collectStartLocalReadiness)
      .mockResolvedValueOnce(buildNeedsRepairReadinessSnapshot())
      .mockResolvedValueOnce(buildReadinessSnapshot());
    const writeTerminalLocalAgentCatalog = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn((predicate) => {
        expect(predicate(reportedSnapshot)).toBe(true);
        return Promise.resolve(reportedSnapshot);
      }),
      writeTerminalAgentSelection: vi.fn(),
      writeTerminalLocalAgentCatalog,
      writeTerminalStep: vi.fn(),
    };

    const result = await reportLocalAgentCatalogForSelection({
      input: buildExecutorInput(),
      snapshot,
      stream,
    });

    expect(runAgentsRepair).toHaveBeenCalledWith({
      agent: ["codex"],
      interactive: false,
      presentation: "handoff",
      view: "human",
    });
    expect(collectStartLocalReadiness).toHaveBeenCalledTimes(2);
    expect(writeTerminalLocalAgentCatalog).toHaveBeenCalledWith({
      connectionEpoch: 1,
      localAgentCatalog: expect.objectContaining({
        detectedSupported: 1,
        needsRepair: 0,
        entries: [
          expect.objectContaining({
            agentId: "codex",
            launchStatus: "ready",
            selectable: true,
            selectableReason: null,
          }),
        ],
      }),
    });
    expect(result).toBe(reportedSnapshot);
  });

  it("automatically registers new runnable agents before reporting the default setup catalog", async () => {
    const snapshot = buildSnapshot({ choose_local_agents: "active" });
    const reportedSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      localAgentCatalog: buildSnapshotWithLocalAgentCatalog().localAgentCatalog,
      sessionRevision: snapshot.sessionRevision + 1,
    };
    vi.mocked(reconcileNewRunnableBuiltinAgentsForSetup).mockResolvedValueOnce({
      registeredAgentIds: ["codex", "claude-code"],
      preservedDisabledAgentIds: ["opencode"],
      preservedEnabledAgentIds: [],
    });
    const readiness = buildReadinessSnapshot();
    vi.mocked(collectStartLocalReadiness).mockResolvedValueOnce({
      ...readiness,
      agents: {
        ...readiness.agents,
        candidates: [
          ...readiness.agents.candidates,
          {
            agentId: "claude-code",
            detected: true,
            displayName: "Claude Code",
            enabled: true,
            lifecycleStatus: "active",
            launchStatus: "ready",
            selectable: true,
            selectableReason: null,
          },
          {
            agentId: "opencode",
            detected: true,
            displayName: "OpenCode",
            enabled: false,
            lifecycleStatus: "active",
            launchStatus: "ready",
            selectable: true,
            selectableReason: null,
          },
        ],
      },
    });
    const input = buildHumanExecutorInput();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn(() => Promise.resolve(reportedSnapshot)),
      writeTerminalAgentSelection: vi.fn(),
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep: vi.fn(),
    };

    await reportLocalAgentCatalogForSelection({ input, snapshot, stream });

    expect(reconcileNewRunnableBuiltinAgentsForSetup).toHaveBeenCalledTimes(1);
    const output = vi
      .mocked(input.presenter.line)
      .mock.calls.map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).toContain("Enabled automatically: Codex, Claude Code");
    expect(output).toContain("Kept off: OpenCode");
  });

  it("does not change registration choices for an explicit setup selection", async () => {
    const snapshot = buildSnapshot({ choose_local_agents: "active" });
    const reportedSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      localAgentCatalog: buildSnapshotWithLocalAgentCatalog().localAgentCatalog,
      sessionRevision: snapshot.sessionRevision + 1,
    };
    vi.mocked(collectStartLocalReadiness).mockResolvedValueOnce(
      buildReadinessSnapshot()
    );
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn(() => Promise.resolve(reportedSnapshot)),
      writeTerminalAgentSelection: vi.fn(),
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep: vi.fn(),
    };

    await reportLocalAgentCatalogForSelection({
      input: {
        ...buildExecutorInput(),
        localAgentSelection: { mode: "all" },
      },
      snapshot,
      stream,
    });

    expect(reconcileNewRunnableBuiltinAgentsForSetup).not.toHaveBeenCalled();
  });

  it("prints compact human progress while reporting local-agent catalog", async () => {
    const snapshot = buildSnapshot({ choose_local_agents: "active" });
    const reportedSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      localAgentCatalog: buildSnapshotWithLocalAgentCatalog().localAgentCatalog,
      sessionRevision: snapshot.sessionRevision + 1,
    };
    vi.mocked(collectStartLocalReadiness).mockResolvedValueOnce(
      buildReadinessSnapshot()
    );
    const writeTerminalLocalAgentCatalog = vi.fn();
    const input = buildHumanExecutorInput();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn((predicate) => {
        expect(predicate(reportedSnapshot)).toBe(true);
        return Promise.resolve(reportedSnapshot);
      }),
      writeTerminalAgentSelection: vi.fn(),
      writeTerminalLocalAgentCatalog,
      writeTerminalStep: vi.fn(),
    };

    await reportLocalAgentCatalogForSelection({
      input,
      snapshot,
      stream,
    });

    const output = vi
      .mocked(input.presenter.line)
      .mock.calls.map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).toContain("Local agents");
    expect(output).toContain("• Checking local agents...");
    expect(output).toContain("✓ Local agents checked.");
    expect(output).not.toContain("Checking local agents ─");
  });

  it("stops before reporting the catalog when setup repair does not converge", async () => {
    const snapshot = buildSnapshot({ choose_local_agents: "active" });
    vi.mocked(collectStartLocalReadiness)
      .mockResolvedValueOnce(buildNeedsRepairReadinessSnapshot())
      .mockResolvedValueOnce(buildNeedsRepairReadinessSnapshot());
    const writeTerminalLocalAgentCatalog = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn(),
      writeTerminalAgentSelection: vi.fn(),
      writeTerminalLocalAgentCatalog,
      writeTerminalStep: vi.fn(),
    };

    await expect(
      reportLocalAgentCatalogForSelection({
        input: buildExecutorInput(),
        snapshot,
        stream,
      })
    ).rejects.toThrow("Codex still needs local setup repair.");
    expect(writeTerminalLocalAgentCatalog).not.toHaveBeenCalled();
  });

  it("fails locally before sending an invalid setup catalog", () => {
    expect(() =>
      buildLocalAgentCatalogFromReadiness(buildNeedsRepairReadinessSnapshot())
    ).toThrow(
      "OpenMeld setup built an invalid local-agent catalog before reporting it"
    );
  });

  it("keeps disabled needs-repair candidates from crashing setup catalog reporting", () => {
    expect(
      buildLocalAgentCatalogFromReadiness(
        buildDisabledNeedsRepairReadinessSnapshot()
      )
    ).toMatchObject({
      detectedSupported: 0,
      needsRepair: 0,
      entries: [
        {
          agentId: "codex",
          detected: true,
          enabled: false,
          launchStatus: "not_available",
          selectable: false,
          selectableReason: "needs_repair",
        },
      ],
    });
  });

  it("keeps suspended readiness candidates out of new setup selection", () => {
    expect(
      buildLocalAgentCatalogFromReadiness(buildSuspendedReadinessSnapshot())
    ).toMatchObject({
      detectedSupported: 0,
      detectedNotSupportedYet: 1,
      entries: [
        {
          agentId: "openclaw",
          detected: true,
          enabled: false,
          launchStatus: "not_available",
          selectable: false,
          selectableReason: "not_supported_yet",
        },
      ],
    });
  });

  it("connects all enabled runnable local agents without opening a selector", async () => {
    const snapshot = buildUnsavedCatalogSnapshot();
    const selectedSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      selectedLocalAgentIds: ["codex", "claude-code"],
      sessionRevision: snapshot.sessionRevision + 1,
      steps: snapshot.steps.map((step) =>
        step.id === "choose_local_agents"
          ? { ...step, state: "complete" as const }
          : step
      ),
    };
    const writeTerminalAgentSelection = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn((predicate) => {
        expect(predicate(selectedSnapshot)).toBe(true);
        return Promise.resolve(selectedSnapshot);
      }),
      writeTerminalAgentSelection,
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep: vi.fn(),
    };

    const input = buildHumanExecutorInput();
    const result = await resolveAgentSelection({
      input,
      snapshot,
      stream,
    });

    expect(resolveControllingTerminalSession).not.toHaveBeenCalled();
    expect(writeTerminalAgentSelection).toHaveBeenCalledWith({
      connectionEpoch: 1,
      expectedRevision: snapshot.sessionRevision,
      localAgentIds: ["codex", "claude-code"],
    });
    expect(result).toBe(selectedSnapshot);
    const output = vi
      .mocked(input.presenter.line)
      .mock.calls.map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).toContain("✓ Enabled local agents: Codex, Claude Code");
    expect(output).not.toContain("Choosing local agents ─");
  });

  it("preserves disabled local agents without opening a selector", async () => {
    const snapshot = buildUnsavedCatalogSnapshot();
    if (!snapshot.localAgentCatalog) {
      throw new Error("expected local agent catalog");
    }
    snapshot.localAgentCatalog = {
      ...snapshot.localAgentCatalog,
      entries: snapshot.localAgentCatalog.entries.map((entry) =>
        entry.agentId === "claude-code" ? { ...entry, enabled: false } : entry
      ),
    };
    const selectedSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      selectedLocalAgentIds: ["codex"],
      sessionRevision: snapshot.sessionRevision + 1,
      steps: snapshot.steps.map((step) =>
        step.id === "choose_local_agents"
          ? { ...step, state: "complete" as const }
          : step
      ),
    };
    const writeTerminalAgentSelection = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn(() => Promise.resolve(selectedSnapshot)),
      writeTerminalAgentSelection,
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep: vi.fn(),
    };

    const input = buildHumanExecutorInput();
    await resolveAgentSelection({
      input,
      snapshot,
      stream,
    });

    expect(resolveControllingTerminalSession).not.toHaveBeenCalled();
    expect(writeTerminalAgentSelection).toHaveBeenCalledWith({
      connectionEpoch: 1,
      expectedRevision: snapshot.sessionRevision,
      localAgentIds: ["codex"],
    });
    const output = vi
      .mocked(input.presenter.line)
      .mock.calls.map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).toContain("✓ Enabled local agents: Codex");
    expect(output).not.toContain("Enabled local agents: Claude Code");
  });

  it("does not describe an explicit selection as enabled when the local agent is off", async () => {
    const snapshot = buildUnsavedCatalogSnapshot();
    if (!snapshot.localAgentCatalog) {
      throw new Error("expected local agent catalog");
    }
    snapshot.localAgentCatalog = {
      ...snapshot.localAgentCatalog,
      entries: snapshot.localAgentCatalog.entries.map((entry) =>
        entry.agentId === "claude-code" ? { ...entry, enabled: false } : entry
      ),
    };
    const selectedSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      selectedLocalAgentIds: ["claude-code"],
      sessionRevision: snapshot.sessionRevision + 1,
      steps: snapshot.steps.map((step) =>
        step.id === "choose_local_agents"
          ? { ...step, state: "complete" as const }
          : step
      ),
    };
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn(() => Promise.resolve(selectedSnapshot)),
      writeTerminalAgentSelection: vi.fn(),
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep: vi.fn(),
    };
    const input = {
      ...buildHumanExecutorInput(),
      localAgentSelection: {
        localAgentIds: ["claude-code"],
        mode: "specific" as const,
      },
    };

    await resolveAgentSelection({
      input,
      snapshot,
      stream,
    });

    const output = vi
      .mocked(input.presenter.line)
      .mock.calls.map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).toContain("✓ Selected: Claude Code");
    expect(output).not.toContain("Enabled local agents: Claude Code");
  });

  it("continues automatically when no local agents are available", async () => {
    const snapshot = buildZeroAgentCatalogSnapshot();
    const selectedSnapshot = buildSelectedNoAgentSnapshot(snapshot);
    const writeTerminalAgentSelection = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn(() => Promise.resolve(selectedSnapshot)),
      writeTerminalAgentSelection,
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep: vi.fn(),
    };

    const input = buildHumanExecutorInput();
    const result = await resolveAgentSelection({
      input,
      snapshot,
      stream,
    });

    expect(resolveControllingTerminalSession).not.toHaveBeenCalled();
    expect(writeTerminalAgentSelection).toHaveBeenCalledWith({
      connectionEpoch: 1,
      expectedRevision: snapshot.sessionRevision,
      localAgentIds: [],
    });
    expect(result.selectedLocalAgentIds).toEqual([]);
    const output = vi
      .mocked(input.presenter.line)
      .mock.calls.map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).toContain("✓ Enabled local agents: none");
  });

  it("continues without prompting in agent view when zero local agents are available", async () => {
    const snapshot = buildZeroAgentCatalogSnapshot();
    const selectedSnapshot = buildSelectedNoAgentSnapshot(snapshot);
    const writeTerminalAgentSelection = vi.fn();
    const input = buildExecutorInput();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn(() => Promise.resolve(selectedSnapshot)),
      writeTerminalAgentSelection,
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep: vi.fn(),
    };

    const result = await resolveAgentSelection({
      input,
      snapshot,
      stream,
    });

    expect(resolveControllingTerminalSession).not.toHaveBeenCalled();
    expect(writeTerminalAgentSelection).toHaveBeenCalledWith({
      connectionEpoch: 1,
      expectedRevision: snapshot.sessionRevision,
      localAgentIds: [],
    });
    expect(result.selectedLocalAgentIds).toEqual([]);
    const output = vi
      .mocked(input.presenter.line)
      .mock.calls.map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).toContain("Setup will continue without local agents.");
    expect(output).toContain("http://localhost:3000/guides/local-agents");
  });

  it("connects no local agents when no flag is set and the computer has none", async () => {
    const snapshot: PrepareSessionSnapshot = {
      ...buildUnsavedCatalogSnapshot(),
      localAgentCatalog: {
        totalBuiltins: 1,
        detectedSupported: 0,
        needsChoice: 0,
        needsRepair: 0,
        detectedNotSupportedYet: 0,
        notDetected: 1,
        entries: [
          {
            agentId: "pochi",
            displayName: "Pochi",
            targetKind: "builtin",
            detected: false,
            enabled: false,
            launchStatus: "not_available",
            selectable: false,
            selectableReason: "not_detected",
          },
        ],
      },
    };
    const selectedSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      selectedLocalAgentIds: [],
      sessionRevision: snapshot.sessionRevision + 1,
      steps: snapshot.steps.map((step) =>
        step.id === "choose_local_agents"
          ? { ...step, state: "complete" as const }
          : step
      ),
    };
    const writeTerminalAgentSelection = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn(() => Promise.resolve(selectedSnapshot)),
      writeTerminalAgentSelection,
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep: vi.fn(),
    };

    const input = buildHumanExecutorInput();
    const result = await resolveAgentSelection({
      input,
      snapshot,
      stream,
    });

    expect(writeTerminalAgentSelection).toHaveBeenCalledWith({
      connectionEpoch: 1,
      expectedRevision: snapshot.sessionRevision,
      localAgentIds: [],
    });
    expect(result.selectedLocalAgentIds).toEqual([]);
    const output = vi
      .mocked(input.presenter.line)
      .mock.calls.map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).toContain(
      "Codex, Claude Code, Grok Build, Cursor, or OpenCode"
    );
    expect(output).toContain("http://localhost:3000/guides/local-agents");
  });

  it("keeps explicit all selection non-interactive and appends the guide URL when none are selectable", async () => {
    const snapshot: PrepareSessionSnapshot = {
      ...buildUnsavedCatalogSnapshot(),
      localAgentCatalog: {
        totalBuiltins: 1,
        detectedSupported: 0,
        needsChoice: 0,
        needsRepair: 0,
        detectedNotSupportedYet: 0,
        notDetected: 1,
        entries: [
          {
            agentId: "codex",
            displayName: "Codex",
            targetKind: "builtin",
            detected: false,
            enabled: false,
            launchStatus: "not_available",
            selectable: false,
            selectableReason: "not_detected",
          },
        ],
      },
    };
    const selectedSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      selectedLocalAgentIds: [],
      sessionRevision: snapshot.sessionRevision + 1,
      steps: snapshot.steps.map((step) =>
        step.id === "choose_local_agents"
          ? { ...step, state: "complete" as const }
          : step
      ),
    };
    const writeTerminalAgentSelection = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn(() => Promise.resolve(selectedSnapshot)),
      writeTerminalAgentSelection,
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep: vi.fn(),
    };
    const input = {
      ...buildHumanExecutorInput(),
      localAgentSelection: { mode: "all" as const },
    };

    await resolveAgentSelection({
      input,
      snapshot,
      stream,
    });

    expect(writeTerminalAgentSelection).toHaveBeenCalledWith({
      connectionEpoch: 1,
      expectedRevision: snapshot.sessionRevision,
      localAgentIds: [],
    });
    const output = vi
      .mocked(input.presenter.line)
      .mock.calls.map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).toContain("Selected: no local agents");
    expect(output).toContain("http://localhost:3000/guides/local-agents");
  });

  it("automatically omits a detected local agent that OpenMeld cannot start", async () => {
    const snapshot = buildUnsavedCatalogSnapshotWithNotLaunchableAgent();
    const selectedSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      selectedLocalAgentIds: ["codex", "claude-code"],
      sessionRevision: snapshot.sessionRevision + 1,
      steps: snapshot.steps.map((step) =>
        step.id === "choose_local_agents"
          ? { ...step, state: "complete" as const }
          : step
      ),
    };
    const writeTerminalAgentSelection = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn(() => Promise.resolve(selectedSnapshot)),
      writeTerminalAgentSelection,
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep: vi.fn(),
    };

    await resolveAgentSelection({
      input: buildHumanExecutorInput(),
      snapshot,
      stream,
    });

    expect(resolveControllingTerminalSession).not.toHaveBeenCalled();
    expect(writeTerminalAgentSelection).toHaveBeenCalledWith({
      connectionEpoch: 1,
      expectedRevision: snapshot.sessionRevision,
      localAgentIds: ["codex", "claude-code"],
    });
    expect(writeTerminalAgentSelection).not.toHaveBeenCalledWith(
      expect.objectContaining({
        localAgentIds: expect.arrayContaining(["openclaw"]),
      })
    );
  });

  it("gives one short recovery action when the background service cannot update", () => {
    expect(
      formatTerminalStepFailureMessage({
        stepId: "refresh_service",
        rawMessage: "OpenMeld Service refresh did not complete: start_failed",
      })
    ).toBe(
      "OpenMeld couldn't finish connecting its background service. Run `openmeld service repair`, then get a new setup command from OpenMeld Web."
    );
  });

  it("preserves the update owner's recovery action instead of promising a restart will fix it", () => {
    expect(
      formatTerminalStepFailureMessage({
        stepId: "refresh_service",
        rawMessage:
          "OpenMeld Service update failed. Run `openmeld service update`.",
      })
    ).toBe("OpenMeld Service update failed. Run `openmeld service update`.");
  });

  it("names the macOS Login Items block when a refresh fails with a never-spawned service", () => {
    const message = formatTerminalStepFailureMessage({
      stepId: "refresh_service",
      rawMessage: "OpenMeld Service refresh did not complete: start_failed",
      serviceJobVerdict: "never_spawned",
    });

    expect(message).toContain("macOS didn't start OpenMeld Service.");
    expect(message).toContain("Login Items & Extensions");
    expect(message).not.toContain("Path A");
    expect(message).not.toContain("Path B");
    expect(message.length).toBeLessThanOrEqual(240);
    // The generic "did not report a running local connection" copy is replaced.
    expect(message).not.toContain("did not report a running local connection");
  });

  it("names a crash loop when a refresh fails with a crashed service", () => {
    const message = formatTerminalStepFailureMessage({
      stepId: "refresh_service",
      rawMessage: "OpenMeld Service refresh did not complete: start_failed",
      serviceJobVerdict: "crashed",
    });

    expect(message).toContain("keeps stopping after it starts");
    expect(message).toContain("openmeld service repair");
    expect(message).toContain("saved the failure details");
    expect(message).not.toContain("--mode foreground");
    expect(message).not.toContain("copy a new setup command");
    expect(message.length).toBeLessThanOrEqual(240);
  });

  it("keeps report-runtime guidance specific without showing its support code", () => {
    const message =
      "OpenMeld could not verify that selected local agents were reported to OpenMeld yet. Support code: prepare_readiness.not_ready.";

    expect(
      formatTerminalStepFailureMessage({
        stepId: "report_runtime",
        rawMessage: message,
      })
    ).toBe(
      "OpenMeld could not verify that selected local agents were reported to OpenMeld yet. Return to OpenMeld Web to see the current connection state and recovery action."
    );
  });

  it("uses ellipses for active Terminal-owned setup steps", () => {
    expect(
      buildTerminalStep({
        input: buildExecutorInput(),
        localAgentIds: ["codex"],
        stepId: "prepare_selected_agents",
      }).message
    ).toBe("Connecting selected local agents...");
    expect(
      buildTerminalStep({
        input: buildExecutorInput(),
        localAgentIds: ["codex"],
        stepId: "refresh_service",
      }).message
    ).toBe("Preparing OpenMeld Service...");
    expect(
      buildTerminalStep({
        input: buildExecutorInput(),
        localAgentIds: ["codex"],
        stepId: "report_runtime",
      }).message
    ).toBe("Reporting selected local agents to OpenMeld...");
    expect(
      buildTerminalStep({
        input: buildExecutorInput(),
        localAgentIds: ["codex"],
        stepId: "verify_setup",
      }).message
    ).toBe("Finishing setup...");
  });

  it("lets setup-session connection interruptions reconnect instead of failing the active step", async () => {
    const snapshot = buildSnapshot({ report_runtime: "pending" });
    const activeSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      sessionRevision: snapshot.sessionRevision + 1,
      steps: snapshot.steps.map((step) =>
        step.id === "report_runtime"
          ? { ...step, state: "active" as const }
          : step
      ),
    };
    const connectionError = new PrepareSessionConnectionInterruptedError(
      1006,
      ""
    );
    const writeTerminalStep = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi
        .fn()
        .mockResolvedValueOnce(activeSnapshot)
        .mockRejectedValueOnce(connectionError),
      writeTerminalAgentSelection: vi.fn(),
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep,
    };
    const input = buildHumanExecutorInput();

    await expect(
      runTerminalStep({
        connectionEpoch: 1,
        input,
        message: "Reporting selected local agents to OpenMeld...",
        run: async () => ({
          deviceId: "device-1",
          runtimeLane: "dev",
        }),
        snapshot,
        stepId: "report_runtime",
        stream,
      })
    ).rejects.toBe(connectionError);

    expect(writeTerminalStep).toHaveBeenCalledTimes(2);
    expect(writeTerminalStep).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        status: "started",
        stepId: "report_runtime",
      })
    );
    expect(writeTerminalStep).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: "completed",
        stepId: "report_runtime",
      })
    );
    expect(writeTerminalStep).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        stepId: "report_runtime",
      })
    );
    const output = vi
      .mocked(input.presenter.line)
      .mock.calls.map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).not.toContain("Setup blocked");
  });

  it("attaches best-effort diagnostics to the failed step write and tells the human", async () => {
    const snapshot = buildSnapshot({ report_runtime: "pending" });
    const activeSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      sessionRevision: snapshot.sessionRevision + 1,
      steps: snapshot.steps.map((step) =>
        step.id === "report_runtime"
          ? { ...step, state: "active" as const }
          : step
      ),
    };
    const writeTerminalStep = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn().mockResolvedValue(activeSnapshot),
      writeTerminalAgentSelection: vi.fn(),
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep,
    };
    const input = buildHumanExecutorInput();
    const collectDiagnostics = vi.fn().mockResolvedValue('{"bundleVersion":1}');

    await expect(
      runTerminalStep({
        collectDiagnostics,
        connectionEpoch: 1,
        input,
        message: "Reporting selected local agents to OpenMeld...",
        run: () =>
          Promise.reject(
            new Error("OpenMeld Service stopped before runtime reporting.")
          ),
        snapshot,
        stepId: "report_runtime",
        stream,
      })
    ).rejects.toThrow("OpenMeld Service stopped before runtime reporting.");

    expect(collectDiagnostics).toHaveBeenCalledWith({
      stepId: "report_runtime",
      supportCode: "prepare.report_runtime.failed",
      error: expect.objectContaining({
        message: "OpenMeld Service stopped before runtime reporting.",
      }),
    });
    expect(writeTerminalStep).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: "failed",
        stepId: "report_runtime",
        reasonCode: "prepare.report_runtime.failed",
        diagnostics: '{"bundleVersion":1}',
      })
    );
    const output = vi
      .mocked(input.presenter.line)
      .mock.calls.map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).toContain("Setup couldn't finish");
    expect(output).toContain(
      "Next: Return to OpenMeld Web to see the current connection state and recovery action."
    );
    expect(output).not.toContain("prepare.report_runtime.failed");
  });

  it("keeps the same setup command alive through a brief series of connection interruptions", async () => {
    vi.useFakeTimers();
    const activeSnapshot: PrepareSessionSnapshot = {
      ...buildSnapshot({ connect_terminal: "active" }),
      humanProfileId: "11111111-1111-4111-8111-111111111111",
    };
    const completedSnapshot: PrepareSessionSnapshot = {
      ...activeSnapshot,
      completedAt: "2026-05-08T00:05:00.000Z",
      lifecycleStatus: "completed",
      phase: "ready",
      steps: activeSnapshot.steps.map((step) =>
        step.id === "ready"
          ? {
              ...step,
              completedAt: "2026-05-08T00:05:00.000Z",
              state: "complete" as const,
            }
          : step
      ),
    };
    let tokenResolutionCount = 0;
    vi.mocked(fetchSpaceRequestWithTimeout).mockImplementation(() => {
      const snapshot =
        tokenResolutionCount < 5 ? activeSnapshot : completedSnapshot;
      tokenResolutionCount += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ snapshot }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      );
    });
    vi.mocked(connectWebSocket).mockImplementation(async () => ({
      close: vi.fn(),
      onClose: (handler) => handler(1006, "temporary network interruption"),
      onError: vi.fn(),
      onMessage: vi.fn(),
      send: vi.fn(),
      terminate: vi.fn(),
      waitUntilClosed: vi.fn().mockResolvedValue(undefined),
    }));

    const resultPromise = runPrepareSessionExecutor(buildExecutorInput());
    const resultExpectation = expect(resultPromise).resolves.toMatchObject({
      snapshot: { lifecycleStatus: "completed" },
      status: "completed",
    });
    await vi.runAllTimersAsync();

    await resultExpectation;
    expect(connectWebSocket).toHaveBeenCalledTimes(5);
    expect(fetchSpaceRequestWithTimeout).toHaveBeenCalledTimes(6);
  });

  it("keeps reconnecting when a transient token refresh also loses the network", async () => {
    vi.useFakeTimers();
    const activeSnapshot: PrepareSessionSnapshot = {
      ...buildSnapshot({ connect_terminal: "active" }),
      humanProfileId: "11111111-1111-4111-8111-111111111111",
    };
    const completedSnapshot: PrepareSessionSnapshot = {
      ...activeSnapshot,
      completedAt: "2026-05-08T00:05:00.000Z",
      lifecycleStatus: "completed",
      phase: "ready",
    };
    vi.mocked(fetchSpaceRequestWithTimeout)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ snapshot: activeSnapshot }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      )
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ snapshot: completedSnapshot }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      );
    vi.mocked(connectWebSocket).mockImplementation(async () => ({
      close: vi.fn(),
      onClose: (handler) => handler(1006, "temporary network interruption"),
      onError: vi.fn(),
      onMessage: vi.fn(),
      send: vi.fn(),
      terminate: vi.fn(),
      waitUntilClosed: vi.fn().mockResolvedValue(undefined),
    }));

    const resultPromise = runPrepareSessionExecutor(buildExecutorInput());
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toMatchObject({
      snapshot: { lifecycleStatus: "completed" },
      status: "completed",
    });
    expect(connectWebSocket).toHaveBeenCalledTimes(1);
    expect(fetchSpaceRequestWithTimeout).toHaveBeenCalledTimes(3);
  });

  it("stops reconnecting when the token endpoint returns an invalid response", async () => {
    vi.useFakeTimers();
    const activeSnapshot: PrepareSessionSnapshot = {
      ...buildSnapshot({ connect_terminal: "active" }),
      humanProfileId: "11111111-1111-4111-8111-111111111111",
    };
    vi.mocked(fetchSpaceRequestWithTimeout)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ snapshot: activeSnapshot }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response("not-json", {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      );
    vi.mocked(connectWebSocket).mockImplementation(async () => ({
      close: vi.fn(),
      onClose: (handler) => handler(1006, "temporary network interruption"),
      onError: vi.fn(),
      onMessage: vi.fn(),
      send: vi.fn(),
      terminate: vi.fn(),
      waitUntilClosed: vi.fn().mockResolvedValue(undefined),
    }));

    const resultPromise = runPrepareSessionExecutor(buildExecutorInput());
    const resultExpectation = expect(resultPromise).rejects.toThrow(
      "Invalid prepare session response."
    );
    await vi.runAllTimersAsync();

    await resultExpectation;
    expect(fetchSpaceRequestWithTimeout).toHaveBeenCalledTimes(2);
  });

  it("uses real elapsed time for the reconnect deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T00:00:00.000Z"));
    const activeSnapshot: PrepareSessionSnapshot = {
      ...buildSnapshot({ connect_terminal: "active" }),
      humanProfileId: "11111111-1111-4111-8111-111111111111",
    };
    let tokenResolutionCount = 0;
    vi.mocked(fetchSpaceRequestWithTimeout).mockImplementation(() => {
      tokenResolutionCount += 1;
      if (tokenResolutionCount === 2) {
        vi.setSystemTime(new Date("2026-05-08T00:00:25.000Z"));
      } else if (tokenResolutionCount === 3) {
        vi.setSystemTime(new Date("2026-05-08T00:00:31.000Z"));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ snapshot: activeSnapshot }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      );
    });
    vi.mocked(connectWebSocket).mockImplementation(async () => ({
      close: vi.fn(),
      onClose: (handler) => handler(1006, "temporary network interruption"),
      onError: vi.fn(),
      onMessage: vi.fn(),
      send: vi.fn(),
      terminate: vi.fn(),
      waitUntilClosed: vi.fn().mockResolvedValue(undefined),
    }));

    const resultPromise = runPrepareSessionExecutor(buildExecutorInput());
    const resultExpectation = expect(resultPromise).rejects.toThrow(
      "Prepare session connection interrupted"
    );
    await vi.runAllTimersAsync();

    await resultExpectation;
    expect(connectWebSocket).toHaveBeenCalledTimes(2);
    expect(fetchSpaceRequestWithTimeout).toHaveBeenCalledTimes(3);
  });

  it("injects the never-spawned verdict into the refresh_service failure write", async () => {
    const snapshot = buildSnapshot({ refresh_service: "pending" });
    const activeSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      sessionRevision: snapshot.sessionRevision + 1,
      steps: snapshot.steps.map((step) =>
        step.id === "refresh_service"
          ? { ...step, state: "active" as const }
          : step
      ),
    };
    const writeTerminalStep = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn().mockResolvedValue(activeSnapshot),
      writeTerminalAgentSelection: vi.fn(),
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep,
    };
    const input = buildHumanExecutorInput();
    const collectDiagnostics = vi.fn().mockResolvedValue(null);
    const resolveServiceJobVerdict = vi.fn().mockResolvedValue("never_spawned");

    await expect(
      runTerminalStep({
        collectDiagnostics,
        connectionEpoch: 1,
        input,
        message: "Preparing OpenMeld Service...",
        resolveServiceJobVerdict,
        run: () =>
          Promise.reject(new Error("OpenMeld Service is not connected yet.")),
        snapshot,
        stepId: "refresh_service",
        stream,
      })
    ).rejects.toThrow();

    expect(resolveServiceJobVerdict).toHaveBeenCalledTimes(1);
    const failedWrite = writeTerminalStep.mock.calls
      .map(
        ([frame]) =>
          frame as { status?: string; reasonCode?: string; message?: string }
      )
      .find((frame) => frame?.status === "failed");
    expect(failedWrite?.reasonCode).toBe(
      "prepare.refresh_service.service_never_spawned"
    );
    expect(failedWrite?.message).toContain(
      "macOS didn't start OpenMeld Service"
    );
  });

  it("writes and rethrows the exact local machine issue for Web and Desktop", async () => {
    const snapshot = buildSnapshot({ refresh_service: "pending" });
    const activeSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      sessionRevision: snapshot.sessionRevision + 1,
      steps: snapshot.steps.map((step) =>
        step.id === "refresh_service"
          ? { ...step, state: "active" as const }
          : step
      ),
    };
    const writeTerminalStep = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn().mockResolvedValue(activeSnapshot),
      writeTerminalAgentSelection: vi.fn(),
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep,
    };
    const localMachineError = toLocalMachineFailureError({
      operation: "start_background_service",
      error: Object.assign(new Error("no space left on device"), {
        code: "ENOSPC",
      }),
    });

    const thrown = await runTerminalStep({
      collectDiagnostics: vi.fn().mockResolvedValue(null),
      connectionEpoch: 1,
      input: buildHumanExecutorInput(),
      message: "Preparing OpenMeld Service...",
      run: () => Promise.reject(localMachineError),
      snapshot,
      stepId: "refresh_service",
      stream,
    }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(LocalMachineFailureError);
    expect(thrown).toBe(localMachineError);
    const failedWrite = writeTerminalStep.mock.calls
      .map(
        ([frame]) =>
          frame as { status?: string; reasonCode?: string; message?: string }
      )
      .find((frame) => frame.status === "failed");
    expect(failedWrite).toMatchObject({
      reasonCode: "local_machine.storage.exhausted",
      message:
        "Your computer is out of storage space. OpenMeld can't save the local files it needs. Free up storage, then try again.",
    });
  });

  it("keeps the failed step write unchanged when diagnostics are unavailable", async () => {
    const snapshot = buildSnapshot({ report_runtime: "pending" });
    const activeSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      sessionRevision: snapshot.sessionRevision + 1,
      steps: snapshot.steps.map((step) =>
        step.id === "report_runtime"
          ? { ...step, state: "active" as const }
          : step
      ),
    };
    const writeTerminalStep = vi.fn();
    const waitForSnapshot = vi.fn().mockResolvedValue(activeSnapshot);
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot,
      writeTerminalAgentSelection: vi.fn(),
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep,
    };
    const input = buildHumanExecutorInput();
    const collectDiagnostics = vi.fn().mockResolvedValue(null);

    await expect(
      runTerminalStep({
        collectDiagnostics,
        connectionEpoch: 1,
        input,
        message: "Reporting selected local agents to OpenMeld...",
        run: () =>
          Promise.reject(
            new Error("OpenMeld Service stopped before runtime reporting.")
          ),
        snapshot,
        stepId: "report_runtime",
        stream,
      })
    ).rejects.toThrow("OpenMeld Service stopped before runtime reporting.");

    const failedWrite = writeTerminalStep.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(failedWrite.status).toBe("failed");
    expect("diagnostics" in failedWrite).toBe(false);
    // No diagnostics attach means no settle wait: only the step-started wait.
    expect(waitForSnapshot).toHaveBeenCalledTimes(1);
    const output = vi
      .mocked(input.presenter.line)
      .mock.calls.map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).not.toContain(
      "A diagnostic summary was shared with OpenMeld"
    );
  });

  it("recognizes frame schema rejections from cores that predate the diagnostics field", () => {
    expect(
      isPrepareSessionFrameSchemaRejection({
        code: "prepare.session.protocol_mismatch",
      })
    ).toBe(true);
    expect(
      isPrepareSessionFrameSchemaRejection({ code: "schema.invalid" })
    ).toBe(true);
    expect(
      isPrepareSessionFrameSchemaRejection({
        code: "prepare.session.revision_conflict",
      })
    ).toBe(false);
  });

  it("blocks prepare when Terminal is signed in to a different OpenMeld account than OpenMeld Web", () => {
    const result = resolvePrepareSessionTerminalAuthCheck({
      authState: buildValidAuthState("terminal-user-2"),
      snapshot: buildSnapshot({}),
    });

    expect(result).toEqual({
      status: "blocked",
      reasonCode: "prepare.auth.account_mismatch",
      message:
        "This Terminal is signed in as terminal-user-2@example.com, but OpenMeld Web is using a different account. Run `openmeld login` with the account shown in OpenMeld Web, then copy a fresh setup command from OpenMeld Web and run setup again.",
    });
  });

  it("requires Terminal sign-in before prepare can connect local agents to OpenMeld", () => {
    const result = resolvePrepareSessionTerminalAuthCheck({
      authState: {
        state: "missing",
        session: null,
      },
      snapshot: buildSnapshot({}),
    });

    expect(result).toEqual({
      status: "blocked",
      reasonCode: "prepare.auth.sign_in_required",
      message:
        "This Terminal is not signed in to OpenMeld. Run `openmeld login` with the same account shown in OpenMeld Web, then copy a fresh setup command from OpenMeld Web and run setup again.",
    });
  });

  it("allows prepare when Terminal and OpenMeld Web use the same OpenMeld account", () => {
    expect(
      resolvePrepareSessionTerminalAuthCheck({
        authState: buildValidAuthState("owner-1"),
        snapshot: buildSnapshot({}),
      })
    ).toEqual({ status: "ok" });
  });

  it("does not print the waiting message when Terminal connects quickly", async () => {
    const snapshot = buildSnapshot({});
    const detail = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn().mockResolvedValue(snapshot),
      writeTerminalAgentSelection: vi.fn(),
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep: vi.fn(),
    };

    await expect(
      waitForSnapshotWithProgress({
        input: buildExecutorInput(),
        predicate: () => true,
        progress: {
          cancel: vi.fn(),
          complete: vi.fn(),
          detail,
          fail: vi.fn(),
        },
        stream,
        waitingMessage:
          "Still connecting. Keep this Terminal open; OpenMeld Web will update automatically",
      })
    ).resolves.toBe(snapshot);

    expect(detail).not.toHaveBeenCalled();
  });

  it("prints the waiting message only after half a second of actual waiting", async () => {
    vi.useFakeTimers();
    try {
      const snapshot = buildSnapshot({});
      const detail = vi.fn();
      let resolveSnapshot!: (snapshot: PrepareSessionSnapshot) => void;
      const stream: PrepareSessionStream = {
        close: vi.fn(),
        getLatestSnapshot: () => snapshot,
        waitForSnapshot: vi.fn(
          () =>
            new Promise<PrepareSessionSnapshot>((resolve) => {
              resolveSnapshot = resolve;
            })
        ),
        writeTerminalAgentSelection: vi.fn(),
        writeTerminalLocalAgentCatalog: vi.fn(),
        writeTerminalStep: vi.fn(),
      };

      const resultPromise = waitForSnapshotWithProgress({
        input: buildExecutorInput(),
        predicate: () => true,
        progress: {
          cancel: vi.fn(),
          complete: vi.fn(),
          detail,
          fail: vi.fn(),
        },
        stream,
        waitingMessage:
          "Still connecting. Keep this Terminal open; OpenMeld Web will update automatically",
      });

      await vi.advanceTimersByTimeAsync(499);
      expect(detail).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(detail).toHaveBeenCalledWith({
        code: "prepare.session.waiting",
        text: "Still connecting. Keep this Terminal open; OpenMeld Web will update automatically",
      });
      resolveSnapshot(snapshot);
      await expect(resultPromise).resolves.toBe(snapshot);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves all selectable local agents for Terminal-driven setup", () => {
    expect(
      resolveTerminalSelectedLocalAgentIds({
        selection: { mode: "all" },
        snapshot: buildSnapshotWithLocalAgentCatalog(),
      })
    ).toEqual(["codex", "claude-code"]);
  });

  it("resolves no local agents for an explicit Terminal-driven none selection without requiring a catalog", () => {
    expect(
      resolveTerminalSelectedLocalAgentIds({
        selection: { mode: "none" },
        snapshot: buildSnapshot({}),
      })
    ).toEqual([]);
  });

  it("rejects Terminal-driven setup when a selected local agent is not selectable", () => {
    expect(() =>
      resolveTerminalSelectedLocalAgentIds({
        selection: {
          localAgentIds: ["codex", "missing-agent"],
          mode: "specific",
        },
        snapshot: buildSnapshotWithLocalAgentCatalog(),
      })
    ).toThrow(
      "OpenMeld cannot select local agent missing-agent for setup. Selectable local agents: codex, claude-code."
    );
  });

  it("appends the guide URL when explicit Terminal-driven setup finds no selectable local agents", () => {
    expect(() =>
      resolveTerminalSelectedLocalAgentIds({
        guideUrl: "http://localhost:3000/guides/local-agents",
        selection: {
          localAgentIds: ["codex"],
          mode: "specific",
        },
        snapshot: {
          ...buildSnapshotWithLocalAgentCatalog(),
          localAgentCatalog: {
            totalBuiltins: 1,
            detectedSupported: 0,
            needsChoice: 0,
            needsRepair: 0,
            detectedNotSupportedYet: 0,
            notDetected: 1,
            entries: [
              {
                agentId: "codex",
                displayName: "Codex",
                targetKind: "builtin",
                detected: false,
                enabled: false,
                launchStatus: "not_available",
                selectable: false,
                selectableReason: "not_detected",
              },
            ],
          },
        },
      })
    ).toThrow(
      "OpenMeld cannot select local agent codex for setup. No selectable local agents were found on this computer. Install guide: http://localhost:3000/guides/local-agents"
    );
  });

  it("does not reuse an already saved empty selection when Terminal-driven setup requests all local agents", async () => {
    const snapshot = {
      ...buildSnapshotWithLocalAgentCatalog(),
      selectedLocalAgentIds: [],
      sessionRevision: 7,
    };
    const selectedSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      selectedLocalAgentIds: ["codex", "claude-code"],
      sessionRevision: 8,
    };
    const writeTerminalAgentSelection = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn((predicate) => {
        expect(predicate(selectedSnapshot)).toBe(true);
        return Promise.resolve(selectedSnapshot);
      }),
      writeTerminalAgentSelection,
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep: vi.fn(),
    };

    const result = await resolveAgentSelection({
      input: {
        ...buildExecutorInput(),
        localAgentSelection: {
          mode: "all",
        },
      },
      snapshot,
      stream,
    });

    expect(writeTerminalAgentSelection).toHaveBeenCalledWith({
      connectionEpoch: 1,
      expectedRevision: 7,
      localAgentIds: ["codex", "claude-code"],
    });
    expect(result.selectedLocalAgentIds).toEqual(["codex", "claude-code"]);
  });

  it("reuses an already saved matching Terminal-driven selection on retry", async () => {
    const snapshot = {
      ...buildSnapshotWithLocalAgentCatalog(),
      selectedLocalAgentIds: ["codex", "claude-code"],
      sessionRevision: 7,
    };
    const writeTerminalAgentSelection = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn(),
      writeTerminalAgentSelection,
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep: vi.fn(),
    };

    const result = await resolveAgentSelection({
      input: {
        ...buildExecutorInput(),
        localAgentSelection: {
          mode: "all",
        },
      },
      snapshot,
      stream,
    });

    expect(writeTerminalAgentSelection).not.toHaveBeenCalled();
    expect(result).toBe(snapshot);
  });

  it("rejects a completed setup when the Terminal-driven selection no longer matches", () => {
    expect(() =>
      assertCompletedPrepareSessionMatchesTerminalSelection({
        selection: {
          mode: "all",
        },
        snapshot: {
          ...buildSnapshotWithLocalAgentCatalog(),
          completedAt: "2026-05-08T00:00:00.000Z",
          lifecycleStatus: "completed",
          phase: "ready",
          selectedLocalAgentIds: [],
        },
      })
    ).toThrow(
      "This OpenMeld setup already completed with a different local-agent selection."
    );
  });

  it("ensures OpenMeld Service startup without forcing a refresh", async () => {
    const enrollLocalRuntime = vi.fn().mockResolvedValue({});
    const writeObservedMetadata = vi.fn().mockResolvedValue({});
    vi.mocked(createCurrentDeviceApi).mockReturnValueOnce({
      enrollLocalRuntime,
      writeObservedMetadata,
    } as unknown as ReturnType<typeof createCurrentDeviceApi>);
    vi.mocked(readDaemonServiceContract).mockResolvedValueOnce({
      autoStart: true,
      bundleId: "bundle-1",
      daemonVersion: "1.0.0",
      desiredState: "background",
      deviceId: "device-1",
      gatewayUrl: "http://localhost:8080",
      generation: 1,
      heartbeatMs: 30_000,
      lane: "dev-local",
      profileId: "human-1",
      schema: "openmeld-daemon-service-contract-v1",
      serviceController: "launchd",
      updatedAt: "2026-05-08T00:00:00.000Z",
      v: 1,
    });
    vi.mocked(collectObservedDeviceMetadata).mockResolvedValueOnce({
      observedDisplayName: "Felix MacBook Pro",
      platformFamily: "macOS",
      osVersion: "25.0.0",
      deviceType: "laptop",
      observedAtMs: 1_800_000_000_000,
    });
    vi.mocked(runDaemonServiceParticipationGate).mockResolvedValueOnce({
      status: "aligned",
    } as Awaited<ReturnType<typeof runDaemonServiceParticipationGate>>);
    const readiness = buildReadinessSnapshotWithExecutionCompatibility({
      expectedEpoch: "daemon-runtime-epoch-current",
      observedEpoch: "daemon-runtime-epoch-old",
      reasonCode: "daemon.runtime_contract.mismatch",
      status: "update_required",
      updatedAt: "2026-05-08T00:00:00.000Z",
    });
    vi.mocked(collectStartLocalReadiness).mockResolvedValueOnce(readiness);

    const step = buildTerminalStep({
      humanProfileId: "human-1",
      input: {
        gatewayUrl: "http://localhost:8080",
        interactive: false,
        presenter: { line: vi.fn() } as unknown as Parameters<
          typeof buildTerminalStep
        >[0]["input"]["presenter"],
        runtime: {
          interactive: false,
          resolvedView: "agent",
          viewMode: "agent",
        },
        startSession: "preptok_test",
        view: "human",
      },
      localAgentIds: ["codex"],
      ownerUserId: "owner-1",
      stepId: "refresh_service",
    });

    const serviceProgress = {
      cancel: vi.fn(),
      complete: vi.fn(),
      detail: vi.fn(),
      fail: vi.fn(),
    };

    const result = await step.run(serviceProgress);

    expect(runDaemonServiceParticipationGate).toHaveBeenCalledWith(
      expect.objectContaining({
        autoRepair: true,
        openMeldProfileId: "human-1",
        expectedOwnerUserId: "owner-1",
        forcePrompt: true,
        intent: "start",
        serviceProgress,
        suppressRefreshHumanResultCard: true,
        suppressStartSpinner: true,
      })
    );
    const [gateInput] = vi.mocked(runDaemonServiceParticipationGate).mock
      .calls[0] ?? [null];
    expect(gateInput).not.toHaveProperty("forceRefresh");
    expect(enrollLocalRuntime).toHaveBeenCalledWith({
      deviceId: "device-1",
      runtimeLane: "dev-local",
    });
    expect(result).toMatchObject({
      deviceId: "device-1",
      runtimeLane: "dev-local",
    });
    expect(collectStartLocalReadiness).not.toHaveBeenCalled();
  });

  it("keeps a cancelled service prompt resumable instead of failing the Prepare step", async () => {
    vi.mocked(runDaemonServiceParticipationGate).mockResolvedValueOnce({
      status: "cancelled",
    });
    const snapshot = buildSnapshot({ refresh_service: "pending" });
    const activeSnapshot: PrepareSessionSnapshot = {
      ...snapshot,
      sessionRevision: snapshot.sessionRevision + 1,
      steps: snapshot.steps.map((step) =>
        step.id === "refresh_service"
          ? { ...step, state: "active" as const }
          : step
      ),
    };
    const writeTerminalStep = vi.fn();
    const stream: PrepareSessionStream = {
      close: vi.fn(),
      getLatestSnapshot: () => snapshot,
      waitForSnapshot: vi.fn().mockResolvedValue(activeSnapshot),
      writeTerminalAgentSelection: vi.fn(),
      writeTerminalLocalAgentCatalog: vi.fn(),
      writeTerminalStep,
    };
    const input = buildHumanExecutorInput();
    const terminalStep = buildTerminalStep({
      humanProfileId: "human-1",
      input,
      localAgentIds: ["codex"],
      ownerUserId: "owner-1",
      stepId: "refresh_service",
    });

    const thrown = await runTerminalStep({
      collectDiagnostics: vi.fn().mockResolvedValue(null),
      connectionEpoch: 1,
      input,
      message: terminalStep.message,
      run: terminalStep.run,
      snapshot,
      stepId: "refresh_service",
      stream,
    }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(PrepareSessionCancelledError);
    expect(writeTerminalStep).toHaveBeenCalledTimes(1);
    expect(writeTerminalStep).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
    const output = vi
      .mocked(input.presenter.line)
      .mock.calls.map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).not.toContain("Setup blocked");
  });

  it("forces OpenMeld Service refresh when the setup bootstrap just force-installed a binary", async () => {
    process.env.OPENMELD_SETUP_FORCE_SERVICE_REFRESH = "1";
    vi.mocked(createCurrentDeviceApi).mockReturnValueOnce({
      enrollLocalRuntime: vi.fn().mockResolvedValue({}),
      writeObservedMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as ReturnType<typeof createCurrentDeviceApi>);
    vi.mocked(readDaemonServiceContract).mockResolvedValueOnce({
      autoStart: true,
      bundleId: "bundle-1",
      daemonVersion: "1.0.0",
      desiredState: "background",
      deviceId: "device-1",
      gatewayUrl: "http://localhost:8080",
      generation: 1,
      heartbeatMs: 30_000,
      lane: "dev-local",
      profileId: "human-1",
      schema: "openmeld-daemon-service-contract-v1",
      serviceController: "launchd",
      updatedAt: "2026-05-08T00:00:00.000Z",
      v: 1,
    });
    vi.mocked(collectObservedDeviceMetadata).mockResolvedValueOnce({
      observedDisplayName: "Felix MacBook Pro",
      platformFamily: "macOS",
      osVersion: "25.0.0",
      deviceType: "laptop",
      observedAtMs: 1_800_000_000_000,
    });
    vi.mocked(runDaemonServiceParticipationGate).mockResolvedValueOnce({
      status: "aligned",
    } as Awaited<ReturnType<typeof runDaemonServiceParticipationGate>>);
    vi.mocked(collectStartLocalReadiness).mockResolvedValueOnce(
      buildReadinessSnapshot()
    );

    const step = buildTerminalStep({
      humanProfileId: "human-1",
      input: {
        gatewayUrl: "http://localhost:8080",
        interactive: false,
        presenter: { line: vi.fn() } as unknown as Parameters<
          typeof buildTerminalStep
        >[0]["input"]["presenter"],
        runtime: {
          interactive: false,
          resolvedView: "agent",
          viewMode: "agent",
        },
        startSession: "preptok_test",
        view: "agent",
      },
      localAgentIds: ["codex"],
      ownerUserId: "owner-1",
      stepId: "refresh_service",
    });

    await step.run({
      cancel: vi.fn(),
      complete: vi.fn(),
      detail: vi.fn(),
      fail: vi.fn(),
    });

    expect(runDaemonServiceParticipationGate).toHaveBeenCalledWith(
      expect.objectContaining({
        forceRefresh: true,
        forcePrompt: true,
        intent: "start",
      })
    );
  });

  it("uses the only install choice during selected-agent preparation and continues setup", async () => {
    vi.mocked(runStartLocalAgentsEnable)
      .mockResolvedValueOnce({
        status: "completed",
        summary: {
          allMode: false,
          requested: ["codex"],
          registered: [],
          reenabled: [],
          skipped: [],
          errors: [
            {
              agentId: "codex",
              code: "controller.launch.choice_required",
              humanActionRequired: true,
              installChoices: [
                {
                  commandPath: "/opt/homebrew/bin/codex",
                  detail: "/opt/homebrew/bin/codex",
                  installId: "homebrew-codex",
                  label: "Codex 0.130.0",
                  launchContract: {
                    kind: "executable",
                    commandPath: "/opt/homebrew/bin/codex",
                  },
                },
              ],
              nextSteps: [
                "openmeld agents enable --agent codex --install homebrew-codex",
              ],
              reason:
                "OpenMeld found more than one Codex install on this computer.",
              summary:
                "OpenMeld needs one install choice on this Mac before it can continue.",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        status: "completed",
        summary: {
          allMode: false,
          requested: ["codex"],
          registered: [],
          reenabled: ["codex"],
          skipped: [],
          errors: [],
        },
      })
      .mockResolvedValueOnce({
        status: "completed",
        summary: {
          allMode: false,
          requested: ["codex"],
          registered: [],
          reenabled: [],
          skipped: [{ agentId: "codex", reason: "already_enabled" }],
          errors: [],
        },
      });

    const step = buildTerminalStep({
      humanProfileId: "human-1",
      input: buildExecutorInput(),
      localAgentIds: ["codex"],
      stepId: "prepare_selected_agents",
    });

    await expect(step.run()).resolves.toBeUndefined();
    expect(runStartLocalAgentsEnable).toHaveBeenCalledWith({
      agent: ["codex"],
      interactive: false,
      presentation: "handoff",
      view: "human",
    });
    expect(runStartLocalAgentsEnable).toHaveBeenNthCalledWith(2, {
      agent: ["codex"],
      install: "homebrew-codex",
      interactive: false,
      presentation: "handoff",
      view: "human",
    });
  });

  it("repairs a selected local agent with a stale launch contract during setup", async () => {
    vi.mocked(runStartLocalAgentsEnable)
      .mockResolvedValueOnce({
        status: "completed",
        summary: {
          allMode: false,
          requested: ["claude-code"],
          registered: [],
          reenabled: [],
          skipped: [],
          errors: [
            {
              agentId: "claude-code",
              code: "agents.invalid_agent_id",
              reason: "needs repair",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        status: "completed",
        summary: {
          allMode: false,
          requested: ["claude-code"],
          registered: [],
          reenabled: [],
          skipped: [{ agentId: "claude-code", reason: "already_enabled" }],
          errors: [],
        },
      });
    vi.mocked(runAgentsRepair).mockResolvedValueOnce({
      status: "completed",
      summary: {
        allMode: false,
        errors: [],
        repaired: ["claude-code"],
        requested: ["claude-code"],
        skipped: [],
      },
    });

    const step = buildTerminalStep({
      humanProfileId: "human-1",
      input: buildExecutorInput(),
      localAgentIds: ["claude-code"],
      stepId: "prepare_selected_agents",
    });

    await expect(step.run()).resolves.toBeUndefined();
    expect(runAgentsRepair).toHaveBeenCalledWith({
      agent: ["claude-code"],
      interactive: false,
      presentation: "handoff",
      view: "human",
    });
    expect(runStartLocalAgentsEnable).toHaveBeenCalledTimes(2);
  });

  it("prompts in the Terminal when setup needs a local-agent install choice", async () => {
    const terminal = {
      close: vi.fn(),
      streams: {
        input: {} as NodeJS.ReadStream,
        output: {} as NodeJS.WriteStream,
      },
    };
    vi.mocked(resolveControllingTerminalSession).mockReturnValueOnce(terminal);
    vi.mocked(promptSearchSelect).mockResolvedValueOnce({
      status: "submitted",
      value: "homebrew-codex",
    });
    vi.mocked(runStartLocalAgentsEnable)
      .mockResolvedValueOnce({
        status: "completed",
        summary: {
          allMode: false,
          requested: ["codex"],
          registered: [],
          reenabled: [],
          skipped: [],
          errors: [
            {
              agentId: "codex",
              code: "controller.launch.choice_required",
              humanActionRequired: true,
              installChoices: [
                {
                  commandPath: "/Users/demo/.nvm/bin/codex",
                  detail: "Node install",
                  installId: "nvm-codex",
                  label: "Node install",
                  launchContract: {
                    kind: "executable",
                    commandPath: "/Users/demo/.nvm/bin/codex",
                  },
                },
                {
                  commandPath: "/opt/homebrew/bin/codex",
                  detail: "Homebrew install",
                  installId: "homebrew-codex",
                  label: "Homebrew install",
                  launchContract: {
                    kind: "executable",
                    commandPath: "/opt/homebrew/bin/codex",
                  },
                },
              ],
              nextSteps: [
                "openmeld agents enable --agent codex --install nvm-codex",
                "openmeld agents enable --agent codex --install homebrew-codex",
              ],
              reason:
                "OpenMeld found more than one Codex install on this computer. Choose which one OpenMeld should use here.",
              summary:
                "OpenMeld needs one install choice on this Mac before it can continue.",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        status: "completed",
        summary: {
          allMode: false,
          requested: ["codex"],
          registered: [],
          reenabled: ["codex"],
          skipped: [],
          errors: [],
        },
      })
      .mockResolvedValueOnce({
        status: "completed",
        summary: {
          allMode: false,
          requested: ["codex"],
          registered: [],
          reenabled: [],
          skipped: [{ agentId: "codex", reason: "already_enabled" }],
          errors: [],
        },
      });

    const step = buildTerminalStep({
      humanProfileId: "human-1",
      input: buildHumanExecutorInput(),
      localAgentIds: ["codex"],
      stepId: "prepare_selected_agents",
    });

    await expect(step.run()).resolves.toBeUndefined();
    expect(promptSearchSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Choose the Codex install OpenMeld should use",
      }),
      terminal.streams
    );
    expect(runStartLocalAgentsEnable).toHaveBeenNthCalledWith(2, {
      agent: ["codex"],
      install: "homebrew-codex",
      interactive: true,
      presentation: "handoff",
      view: "human",
    });
    expect(terminal.close).toHaveBeenCalled();
  });

  it("reactivates the computer and reports controller attention without blocking setup", async () => {
    const enrollLocalRuntime = vi.fn().mockResolvedValue({});
    const writeObservedMetadata = vi.fn().mockResolvedValue({});
    vi.mocked(createCurrentDeviceApi).mockReturnValueOnce({
      enrollLocalRuntime,
      writeObservedMetadata,
    } as unknown as ReturnType<typeof createCurrentDeviceApi>);
    vi.mocked(readDaemonServiceContract).mockResolvedValueOnce({
      autoStart: true,
      bundleId: "bundle-1",
      daemonVersion: "1.0.0",
      desiredState: "background",
      deviceId: "device-1",
      gatewayUrl: "http://localhost:8080",
      generation: 1,
      heartbeatMs: 30_000,
      lane: "dev-local",
      profileId: "human-1",
      schema: "openmeld-daemon-service-contract-v1",
      serviceController: "launchd",
      updatedAt: "2026-05-08T00:00:00.000Z",
      v: 1,
    });
    const readiness = buildReadinessSnapshot();
    const observedMetadata = {
      observedDisplayName: "Felix MacBook Pro",
      platformFamily: "macOS" as const,
      osVersion: "25.0.0",
      deviceType: "laptop" as const,
      observedAtMs: 1_800_000_000_000,
    };
    vi.mocked(collectObservedDeviceMetadata).mockResolvedValueOnce(
      observedMetadata
    );
    vi.mocked(collectStartLocalReadiness).mockResolvedValueOnce(readiness);
    const runtimeReports = [
      {
        agentId: "codex",
        agentControllerRef: "builtin:codex",
        localParticipationState: "needs_agent_prepare" as const,
        reasonCodes: ["provider_account.access_required"],
        runtimeReportSubmission: {
          agentControllerReportStatus: "accepted" as const,
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-session",
          deviceId: "device-1",
          lane: "dev-local",
          reasonCodes: [],
          source: "runtime_reporting_api" as const,
          status: "submitted" as const,
        },
      },
    ];
    vi.mocked(submitSelectedAgentControllerReports).mockResolvedValueOnce(
      runtimeReports
    );
    vi.mocked(notifyDaemonRouteCatalogChanged).mockResolvedValueOnce({
      delivery: "control_plane",
      syncStatus: "changed",
    });

    const step = buildTerminalStep({
      humanProfileId: "human-1",
      input: buildExecutorInput(),
      localAgentIds: ["codex"],
      stepId: "report_runtime",
    });
    const progress = {
      cancel: vi.fn(),
      complete: vi.fn(),
      detail: vi.fn(),
      fail: vi.fn(),
    };

    const result = await step.run(progress);

    expect(enrollLocalRuntime).toHaveBeenCalledWith({
      deviceId: "device-1",
      runtimeLane: "dev-local",
    });
    expect(writeObservedMetadata).toHaveBeenCalledWith({
      deviceId: "device-1",
      metadata: observedMetadata,
    });
    expect(submitSelectedAgentControllerReports).toHaveBeenCalledWith({
      localAgentIds: ["codex"],
      readiness,
    });
    expect(
      assertSelectedAgentControllerReportSubmissionsAccepted
    ).toHaveBeenCalledWith(runtimeReports);
    expect(progress.detail).toHaveBeenCalledWith({
      code: "prepare.session.progress.report_runtime.agent_attention",
      text: "Codex needs sign-in before you can use it. You can do this later.",
    });
    expect(notifyDaemonRouteCatalogChanged).toHaveBeenCalledWith({
      reason: "prepare_selected_agents_reported",
    });
    expect(result).toMatchObject({
      deviceId: "device-1",
      runtimeLane: "dev-local",
      runtimeReports,
      localReadinessSnapshot: {
        service: {
          expectedVersion: "0.4.0",
          installStatus: "installed_current",
          installedVersion: "0.4.0",
          runtimeStatus: "running",
        },
        skills: {
          status: "up_to_date",
          targetCount: 1,
        },
      },
    });
    const enrollLocalRuntimeCallOrder =
      enrollLocalRuntime.mock.invocationCallOrder[0];
    const writeObservedMetadataCallOrder =
      writeObservedMetadata.mock.invocationCallOrder[0];
    const submitReportsCallOrder = vi.mocked(
      submitSelectedAgentControllerReports
    ).mock.invocationCallOrder[0];
    const assertReportsCallOrder = vi.mocked(
      assertSelectedAgentControllerReportSubmissionsAccepted
    ).mock.invocationCallOrder[0];
    const routeCatalogSyncCallOrder = vi.mocked(notifyDaemonRouteCatalogChanged)
      .mock.invocationCallOrder[0];
    if (
      !(
        enrollLocalRuntimeCallOrder &&
        writeObservedMetadataCallOrder &&
        submitReportsCallOrder &&
        assertReportsCallOrder &&
        routeCatalogSyncCallOrder
      )
    ) {
      throw new Error(
        "Expected current-device sync, observed metadata sync, runtime reporting, and route catalog sync."
      );
    }
    expect(enrollLocalRuntimeCallOrder).toBeLessThan(
      writeObservedMetadataCallOrder
    );
    expect(writeObservedMetadataCallOrder).toBeLessThan(submitReportsCallOrder);
    expect(submitReportsCallOrder).toBeLessThan(assertReportsCallOrder);
    expect(assertReportsCallOrder).toBeLessThan(routeCatalogSyncCallOrder);
  });

  it("reuses Prepare Session runtime identity while reporting selected agents", async () => {
    vi.mocked(collectStartLocalReadiness).mockResolvedValueOnce(
      buildReadinessSnapshot()
    );
    vi.mocked(submitSelectedAgentControllerReports).mockResolvedValueOnce([]);
    vi.mocked(notifyDaemonRouteCatalogChanged).mockResolvedValueOnce({
      delivery: "control_plane",
      syncStatus: "changed",
    });

    const step = buildTerminalStep({
      openMeldServiceRuntimeIdentity: {
        deviceId: "device-from-refresh",
        runtimeLane: "dev-local",
      },
      humanProfileId: "human-1",
      input: buildExecutorInput(),
      localAgentIds: ["codex"],
      stepId: "report_runtime",
    });

    const result = await step.run();

    expect(createCurrentDeviceApi).not.toHaveBeenCalled();
    expect(readDaemonServiceContract).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      deviceId: "device-from-refresh",
      runtimeLane: "dev-local",
      runtimeReports: [],
    });
  });

  it("waits through a transient OpenMeld Service propagation gap before connecting selected agents", async () => {
    vi.useFakeTimers();
    try {
      const enrollLocalRuntime = vi.fn().mockResolvedValue({});
      const writeObservedMetadata = vi.fn().mockResolvedValue({});
      vi.mocked(createCurrentDeviceApi).mockReturnValue({
        enrollLocalRuntime,
        writeObservedMetadata,
      } as unknown as ReturnType<typeof createCurrentDeviceApi>);
      vi.mocked(readDaemonServiceContract).mockResolvedValue({
        autoStart: true,
        bundleId: "bundle-1",
        daemonVersion: "1.0.0",
        desiredState: "background",
        deviceId: "device-1",
        gatewayUrl: "http://localhost:8080",
        generation: 1,
        heartbeatMs: 30_000,
        lane: "dev-local",
        profileId: "human-1",
        schema: "openmeld-daemon-service-contract-v1",
        serviceController: "launchd",
        updatedAt: "2026-05-08T00:00:00.000Z",
        v: 1,
      });
      vi.mocked(collectObservedDeviceMetadata).mockResolvedValue({
        observedDisplayName: "Felix MacBook Pro",
        platformFamily: "macOS",
        osVersion: "25.0.0",
        deviceType: "laptop",
        observedAtMs: 1_800_000_000_000,
      });
      vi.mocked(collectStartLocalReadiness).mockResolvedValue(
        buildReadinessSnapshot()
      );
      vi.mocked(submitSelectedAgentControllerReports).mockResolvedValue([]);
      vi.mocked(assertSelectedAgentControllerReportSubmissionsAccepted)
        .mockImplementationOnce(() => {
          throw new Error(
            "OpenMeld could not connect selected agents to OpenMeld for codex because OpenMeld Service is not running. Support code: service.not_running."
          );
        })
        .mockImplementationOnce(() => undefined);
      vi.mocked(notifyDaemonRouteCatalogChanged).mockResolvedValue({
        delivery: "control_plane",
        syncStatus: "changed",
      });

      const step = buildTerminalStep({
        humanProfileId: "human-1",
        input: buildExecutorInput(),
        localAgentIds: ["codex"],
        stepId: "report_runtime",
      });

      const resultPromise = step.run();
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(result).toMatchObject({
        deviceId: "device-1",
        runtimeLane: "dev-local",
      });
      expect(submitSelectedAgentControllerReports).toHaveBeenCalledTimes(2);
      expect(
        assertSelectedAgentControllerReportSubmissionsAccepted
      ).toHaveBeenCalledTimes(2);
      expect(notifyDaemonRouteCatalogChanged).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names every selected local agent once while waiting through a transient reporting gap", async () => {
    vi.useFakeTimers();
    try {
      const enrollLocalRuntime = vi.fn().mockResolvedValue({});
      const writeObservedMetadata = vi.fn().mockResolvedValue({});
      vi.mocked(createCurrentDeviceApi).mockReturnValue({
        enrollLocalRuntime,
        writeObservedMetadata,
      } as unknown as ReturnType<typeof createCurrentDeviceApi>);
      vi.mocked(readDaemonServiceContract).mockResolvedValue({
        autoStart: true,
        bundleId: "bundle-1",
        daemonVersion: "1.0.0",
        desiredState: "background",
        deviceId: "device-1",
        gatewayUrl: "http://localhost:8080",
        generation: 1,
        heartbeatMs: 30_000,
        lane: "dev-local",
        profileId: "human-1",
        schema: "openmeld-daemon-service-contract-v1",
        serviceController: "launchd",
        updatedAt: "2026-05-08T00:00:00.000Z",
        v: 1,
      });
      vi.mocked(collectObservedDeviceMetadata).mockResolvedValue({
        observedDisplayName: "Felix MacBook Pro",
        platformFamily: "macOS",
        osVersion: "25.0.0",
        deviceType: "laptop",
        observedAtMs: 1_800_000_000_000,
      });
      vi.mocked(collectStartLocalReadiness).mockResolvedValue(
        buildReadinessSnapshot()
      );
      vi.mocked(submitSelectedAgentControllerReports).mockResolvedValue([]);
      vi.mocked(assertSelectedAgentControllerReportSubmissionsAccepted)
        .mockImplementationOnce(() => {
          throw new Error(
            "OpenMeld could not connect selected agents to OpenMeld for codex because OpenMeld Service is not running. Support code: service.not_running."
          );
        })
        .mockImplementationOnce(() => undefined);
      vi.mocked(notifyDaemonRouteCatalogChanged).mockResolvedValue({
        delivery: "control_plane",
        syncStatus: "changed",
      });

      const step = buildTerminalStep({
        humanProfileId: "human-1",
        input: buildExecutorInput(),
        localAgentIds: ["codex", "claude-code"],
        stepId: "report_runtime",
      });
      const progress = {
        cancel: vi.fn(),
        complete: vi.fn(),
        detail: vi.fn(),
        fail: vi.fn(),
      };

      const resultPromise = step.run(progress);
      await vi.advanceTimersByTimeAsync(250);
      const result = await resultPromise;

      expect(result).toMatchObject({
        deviceId: "device-1",
        runtimeLane: "dev-local",
      });
      expect(progress.detail).toHaveBeenCalledWith({
        code: "prepare.session.progress.report_runtime.waiting",
        text: "Waiting for codex and claude-code to report their runtime...",
      });
      expect(progress.detail).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("finishes setup without waiting for Agent Controller readiness", async () => {
    const getReadiness = vi.fn();
    mockVerifySetupDependencies(getReadiness);

    const step = buildTerminalStep({
      humanProfileId: "human-1",
      input: buildExecutorInput(),
      localAgentIds: ["codex", "claude-code"],
      stepId: "verify_setup",
    });

    const result = await step.run();

    expect(createPrepareReadinessApi).not.toHaveBeenCalled();
    expect(getReadiness).not.toHaveBeenCalled();
    expect(resolveSelectedAgentControllerReadiness).not.toHaveBeenCalled();
    expect(collectObservedDeviceMetadata).not.toHaveBeenCalled();
    expect(submitSelectedAgentControllerReports).not.toHaveBeenCalled();
    expect(notifyDaemonRouteCatalogChanged).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      deviceId: "device-1",
      runtimeLane: "dev-local",
    });
    expect(collectStartLocalReadiness).not.toHaveBeenCalled();
  });
});

function mockVerifySetupDependencies(
  getReadiness: ReturnType<typeof vi.fn>
): void {
  vi.mocked(createPrepareReadinessApi).mockReturnValue({
    getReadiness,
  } as unknown as ReturnType<typeof createPrepareReadinessApi>);
  vi.mocked(readDaemonServiceContract).mockResolvedValue({
    autoStart: true,
    bundleId: "bundle-1",
    daemonVersion: "1.0.0",
    desiredState: "background",
    deviceId: "device-1",
    gatewayUrl: "http://localhost:8080",
    generation: 1,
    heartbeatMs: 30_000,
    lane: "dev-local",
    profileId: "human-1",
    schema: "openmeld-daemon-service-contract-v1",
    serviceController: "launchd",
    updatedAt: "2026-05-08T00:00:00.000Z",
    v: 1,
  });
  vi.mocked(collectStartLocalReadiness).mockResolvedValue(
    buildReadinessSnapshot()
  );
  vi.mocked(resolveSelectedAgentControllerReadiness).mockReturnValue([
    {
      agentId: "codex",
      agentControllerRef: "builtin:codex",
      localParticipationState: "ready",
      reasonCodes: [],
    },
  ]);
}

function buildExecutorInput(): Parameters<
  typeof buildTerminalStep
>[0]["input"] {
  return {
    gatewayUrl: "http://localhost:8080",
    interactive: false,
    presenter: { line: vi.fn() } as unknown as Parameters<
      typeof buildTerminalStep
    >[0]["input"]["presenter"],
    runtime: {
      interactive: false,
      resolvedView: "agent",
      viewMode: "agent",
    },
    startSession: "preptok_test",
    view: "human",
  };
}

function buildHumanExecutorInput(): Parameters<
  typeof buildTerminalStep
>[0]["input"] {
  return {
    ...buildExecutorInput(),
    interactive: true,
    runtime: {
      interactive: true,
      resolvedView: "human",
      viewMode: "human",
    },
  };
}

function buildUnsavedCatalogSnapshot(): PrepareSessionSnapshot {
  const base = buildSnapshotWithLocalAgentCatalog();
  return {
    ...base,
    selectedLocalAgentIds: [],
    sessionRevision: 7,
    steps: base.steps.map((step) =>
      step.id === "choose_local_agents"
        ? { ...step, state: "active" as const }
        : step
    ),
  };
}

// Same shape as buildUnsavedCatalogSnapshot, plus one builtin entry OpenMeld
// detected but cannot currently launch (e.g. an OS permission check blocks
// it) -- the exact catalog shape produced once detectInstalledBuiltinAgent no
// longer collapses "not_launchable" into "not detected at all".
function buildUnsavedCatalogSnapshotWithNotLaunchableAgent(): PrepareSessionSnapshot {
  const base = buildUnsavedCatalogSnapshot();
  const baseCatalog = base.localAgentCatalog;
  if (!baseCatalog) {
    throw new Error("expected buildUnsavedCatalogSnapshot to set a catalog");
  }
  return {
    ...base,
    localAgentCatalog: {
      ...baseCatalog,
      totalBuiltins: baseCatalog.totalBuiltins + 1,
      entries: [
        ...baseCatalog.entries,
        {
          agentId: "openclaw",
          displayName: "OpenClaw",
          targetKind: "builtin",
          detected: true,
          enabled: false,
          launchStatus: "not_available",
          selectable: false,
          selectableReason: "needs_repair",
        },
      ],
    },
  };
}

function buildZeroAgentCatalogSnapshot(): PrepareSessionSnapshot {
  return {
    ...buildUnsavedCatalogSnapshot(),
    localAgentCatalog: {
      totalBuiltins: 1,
      detectedSupported: 0,
      needsChoice: 0,
      needsRepair: 0,
      detectedNotSupportedYet: 0,
      notDetected: 1,
      entries: [
        {
          agentId: "codex",
          displayName: "Codex",
          targetKind: "builtin",
          detected: false,
          enabled: false,
          launchStatus: "not_available",
          selectable: false,
          selectableReason: "not_detected",
        },
      ],
    },
  };
}

function buildSelectedNoAgentSnapshot(
  snapshot: PrepareSessionSnapshot
): PrepareSessionSnapshot {
  return {
    ...snapshot,
    selectedLocalAgentIds: [],
    sessionRevision: snapshot.sessionRevision + 1,
    steps: snapshot.steps.map((step) =>
      step.id === "choose_local_agents"
        ? { ...step, state: "complete" as const }
        : step
    ),
  };
}

describe("handoff outcome delivery", () => {
  it("waits for Core to acknowledge the stopped attempt before closing Terminal", async () => {
    const snapshot = buildSnapshot({ connect_terminal: "complete" });
    let acknowledge: (() => void) | undefined;
    const close = vi.fn();
    const writeTerminalStep = vi.fn();
    const stream: PrepareSessionStream = {
      close,
      writeTerminalStep,
      getLatestSnapshot: () => snapshot,
      writeTerminalAgentSelection: vi.fn(),
      writeTerminalLocalAgentCatalog: vi.fn(),
      waitForSnapshot: vi
        .fn()
        .mockResolvedValueOnce(snapshot)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              acknowledge = () => resolve(snapshot);
            })
        ),
    };
    const pending = reportPrepareHandoffStopped({
      stream,
      reasonCode: "prepare.account_switch_cancelled",
      message: "Account switch canceled.",
    });
    await vi.waitFor(() => expect(writeTerminalStep).toHaveBeenCalled());
    expect(writeTerminalStep).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionEpoch: 1,
        expectedRevision: 1,
        stepId: "connect_terminal",
        status: "failed",
      })
    );
    expect(close).not.toHaveBeenCalled();
    acknowledge?.();
    await pending;
    expect(close).toHaveBeenCalledOnce();
  });
});

function buildSnapshot(
  stepStates: Partial<Record<PrepareStepId, PrepareStepState>>,
  selectedLocalAgentIds: string[] = ["codex"]
): PrepareSessionSnapshot {
  const now = "2026-05-08T00:00:00.000Z";
  return {
    prepareSessionId: "prepare-1",
    ownerUserId: "owner-1",
    humanProfileId: "human-1",
    deviceId: "device-1",
    runtimeLane: "dev",
    targetSpaceId: null,
    sessionRevision: 1,
    lifecycleStatus: "active",
    phase: "reporting_runtime",
    steps: PREPARE_STEP_IDS.map((stepId) => {
      const state = stepStates[stepId] ?? defaultStepState(stepId);
      return {
        id: stepId,
        state,
        title: stepId,
        summary: stepId,
        blockerReasonCode: state === "blocked" ? "prepare.test" : null,
        startedAt: state === "pending" ? null : now,
        completedAt: state === "complete" ? now : null,
        updatedAt: now,
      };
    }),
    localAgentCatalog: null,
    localReadinessSnapshot: null,
    selectedLocalAgentIds,
    terminalConnection: {
      status: "connected",
      connectionId: "terminal-1",
      connectionEpoch: 1,
      connectedAt: now,
      lastSeenAt: now,
      disconnectedAt: null,
      disconnectReason: null,
    },
    blockers: [],
    diagnosticCorrelationId: "prepare:prepare-1",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    expiresAt: "2026-05-08T00:30:00.000Z",
  };
}

function buildSnapshotWithLocalAgentCatalog(): PrepareSessionSnapshot {
  return {
    ...buildSnapshot({}),
    localAgentCatalog: {
      totalBuiltins: 3,
      detectedSupported: 2,
      needsChoice: 0,
      needsRepair: 0,
      detectedNotSupportedYet: 0,
      notDetected: 1,
      entries: [
        {
          agentId: "codex",
          displayName: "Codex",
          targetKind: "builtin",
          detected: true,
          enabled: true,
          launchStatus: "ready",
          selectable: true,
          selectableReason: null,
        },
        {
          agentId: "claude-code",
          displayName: "Claude Code",
          targetKind: "builtin",
          detected: true,
          enabled: true,
          launchStatus: "ready",
          selectable: true,
          selectableReason: null,
        },
        {
          agentId: "pochi",
          displayName: "Pochi",
          targetKind: "builtin",
          detected: false,
          enabled: false,
          launchStatus: "not_available",
          selectable: false,
          selectableReason: "not_detected",
        },
      ],
    },
  };
}

function buildReadinessSnapshot(): StartReadinessSnapshot {
  return {
    auth: {
      authBaseUrl: null,
      email: null,
      gatewayUrl: "http://localhost:8080",
      status: "valid",
    },
    agents: {
      candidates: [
        {
          agentId: "codex",
          detected: true,
          displayName: "Codex",
          enabled: true,
          lifecycleStatus: "active",
          launchStatus: "ready",
          selectable: true,
          selectableReason: null,
        },
      ],
      detectedNotSupportedYet: 0,
      detectedSupported: 1,
      needsChoice: 0,
      needsRepair: 0,
      notDetected: 0,
      status: "ok",
      totalBuiltins: 1,
    },
    service: {
      expectedVersion: "0.4.0",
      installedVersion: "0.4.0",
      runtime: {
        autoStart: true,
        managedBySystemService: true,
        mode: "background",
        pid: 123,
        reason: undefined,
        serviceController: "launchd",
        startedAt: "2026-05-08T00:00:00.000Z",
        status: "running",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
      status: "installed_current",
    },
    skills: {
      status: "up_to_date",
      summary: {
        externalConflict: 0,
        missing: 0,
        outdated: 0,
        upToDate: 1,
      },
      targetCount: 1,
    },
  };
}

function buildNeedsRepairReadinessSnapshot(): StartReadinessSnapshot {
  const readiness = buildReadinessSnapshot();
  return {
    ...readiness,
    agents: {
      ...readiness.agents,
      detectedSupported: 0,
      needsRepair: 1,
      candidates: readiness.agents.candidates.map((candidate) =>
        candidate.agentId === "codex"
          ? {
              ...candidate,
              launchStatus: "needs_repair" as const,
              selectable: false,
              selectableReason: "needs_repair" as const,
            }
          : candidate
      ),
    },
  };
}

function buildDisabledNeedsRepairReadinessSnapshot(): StartReadinessSnapshot {
  const readiness = buildNeedsRepairReadinessSnapshot();
  return {
    ...readiness,
    agents: {
      ...readiness.agents,
      candidates: readiness.agents.candidates.map((candidate) =>
        candidate.agentId === "codex"
          ? {
              ...candidate,
              enabled: false,
              selectable: true,
              selectableReason: null,
            }
          : candidate
      ),
    },
  };
}

function buildSuspendedReadinessSnapshot(): StartReadinessSnapshot {
  const readiness = buildReadinessSnapshot();
  return {
    ...readiness,
    agents: {
      ...readiness.agents,
      detectedSupported: 1,
      candidates: [
        {
          agentId: "openclaw",
          detected: true,
          displayName: "OpenClaw",
          enabled: false,
          lifecycleStatus: "suspended",
          launchStatus: "ready",
          selectable: true,
          selectableReason: null,
        },
      ],
    },
  };
}

function buildReadinessSnapshotWithExecutionCompatibility(
  executionCompatibility: NonNullable<
    PrepareLocalReadinessSnapshot["service"]["executionCompatibility"]
  >
): StartReadinessSnapshot {
  const readiness = buildReadinessSnapshot() as StartReadinessSnapshot & {
    service: StartReadinessSnapshot["service"] & {
      executionCompatibility: NonNullable<
        PrepareLocalReadinessSnapshot["service"]["executionCompatibility"]
      >;
    };
  };
  readiness.service.executionCompatibility = executionCompatibility;
  return readiness;
}

function buildValidAuthState(userId: string): AuthSessionStateResult {
  return {
    state: "valid",
    session: {
      v: 1,
      accessToken: "token",
      tokenType: "Bearer",
      authBaseUrl: "http://localhost:8788",
      clientId: "openmeld-cli-dev",
      createdAt: "2026-05-08T00:00:00.000Z",
      user: {
        id: userId,
        email: `${userId}@example.com`,
        name: userId,
      },
    },
  };
}

function defaultStepState(stepId: PrepareStepId): PrepareStepState {
  if (
    stepId === "computer" ||
    stepId === "connect_terminal" ||
    stepId === "choose_local_agents"
  ) {
    return "complete";
  }
  return "pending";
}
