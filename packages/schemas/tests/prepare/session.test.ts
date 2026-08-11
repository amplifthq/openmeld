import { describe, expect, it } from "vitest";
import {
  createPrepareSessionRequestSchema,
  PREPARE_STEP_DIAGNOSTICS_MAX_CHARS,
  prepareSessionEventSchema,
  prepareSessionSnapshotSchema,
  prepareSessionStreamClientFrameSchema,
  prepareSessionStreamServerFrameSchema,
  prepareSetupBootstrapResultSchema,
  prepareStepDiagnosticsBundleSchema,
  prepareStepSchema,
  prepareTerminalConnectionSchema,
  redactPrepareStepDiagnosticsText,
  terminalLocalAgentCatalogWriteSchema,
  terminalStepWriteSchema,
  webAgentSelectionWriteSchema,
} from "../../src/index";

const BASE_STEP = {
  id: "connect_terminal",
  state: "active",
  title: "Connect Terminal",
  summary: null,
  blockerReasonCode: null,
  startedAt: "2026-05-08T00:00:00.000Z",
  completedAt: null,
  updatedAt: "2026-05-08T00:00:00.000Z",
} as const;

const BASE_SNAPSHOT = {
  prepareSessionId: "prepare-session-1",
  ownerUserId: "user-1",
  humanProfileId: "12345678-1234-1234-1234-1234567890ab",
  deviceId: "device-1",
  runtimeLane: "prod",
  targetSpaceId: null,
  sessionRevision: 0,
  lifecycleStatus: "active",
  phase: "waiting_for_terminal",
  steps: [BASE_STEP],
  selectedLocalAgentIds: [],
  terminalConnection: {
    status: "never_connected",
    connectionId: null,
    connectionEpoch: null,
    connectedAt: null,
    lastSeenAt: null,
    disconnectedAt: null,
    disconnectReason: null,
  },
  blockers: [],
  diagnosticCorrelationId: "diag-1",
  createdAt: "2026-05-08T00:00:00.000Z",
  updatedAt: "2026-05-08T00:00:00.000Z",
  completedAt: null,
  expiresAt: "2026-05-08T01:00:00.000Z",
} as const;

const VALID_PREPARE_STEP_DIAGNOSTICS_BUNDLE = {
  bundleVersion: 1,
  collectedAt: "2026-07-02T10:42:00.000Z",
  supportCode: "prepare.refresh_service.failed",
  stepId: "refresh_service",
  cliVersion: "0.7.97",
  os: { platform: "darwin", release: "25.5.0" },
  inventoryAnomalies: ["runtime_stale"],
  serviceJob: {
    controller: "launchd",
    loaded: true,
    runs: 0,
    state: null,
    lastExitCodeText: "(never exited)",
    lastExitCode: null,
    pendedNondemandSpawn: "speculative",
    keepaliveRunAtLoad: true,
  },
  lifecycleJournalTail: [
    {
      schema: "openmeld-daemon-lifecycle-event-v1",
      v: 1,
      type: "service_manager.action",
      timestamp: "2026-07-02T10:42:00.000Z",
      lane: "prod",
      intent: "setup",
      command: "openmeld setup",
      pid: 4242,
      sessionId: null,
      result: "failed",
      metadata: {
        action: "wait_running",
        durationMs: 2000,
        errorMessage: "launchd timed out",
      },
    },
  ],
  serviceLogTail: ["error: connection refused"],
  collectionErrors: [],
  truncated: false,
} as const;

describe("prepare session schemas", () => {
  it("carries the source Navigation Action for server-side creation idempotency", () => {
    expect(
      createPrepareSessionRequestSchema.parse({
        humanProfileId: "12345678-1234-1234-1234-1234567890ab",
        sourceNavigationAction: {
          signalId: "setup-action-1",
          spaceId: "center-agent-dm-1",
        },
      })
    ).toMatchObject({
      sourceNavigationAction: {
        signalId: "setup-action-1",
        spaceId: "center-agent-dm-1",
      },
    });
  });

  it("carries the existing connected computer selected for reconnect", () => {
    expect(
      createPrepareSessionRequestSchema.parse({
        connectedComputerId: "computer-existing",
        humanProfileId: "12345678-1234-1234-1234-1234567890ab",
      })
    ).toMatchObject({ connectedComputerId: "computer-existing" });

    expect(
      prepareSessionSnapshotSchema.parse({
        ...BASE_SNAPSHOT,
        connectedComputerId: "computer-existing",
      })
    ).toMatchObject({ connectedComputerId: "computer-existing" });
  });

  it("accepts a valid prepare step diagnostics bundle", () => {
    const result = prepareStepDiagnosticsBundleSchema.safeParse(
      VALID_PREPARE_STEP_DIAGNOSTICS_BUNDLE
    );

    expect(result.success).toBe(true);
  });

  it("keeps controlled drain completion visible in prepare diagnostics", () => {
    const result = prepareStepDiagnosticsBundleSchema.safeParse({
      ...VALID_PREPARE_STEP_DIAGNOSTICS_BUNDLE,
      lifecycleJournalTail: [
        {
          ...VALID_PREPARE_STEP_DIAGNOSTICS_BUNDLE.lifecycleJournalTail[0],
          result: "completed",
          type: "stop.controlled_drain",
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accepts service registration recovery and stop-signal evidence", () => {
    for (const type of [
      "service_manager.registration_reconcile",
      "stop.signal.observed",
    ] as const) {
      expect(
        prepareStepDiagnosticsBundleSchema.safeParse({
          ...VALID_PREPARE_STEP_DIAGNOSTICS_BUNDLE,
          lifecycleJournalTail: [
            {
              ...VALID_PREPARE_STEP_DIAGNOSTICS_BUNDLE.lifecycleJournalTail[0],
              type,
            },
          ],
        }).success
      ).toBe(true);
    }
  });

  it("strips unknown prepare step diagnostics fields instead of rejecting", () => {
    const result = prepareStepDiagnosticsBundleSchema.safeParse({
      ...VALID_PREPARE_STEP_DIAGNOSTICS_BUNDLE,
      newerCliOnlyField: "future evidence",
    });

    expect(result.success).toBe(true);
    expect(
      result.success &&
        "newerCliOnlyField" in (result.data as Record<string, unknown>)
    ).toBe(false);
  });

  it("accepts a forward-compatible bundle version so older CLIs keep parsing", () => {
    // A v1 bundle from an un-upgraded CLI and the enriched v2 bundle must both
    // validate on a newer core; only non-positive/non-integer versions fail.
    expect(
      prepareStepDiagnosticsBundleSchema.safeParse({
        ...VALID_PREPARE_STEP_DIAGNOSTICS_BUNDLE,
        bundleVersion: 2,
      }).success
    ).toBe(true);
    expect(
      prepareStepDiagnosticsBundleSchema.safeParse({
        ...VALID_PREPARE_STEP_DIAGNOSTICS_BUNDLE,
        bundleVersion: 0,
      }).success
    ).toBe(false);
    expect(
      prepareStepDiagnosticsBundleSchema.safeParse({
        ...VALID_PREPARE_STEP_DIAGNOSTICS_BUNDLE,
        bundleVersion: 1.5,
      }).success
    ).toBe(false);
  });

  it("accepts the enriched v2 diagnostics fields (deviceId and serviceLogNote)", () => {
    const result = prepareStepDiagnosticsBundleSchema.safeParse({
      ...VALID_PREPARE_STEP_DIAGNOSTICS_BUNDLE,
      bundleVersion: 2,
      deviceId: "device-9f3c",
      serviceLogTail: null,
      serviceLogNote: "file_missing",
    });

    expect(result.success).toBe(true);
    expect(
      result.success &&
        (result.data as { deviceId?: string }).deviceId === "device-9f3c" &&
        (result.data as { serviceLogNote?: string }).serviceLogNote ===
          "file_missing"
    ).toBe(true);
  });

  it("rejects an unknown service log note and out-of-bounds fields", () => {
    expect(
      prepareStepDiagnosticsBundleSchema.safeParse({
        ...VALID_PREPARE_STEP_DIAGNOSTICS_BUNDLE,
        supportCode: undefined,
      }).success
    ).toBe(false);
    expect(
      prepareStepDiagnosticsBundleSchema.safeParse({
        ...VALID_PREPARE_STEP_DIAGNOSTICS_BUNDLE,
        serviceLogNote: "file_gigantic",
      }).success
    ).toBe(false);
    expect(
      prepareStepDiagnosticsBundleSchema.safeParse({
        ...VALID_PREPARE_STEP_DIAGNOSTICS_BUNDLE,
        serviceLogTail: ["x".repeat(322)],
      }).success
    ).toBe(false);
  });

  it("redacts prepare step diagnostics credentials from free text", () => {
    expect(
      redactPrepareStepDiagnosticsText("Authorization: Bearer abc.def.ghi")
    ).toBe("Authorization: Bearer [redacted]");
    expect(
      redactPrepareStepDiagnosticsText(
        "token=openMeldDaemon_prepare_abcdefghijklmnopqrstuvwxyz"
      )
    ).toBe("token=[redacted]");
    expect(
      redactPrepareStepDiagnosticsText("Cookie: session=abc; theme=dark")
    ).toBe("Cookie: [redacted]");
    expect(
      redactPrepareStepDiagnosticsText(`hash ${"a".repeat(40)} done`)
    ).toBe("hash [redacted] done");
    expect(redactPrepareStepDiagnosticsText("error: connection refused")).toBe(
      "error: connection refused"
    );
  });

  it("accepts a resumable prepare session snapshot", () => {
    const result = prepareSessionSnapshotSchema.safeParse(BASE_SNAPSHOT);

    expect(result.success).toBe(true);
  });

  it("accepts a completed setup bootstrap result on a prepare session snapshot", () => {
    const setupBootstrap = {
      status: "completed",
      assistantProfile: {
        openMeldProfileId: "agent-assistant",
        managedRole: "openmeld_assistant",
        profileKind: "agent",
        profileName: "Mira's Welcoming Assistant",
      },
      binding: null,
      humanProfile: {
        openMeldProfileId: "human-mira",
        profileKind: "human",
        profileName: "Mira",
      },
      facts: {
        ownerUserId: "user-mira",
        assistantProfileId: "agent-assistant",
        spaceId: "space-welcome",
        spaceUrl: "https://openmeld.test/spaces/space-welcome",
        createdAt: "2026-05-08T00:10:00.000Z",
      },
      membership: {
        addedMemberIds: ["agent-assistant"],
        alreadyMemberIds: [],
        assistantProfileId: "agent-assistant",
        humanProfileId: "human-mira",
      },
      retryCommand: null,
      warnings: [],
      welcomeMessage: null,
      welcomingSpace: {
        createdAt: "2026-05-08T00:10:00.000Z",
        name: "Mira's OpenMeld Welcoming Space",
        outcome: "reused",
        spaceId: "space-welcome",
        url: "https://openmeld.test/spaces/space-welcome",
      },
    } as const;

    expect(
      prepareSetupBootstrapResultSchema.safeParse(setupBootstrap).success
    ).toBe(true);
    const result = prepareSessionSnapshotSchema.safeParse({
      ...BASE_SNAPSHOT,
      completedAt: "2026-05-08T00:10:00.000Z",
      lifecycleStatus: "completed",
      phase: "ready",
      setupBootstrap,
    });

    expect(result.success).toBe(true);
  });

  it("accepts legacy completed setup bootstrap Binding summaries", () => {
    const result = prepareSetupBootstrapResultSchema.safeParse({
      status: "completed",
      assistantProfile: {
        openMeldProfileId: "agent-assistant",
        managedRole: "openmeld_assistant",
        profileKind: "agent",
        profileName: "Mira's Welcoming Assistant",
      },
      binding: {
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-1",
        outcome: "reconnected",
        reason: null,
        reasonCodes: [],
        routable: true,
        source: "agent_profile_binding_api",
        status: "accepted",
      },
      humanProfile: {
        openMeldProfileId: "human-mira",
        profileKind: "human",
        profileName: "Mira",
      },
      facts: {
        ownerUserId: "user-mira",
        assistantProfileId: "agent-assistant",
        spaceId: "space-welcome",
        spaceUrl: "https://openmeld.test/spaces/space-welcome",
        createdAt: "2026-05-08T00:10:00.000Z",
      },
      membership: {
        addedMemberIds: ["agent-assistant"],
        alreadyMemberIds: [],
        assistantProfileId: "agent-assistant",
        humanProfileId: "human-mira",
      },
      retryCommand: null,
      warnings: [],
      welcomeMessage: {
        signalId: "sig-welcome",
        text: "Welcome to OpenMeld.",
      },
      welcomingSpace: {
        createdAt: "2026-05-08T00:10:00.000Z",
        name: "Mira's OpenMeld Welcoming Space",
        spaceId: "space-welcome",
        url: "https://openmeld.test/spaces/space-welcome",
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts completed setup bootstrap results after Welcoming Assistant retirement", () => {
    const setupBootstrap = {
      status: "completed",
      assistantProfile: null,
      binding: null,
      bindingWarning: null,
      humanProfile: {
        openMeldProfileId: "human-mira",
        profileKind: "human",
        profileName: "Mira",
      },
      facts: null,
      membership: null,
      retryCommand: null,
      warnings: [],
      welcomeMessage: null,
      welcomingSpace: null,
    } as const;

    expect(
      prepareSetupBootstrapResultSchema.safeParse(setupBootstrap).success
    ).toBe(true);
    const result = prepareSessionSnapshotSchema.safeParse({
      ...BASE_SNAPSHOT,
      completedAt: "2026-05-08T00:10:00.000Z",
      lifecycleStatus: "completed",
      phase: "ready",
      setupBootstrap,
    });

    expect(result.success).toBe(true);
  });

  it("rejects duplicate selected local agent ids", () => {
    const result = prepareSessionSnapshotSchema.safeParse({
      ...BASE_SNAPSHOT,
      selectedLocalAgentIds: ["codex", "codex"],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["selectedLocalAgentIds"]);
  });

  it("requires blockers when the session phase is blocked", () => {
    const result = prepareSessionSnapshotSchema.safeParse({
      ...BASE_SNAPSHOT,
      phase: "blocked",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["blockers"]);
  });

  it("requires completedAt for terminal lifecycle statuses", () => {
    const result = prepareSessionSnapshotSchema.safeParse({
      ...BASE_SNAPSHOT,
      lifecycleStatus: "completed",
      phase: "ready",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["completedAt"]);
  });

  it("requires blockerReasonCode on blocked steps", () => {
    const result = prepareStepSchema.safeParse({
      ...BASE_STEP,
      state: "blocked",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["blockerReasonCode"]);
  });

  it("requires connection evidence for connected terminals", () => {
    const result = prepareTerminalConnectionSchema.safeParse({
      status: "connected",
      connectionId: null,
      connectionEpoch: null,
      connectedAt: null,
      lastSeenAt: null,
      disconnectedAt: null,
      disconnectReason: null,
    });

    expect(result.success).toBe(false);
  });

  it("accepts terminal step writes with connection epoch and attempt id", () => {
    const result = terminalStepWriteSchema.safeParse({
      prepareSessionId: "prepare-session-1",
      connectionEpoch: 1,
      expectedRevision: 2,
      stepAttemptId: "attempt-1",
      stepId: "refresh_service",
      status: "completed",
      reasonCode: null,
      message: null,
    });

    expect(result.success).toBe(true);
  });

  it("accepts failed terminal step writes without diagnostics (published CLIs)", () => {
    const result = terminalStepWriteSchema.safeParse({
      prepareSessionId: "prepare-session-1",
      connectionEpoch: 1,
      expectedRevision: 2,
      stepAttemptId: "attempt-1",
      stepId: "refresh_service",
      status: "failed",
      reasonCode: "prepare.refresh_service.failed",
      message: "OpenMeld Service stopped before runtime reporting.",
    });

    expect(result.success).toBe(true);
  });

  it("round-trips failed terminal step writes with bounded diagnostics", () => {
    const diagnostics = JSON.stringify({
      bundleVersion: 1,
      supportCode: "prepare.refresh_service.failed",
      stepId: "refresh_service",
      serviceLogTail: ["error: connection refused"],
    });
    const result = terminalStepWriteSchema.safeParse({
      prepareSessionId: "prepare-session-1",
      connectionEpoch: 1,
      expectedRevision: 2,
      stepAttemptId: "attempt-1",
      stepId: "refresh_service",
      status: "failed",
      reasonCode: "prepare.refresh_service.failed",
      message: "OpenMeld Service stopped before runtime reporting.",
      diagnostics,
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.diagnostics).toBe(diagnostics);
  });

  it("rejects terminal step diagnostics above the size cap", () => {
    const result = terminalStepWriteSchema.safeParse({
      prepareSessionId: "prepare-session-1",
      connectionEpoch: 1,
      expectedRevision: 2,
      stepAttemptId: "attempt-1",
      stepId: "refresh_service",
      status: "failed",
      reasonCode: "prepare.refresh_service.failed",
      message: "OpenMeld Service stopped before runtime reporting.",
      diagnostics: "x".repeat(PREPARE_STEP_DIAGNOSTICS_MAX_CHARS + 1),
    });

    expect(result.success).toBe(false);
  });

  it("accepts Web agent selection writes with revision evidence", () => {
    const result = webAgentSelectionWriteSchema.safeParse({
      prepareSessionId: "prepare-session-1",
      expectedRevision: 2,
      localAgentIds: ["codex", "claude-code"],
    });

    expect(result.success).toBe(true);
  });

  it("accepts Terminal local agent catalog writes", () => {
    const result = terminalLocalAgentCatalogWriteSchema.safeParse({
      prepareSessionId: "prepare-session-1",
      connectionEpoch: 1,
      localAgentCatalog: {
        totalBuiltins: 1,
        detectedSupported: 1,
        needsChoice: 0,
        needsRepair: 0,
        detectedNotSupportedYet: 0,
        notDetected: 0,
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
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts append-only prepare diagnostic events", () => {
    const result = prepareSessionEventSchema.safeParse({
      eventId: "event-1",
      prepareSessionId: "prepare-session-1",
      sessionRevision: 1,
      eventType: "terminal.connected",
      actor: "terminal",
      stepId: "connect_terminal",
      connectionEpoch: 1,
      reasonCode: null,
      message: "Terminal connected.",
      localAgentIds: [],
      createdAt: "2026-05-08T00:00:05.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("accepts typed prepare session WebSocket frames", () => {
    const helloFrame = prepareSessionStreamClientFrameSchema.safeParse({
      type: "client.hello",
      payload: {
        cliVersion: "0.7.71",
        protocolVersion: 1,
      },
    });
    const clientFrame = prepareSessionStreamClientFrameSchema.safeParse({
      type: "terminal.step.write",
      payload: {
        prepareSessionId: "prepare-session-1",
        connectionEpoch: 1,
        expectedRevision: 2,
        stepAttemptId: "attempt-1",
        stepId: "refresh_service",
        status: "started",
      },
    });
    const serverFrame = prepareSessionStreamServerFrameSchema.safeParse({
      type: "snapshot",
      payload: {
        snapshot: BASE_SNAPSHOT,
      },
    });
    const catalogFrame = prepareSessionStreamClientFrameSchema.safeParse({
      type: "terminal.local_agent_catalog.write",
      payload: {
        prepareSessionId: "prepare-session-1",
        connectionEpoch: 1,
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
    });
    const terminalSelectionFrame =
      prepareSessionStreamClientFrameSchema.safeParse({
        type: "terminal.agent_selection.write",
        payload: {
          prepareSessionId: "prepare-session-1",
          connectionEpoch: 1,
          expectedRevision: 2,
          localAgentIds: ["codex"],
        },
      });

    expect(helloFrame.success).toBe(true);
    expect(clientFrame.success).toBe(true);
    expect(serverFrame.success).toBe(true);
    expect(catalogFrame.success).toBe(true);
    expect(terminalSelectionFrame.success).toBe(true);
  });

  it("rejects Terminal agent selection writes without connection epoch", () => {
    const result = prepareSessionStreamClientFrameSchema.safeParse({
      type: "terminal.agent_selection.write",
      payload: {
        prepareSessionId: "prepare-session-1",
        expectedRevision: 2,
        localAgentIds: ["codex"],
      },
    });

    expect(result.success).toBe(false);
  });
});
