import type {
  CreatePrepareSessionRequest,
  PrepareSessionSnapshot,
  PrepareSetupBootstrapResult,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  createPrepareSessionUseCase,
  disconnectPrepareTerminalConnectionUseCase,
  PrepareSessionRevisionConflictError,
  PrepareSessionSetupBootstrapNotReadyError,
  PrepareSessionTerminalConnectionStaleError,
  readPrepareDiagnosticUseCase,
  registerPrepareTerminalConnectionUseCase,
  resolvePrepareSessionTokenUseCase,
  writeSetupBootstrapResultUseCase,
  writeTerminalAgentSelectionUseCase,
  writeTerminalLocalAgentCatalogUseCase,
  writeTerminalStepUseCase,
  writeWebAgentSelectionUseCase,
} from "../src/prepare-session/application/prepare-session-service";
import {
  appendPrepareSessionEvent,
  readPrepareSessionRecord,
  readPrepareSessionRecordByTokenDigest,
  updatePrepareSessionSnapshotIfRevision,
} from "../src/prepare-session/infrastructure/d1/prepare-session-repo";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

const CREATED_AT = new Date("2026-05-08T00:00:00.000Z");

type SqliteD1Harness = ReturnType<typeof createSqliteD1Harness>;

const buildValidPrepareStepDiagnostics = (
  overrides: Record<string, unknown> = {}
): string =>
  JSON.stringify({
    bundleVersion: 1,
    collectedAt: "2026-05-08T00:02:00.000Z",
    supportCode: "prepare.prepare_selected_agents.failed",
    stepId: "prepare_selected_agents",
    cliVersion: "0.7.97",
    os: { platform: "darwin", release: "25.5.0" },
    inventoryAnomalies: [],
    serviceJob: null,
    lifecycleJournalTail: null,
    serviceLogTail: ["error: connection refused"],
    collectionErrors: [],
    truncated: false,
    ...overrides,
  });

async function createPrepareSessionWithConnectedTerminal(
  harness: SqliteD1Harness
): Promise<{ connectionEpoch: number; expectedRevision: number }> {
  await createPrepareSessionUseCase({
    db: harness.db,
    ownerUserId: "owner-1",
    request: {
      selectedLocalAgentIds: ["claude-code"],
    },
    now: CREATED_AT,
    createId: () => "prepare-1",
    createOpaqueToken: () => "preptok_test",
    hashOpaqueToken: async () => "sha256:test",
  });
  const connected = await registerPrepareTerminalConnectionUseCase({
    db: harness.db,
    prepareSessionId: "prepare-1",
    connectionId: "terminal-1",
    now: new Date("2026-05-08T00:01:00.000Z"),
  });
  return {
    connectionEpoch: connected.terminalConnection.connectionEpoch ?? 0,
    expectedRevision: connected.sessionRevision,
  };
}

async function writeFailedPrepareStepWithDiagnostics(input: {
  diagnostics?: string;
  expectedRevision: number;
  harness: SqliteD1Harness;
  connectionEpoch: number;
}): Promise<PrepareSessionSnapshot> {
  return await writeTerminalStepUseCase({
    db: input.harness.db,
    write: {
      prepareSessionId: "prepare-1",
      connectionEpoch: input.connectionEpoch,
      expectedRevision: input.expectedRevision,
      stepAttemptId: "attempt-prepare",
      stepId: "prepare_selected_agents",
      status: "failed",
      reasonCode: "prepare.prepare_selected_agents.failed",
      message: "Selected agents could not be prepared.",
      ...(input.diagnostics === undefined
        ? {}
        : { diagnostics: input.diagnostics }),
    },
    now: new Date("2026-05-08T00:02:00.000Z"),
  });
}

function readPrepareDiagnosticsLogLines(logSpy: {
  mock: { calls: unknown[][] };
}): string[] {
  return logSpy.mock.calls
    .map((call) => String(call[0] ?? ""))
    .filter((line) => line.startsWith("[prepare.diagnostics] "));
}

describe("prepare session service", () => {
  it("rejects a second automatic session for the same Navigation Action", async () => {
    const harness = createSqliteD1Harness();
    const request = {
      selectedLocalAgentIds: [],
      sourceNavigationAction: {
        signalId: "setup-action-1",
        spaceId: "center-agent-dm-1",
      },
    } as CreatePrepareSessionRequest;
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request,
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_first",
        hashOpaqueToken: async () => "sha256:first",
      });

      await expect(
        createPrepareSessionUseCase({
          db: harness.db,
          ownerUserId: "owner-1",
          request,
          now: new Date("2026-05-08T00:01:00.000Z"),
          createId: () => "prepare-2",
          createOpaqueToken: () => "preptok_second",
          hashOpaqueToken: async () => "sha256:second",
        })
      ).rejects.toThrow(
        "This setup action has already started. Continue explicitly to create a fresh Terminal command."
      );

      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT COUNT(*) AS count FROM openMeldDaemon_prepare_sessions",
        })?.count
      ).toBe(1);
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT COUNT(*) AS count FROM openMeldDaemon_prepare_session_tokens",
        })?.count
      ).toBe(1);
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT COUNT(*) AS count FROM openMeldDaemon_prepare_session_events",
        })?.count
      ).toBe(1);

      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: { selectedLocalAgentIds: [] },
        now: new Date("2026-05-08T00:02:00.000Z"),
        createId: () => "prepare-3",
        createOpaqueToken: () => "preptok_explicit_continue",
        hashOpaqueToken: async () => "sha256:explicit-continue",
      });
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT COUNT(*) AS count FROM openMeldDaemon_prepare_sessions",
        })?.count
      ).toBe(2);
    } finally {
      harness.close();
    }
  });

  it("creates, reads, resolves, and diagnoses the prepare session source of truth", async () => {
    const harness = createSqliteD1Harness();
    try {
      const result = await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {
          connectedComputerId: "computer-existing",
          humanProfileId: "12345678-1234-1234-1234-1234567890ab",
          deviceId: "device-1",
          runtimeLane: "prod",
        },
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });

      const persisted = await readPrepareSessionRecord({
        db: harness.db,
        prepareSessionId: "prepare-1",
      });
      const resolved = await resolvePrepareSessionTokenUseCase({
        db: harness.db,
        opaqueToken: "preptok_test",
        now: CREATED_AT,
        hashOpaqueToken: async () => "sha256:test",
      });
      const diagnostic = await readPrepareDiagnosticUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
      });

      expect(result.snapshot.phase).toBe("waiting_for_terminal");
      expect(result.snapshot.connectedComputerId).toBe("computer-existing");
      expect(result.opaqueTokenExpiresAt).toBe("2026-05-08T00:10:00.000Z");
      expect(result.snapshot.steps.map((step) => step.id)).toEqual([
        "computer",
        "connect_terminal",
        "choose_local_agents",
        "prepare_selected_agents",
        "refresh_service",
        "report_runtime",
        "verify_setup",
        "ready",
      ]);
      expect(persisted?.snapshot.prepareSessionId).toBe("prepare-1");
      expect(resolved.prepareSessionId).toBe("prepare-1");
      expect(diagnostic.events).toHaveLength(1);
      expect(diagnostic.events[0]?.eventType).toBe("session.created");
    } finally {
      harness.close();
    }
  });

  it("uses revision checks as the only snapshot write gate", async () => {
    const harness = createSqliteD1Harness();
    try {
      const { snapshot } = await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {},
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const next = {
        ...snapshot,
        sessionRevision: 1,
        phase: "terminal_connected" as const,
        updatedAt: "2026-05-08T00:01:00.000Z",
      };

      await expect(
        updatePrepareSessionSnapshotIfRevision({
          db: harness.db,
          expectedRevision: 99,
          snapshot: next,
        })
      ).resolves.toBe("conflict");
      await expect(
        updatePrepareSessionSnapshotIfRevision({
          db: harness.db,
          expectedRevision: 0,
          snapshot: next,
        })
      ).resolves.toBe("updated");
      await expect(
        writeWebAgentSelectionUseCase({
          db: harness.db,
          write: {
            prepareSessionId: "prepare-1",
            expectedRevision: 0,
            localAgentIds: ["codex"],
          },
          now: new Date("2026-05-08T00:02:00.000Z"),
        })
      ).rejects.toBeInstanceOf(PrepareSessionRevisionConflictError);
    } finally {
      harness.close();
    }
  });

  it("records duplicate terminal replacement and rejects stale terminal writes", async () => {
    const harness = createSqliteD1Harness();
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {
          selectedLocalAgentIds: ["codex"],
        },
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const first = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-1",
        now: new Date("2026-05-08T00:01:00.000Z"),
      });
      const second = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-2",
        now: new Date("2026-05-08T00:02:00.000Z"),
      });

      await expect(
        writeTerminalStepUseCase({
          db: harness.db,
          write: {
            prepareSessionId: "prepare-1",
            connectionEpoch: first.terminalConnection.connectionEpoch ?? 0,
            expectedRevision: first.sessionRevision,
            stepAttemptId: "attempt-stale",
            stepId: "prepare_selected_agents",
            status: "started",
          },
        })
      ).rejects.toBeInstanceOf(PrepareSessionTerminalConnectionStaleError);

      await expect(
        writeTerminalAgentSelectionUseCase({
          db: harness.db,
          write: {
            prepareSessionId: "prepare-1",
            connectionEpoch: first.terminalConnection.connectionEpoch ?? 0,
            expectedRevision: second.sessionRevision,
            localAgentIds: ["claude-code"],
          },
        })
      ).rejects.toBeInstanceOf(PrepareSessionTerminalConnectionStaleError);

      await expect(
        writeTerminalStepUseCase({
          db: harness.db,
          write: {
            prepareSessionId: "prepare-1",
            connectionEpoch: second.terminalConnection.connectionEpoch ?? 0,
            expectedRevision: second.sessionRevision,
            stepAttemptId: "attempt-current",
            stepId: "prepare_selected_agents",
            status: "started",
          },
          now: new Date("2026-05-08T00:03:00.000Z"),
        })
      ).resolves.toMatchObject({
        phase: "preparing_local_agents",
        terminalConnection: {
          connectionId: "terminal-2",
          connectionEpoch: 2,
        },
      });

      const diagnostic = await readPrepareDiagnosticUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
      });
      expect(diagnostic.events.map((event) => event.eventType)).toEqual([
        "session.created",
        "terminal.connected",
        "terminal.connection_replaced",
        "terminal.step_started",
      ]);
    } finally {
      harness.close();
    }
  });

  it("rejects Terminal step results after Web changes the selected agents", async () => {
    const harness = createSqliteD1Harness();
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {},
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const connected = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-1",
        now: new Date("2026-05-08T00:01:00.000Z"),
      });
      const selectedCodex = await writeWebAgentSelectionUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          expectedRevision: connected.sessionRevision,
          localAgentIds: ["codex"],
        },
        now: new Date("2026-05-08T00:02:00.000Z"),
      });
      const connectionEpoch = connected.terminalConnection.connectionEpoch ?? 0;
      const started = await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch,
          expectedRevision: selectedCodex.sessionRevision,
          stepAttemptId: "attempt-old-start",
          stepId: "prepare_selected_agents",
          status: "started",
        },
        now: new Date("2026-05-08T00:03:00.000Z"),
      });
      const selectedClaudeCode = await writeWebAgentSelectionUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          expectedRevision: started.sessionRevision,
          localAgentIds: ["claude-code"],
        },
        now: new Date("2026-05-08T00:04:00.000Z"),
      });

      await expect(
        writeTerminalStepUseCase({
          db: harness.db,
          write: {
            prepareSessionId: "prepare-1",
            connectionEpoch,
            expectedRevision: started.sessionRevision,
            stepAttemptId: "attempt-old-complete",
            stepId: "prepare_selected_agents",
            status: "completed",
          },
          now: new Date("2026-05-08T00:05:00.000Z"),
        })
      ).rejects.toBeInstanceOf(PrepareSessionRevisionConflictError);

      const persisted = await readPrepareSessionRecord({
        db: harness.db,
        prepareSessionId: "prepare-1",
      });
      expect(persisted?.snapshot.sessionRevision).toBe(
        selectedClaudeCode.sessionRevision
      );
      expect(persisted?.snapshot.selectedLocalAgentIds).toEqual([
        "claude-code",
      ]);
      expect(
        persisted?.snapshot.steps.find(
          (step) => step.id === "prepare_selected_agents"
        )?.state
      ).toBe("active");
    } finally {
      harness.close();
    }
  });

  it("saves Terminal agent selection with current connection evidence", async () => {
    const harness = createSqliteD1Harness();
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {},
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const connected = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-1",
        now: new Date("2026-05-08T00:01:00.000Z"),
      });
      const connectionEpoch = connected.terminalConnection.connectionEpoch ?? 0;

      const selected = await writeTerminalAgentSelectionUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch,
          expectedRevision: connected.sessionRevision,
          localAgentIds: ["codex"],
        },
        now: new Date("2026-05-08T00:02:00.000Z"),
      });

      expect(selected.selectedLocalAgentIds).toEqual(["codex"]);
      expect(selected.terminalConnection.lastSeenAt).toBe(
        "2026-05-08T00:02:00.000Z"
      );
      const diagnostic = await readPrepareDiagnosticUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
      });
      expect(diagnostic.events.at(-1)).toMatchObject({
        actor: "terminal",
        connectionEpoch,
        eventType: "terminal.agent_selection_saved",
        localAgentIds: ["codex"],
      });
    } finally {
      harness.close();
    }
  });

  it("stores the Terminal-reported local agent catalog as prepare session truth", async () => {
    const harness = createSqliteD1Harness();
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {},
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const connected = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-1",
        now: new Date("2026-05-08T00:01:00.000Z"),
      });
      const connectionEpoch = connected.terminalConnection.connectionEpoch ?? 0;

      const withCatalog = await writeTerminalLocalAgentCatalogUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch,
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
        },
        now: new Date("2026-05-08T00:02:00.000Z"),
      });

      expect(withCatalog.phase).toBe("waiting_for_agent_selection");
      expect(withCatalog.localAgentCatalog?.entries).toEqual([
        expect.objectContaining({
          agentId: "codex",
          detected: true,
          selectable: true,
        }),
      ]);
      expect(
        withCatalog.steps.find((step) => step.id === "choose_local_agents")
          ?.state
      ).toBe("waiting_for_user");

      const diagnostic = await readPrepareDiagnosticUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
      });
      expect(diagnostic.events.at(-1)).toMatchObject({
        eventType: "terminal.local_agent_catalog_reported",
        stepId: "choose_local_agents",
        connectionEpoch,
      });
    } finally {
      harness.close();
    }
  });

  it("records the real computer identity reported by Terminal-owned setup steps", async () => {
    const harness = createSqliteD1Harness();
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {
          selectedLocalAgentIds: ["codex"],
        },
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const connected = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-1",
        now: new Date("2026-05-08T00:01:00.000Z"),
      });
      const connectionEpoch = connected.terminalConnection.connectionEpoch ?? 0;
      const prepared = await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch,
          expectedRevision: connected.sessionRevision,
          stepAttemptId: "attempt-prepare",
          stepId: "prepare_selected_agents",
          status: "completed",
        },
        now: new Date("2026-05-08T00:02:00.000Z"),
      });

      const refreshed = await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch,
          deviceId: "device-actual",
          expectedRevision: prepared.sessionRevision,
          localReadinessSnapshot: buildLocalReadinessSnapshot(),
          runtimeLane: "dev-local",
          stepAttemptId: "attempt-refresh",
          stepId: "refresh_service",
          status: "completed",
        },
        now: new Date("2026-05-08T00:03:00.000Z"),
      });

      expect(refreshed.deviceId).toBe("device-actual");
      expect(refreshed.localReadinessSnapshot).toEqual(
        buildLocalReadinessSnapshot()
      );
      expect(refreshed.runtimeLane).toBe("dev-local");
    } finally {
      harness.close();
    }
  });

  it("lets Terminal-reported runtime identity replace stale Web device hints", async () => {
    const harness = createSqliteD1Harness();
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {
          deviceId: "device-stale",
          runtimeLane: "prod",
          selectedLocalAgentIds: ["codex"],
        },
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const connected = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-1",
        now: new Date("2026-05-08T00:01:00.000Z"),
      });
      const prepared = await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch: connected.terminalConnection.connectionEpoch ?? 0,
          expectedRevision: connected.sessionRevision,
          stepAttemptId: "attempt-prepare",
          stepId: "prepare_selected_agents",
          status: "completed",
        },
        now: new Date("2026-05-08T00:02:00.000Z"),
      });

      const refreshed = await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch: connected.terminalConnection.connectionEpoch ?? 0,
          deviceId: "device-actual",
          expectedRevision: prepared.sessionRevision,
          localReadinessSnapshot: buildLocalReadinessSnapshot(),
          runtimeLane: "dev-local",
          stepAttemptId: "attempt-refresh",
          stepId: "refresh_service",
          status: "completed",
        },
        now: new Date("2026-05-08T00:03:00.000Z"),
      });

      expect(refreshed.lifecycleStatus).toBe("active");
      expect(refreshed.phase).not.toBe("blocked");
      expect(refreshed.deviceId).toBe("device-actual");
      expect(refreshed.runtimeLane).toBe("dev-local");
      expect(refreshed.blockers).toEqual([]);
    } finally {
      harness.close();
    }
  });

  it("blocks runtime-owned verification when Terminal does not report runtime identity", async () => {
    const harness = createSqliteD1Harness();
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {
          selectedLocalAgentIds: ["codex"],
        },
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const connected = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-1",
        now: new Date("2026-05-08T00:01:00.000Z"),
      });

      const blocked = await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch: connected.terminalConnection.connectionEpoch ?? 0,
          expectedRevision: connected.sessionRevision,
          stepAttemptId: "attempt-verify-missing-runtime",
          stepId: "verify_setup",
          status: "completed",
        },
        now: new Date("2026-05-08T00:02:00.000Z"),
      });

      expect(blocked.lifecycleStatus).toBe("active");
      expect(blocked.phase).toBe("blocked");
      expect(blocked.blockers).toMatchObject([
        {
          stepId: "verify_setup",
          reasonCode: "prepare.openmeld_service_runtime_identity_incomplete",
        },
      ]);
      expect(blocked.steps.find((step) => step.id === "ready")?.state).toBe(
        "pending"
      );
    } finally {
      harness.close();
    }
  });

  it("blocks out-of-order Terminal completion before prior setup steps complete", async () => {
    const harness = createSqliteD1Harness();
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {
          selectedLocalAgentIds: ["codex"],
        },
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const connected = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-1",
        now: new Date("2026-05-08T00:01:00.000Z"),
      });

      const blocked = await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch: connected.terminalConnection.connectionEpoch ?? 0,
          deviceId: "device-actual",
          expectedRevision: connected.sessionRevision,
          runtimeLane: "dev-local",
          stepAttemptId: "attempt-verify-out-of-order",
          stepId: "verify_setup",
          status: "completed",
        },
        now: new Date("2026-05-08T00:02:00.000Z"),
      });

      expect(blocked.lifecycleStatus).toBe("active");
      expect(blocked.phase).toBe("blocked");
      expect(blocked.blockers).toMatchObject([
        {
          stepId: "verify_setup",
          reasonCode: "prepare.step_out_of_order",
        },
      ]);
      expect(
        blocked.steps.find((step) => step.id === "prepare_selected_agents")
          ?.state
      ).toBe("active");
      expect(blocked.steps.find((step) => step.id === "ready")?.state).toBe(
        "pending"
      );
    } finally {
      harness.close();
    }
  });

  it("resumes a rerun from the first unfinished Terminal-owned step", async () => {
    const harness = createSqliteD1Harness();
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {
          selectedLocalAgentIds: ["claude-code"],
        },
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const connected = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-1",
        now: new Date("2026-05-08T00:01:00.000Z"),
      });
      const firstEpoch = connected.terminalConnection.connectionEpoch ?? 0;
      const prepared = await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch: firstEpoch,
          expectedRevision: connected.sessionRevision,
          stepAttemptId: "attempt-prepare",
          stepId: "prepare_selected_agents",
          status: "completed",
        },
        now: new Date("2026-05-08T00:02:00.000Z"),
      });
      const refreshed = await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch: firstEpoch,
          expectedRevision: prepared.sessionRevision,
          deviceId: "device-actual",
          localReadinessSnapshot: buildLocalReadinessSnapshot(),
          runtimeLane: "dev-local",
          stepAttemptId: "attempt-refresh",
          stepId: "refresh_service",
          status: "completed",
        },
        now: new Date("2026-05-08T00:03:00.000Z"),
      });
      const blocked = await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch: firstEpoch,
          expectedRevision: refreshed.sessionRevision,
          stepAttemptId: "attempt-report",
          stepId: "report_runtime",
          status: "failed",
          reasonCode: "prepare.report_runtime.failed",
          message: "OpenMeld Service stopped before runtime reporting.",
        },
        now: new Date("2026-05-08T00:04:00.000Z"),
      });
      const disconnected = await disconnectPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionEpoch: firstEpoch,
        reasonCode: "socket_closed",
        now: new Date("2026-05-08T00:05:00.000Z"),
      });
      const reconnected = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-2",
        now: new Date("2026-05-08T00:06:00.000Z"),
      });

      expect(
        prepared.steps.find((step) => step.id === "refresh_service")?.state
      ).toBe("active");
      expect(
        refreshed.steps.find((step) => step.id === "report_runtime")?.state
      ).toBe("active");
      expect(blocked.phase).toBe("blocked");
      expect(blocked.blockers).toMatchObject([
        {
          stepId: "report_runtime",
          reasonCode: "prepare.report_runtime.failed",
        },
      ]);
      expect(
        blocked.steps.find((step) => step.id === "verify_setup")?.state
      ).toBe("pending");
      expect(disconnected.phase).toBe("terminal_disconnected");
      expect(
        disconnected.steps.find((step) => step.id === "connect_terminal")?.state
      ).toBe("terminal_disconnected");
      expect(
        disconnected.steps.find((step) => step.id === "report_runtime")?.state
      ).toBe("pending");
      expect(disconnected.blockers).toEqual([]);
      expect(reconnected.phase).toBe("reporting_runtime");
      expect(
        reconnected.steps.find((step) => step.id === "refresh_service")?.state
      ).toBe("complete");
      expect(
        reconnected.steps.find((step) => step.id === "report_runtime")?.state
      ).toBe("active");
      expect(reconnected.blockers).toEqual([]);
    } finally {
      harness.close();
    }
  });

  it("logs one [prepare.diagnostics] line for failed step writes with diagnostics and keeps them out of events", async () => {
    const harness = createSqliteD1Harness();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // Silence output; assertions read the spy calls.
    });
    try {
      const terminal = await createPrepareSessionWithConnectedTerminal(harness);
      const blocked = await writeFailedPrepareStepWithDiagnostics({
        harness,
        ...terminal,
        diagnostics: buildValidPrepareStepDiagnostics(),
      });
      const diagnostic = await readPrepareDiagnosticUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
      });

      expect(blocked.phase).toBe("blocked");
      const diagnosticsLogLines = readPrepareDiagnosticsLogLines(logSpy);
      expect(diagnosticsLogLines).toHaveLength(1);
      const logged = JSON.parse(
        (diagnosticsLogLines[0] ?? "").slice("[prepare.diagnostics] ".length)
      ) as {
        prepareSessionId: string;
        stepId: string;
        reasonCode: string;
        diagnostics: {
          bundleVersion: number;
          serviceLogTail: string[];
        };
        diagnosticsRejected?: string;
      };
      expect(logged.prepareSessionId).toBe("prepare-1");
      expect(logged.stepId).toBe("prepare_selected_agents");
      expect(logged.reasonCode).toBe("prepare.prepare_selected_agents.failed");
      expect(logged.diagnostics.bundleVersion).toBe(1);
      expect(logged.diagnostics.serviceLogTail).toEqual([
        "error: connection refused",
      ]);
      expect(logged.diagnosticsRejected).toBeUndefined();
      // Diagnostics are log-only evidence: they must not enter the persisted
      // event stream or the snapshot.
      expect(JSON.stringify(diagnostic.events)).not.toContain("bundleVersion");
      expect(JSON.stringify(diagnostic.snapshot)).not.toContain(
        "bundleVersion"
      );
    } finally {
      logSpy.mockRestore();
      harness.close();
    }
  });

  it("logs invalid_json for non-JSON prepare diagnostics without raw text", async () => {
    const harness = createSqliteD1Harness();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // Silence output; assertions read the spy calls.
    });
    try {
      const terminal = await createPrepareSessionWithConnectedTerminal(harness);
      await writeFailedPrepareStepWithDiagnostics({
        harness,
        ...terminal,
        diagnostics: "not-json Authorization: Bearer raw-secret",
      });

      const diagnosticsLogLines = readPrepareDiagnosticsLogLines(logSpy);
      expect(diagnosticsLogLines).toHaveLength(1);
      expect(diagnosticsLogLines[0]).not.toContain("raw-secret");
      expect(diagnosticsLogLines[0]).not.toContain("not-json");
      const logged = JSON.parse(
        (diagnosticsLogLines[0] ?? "").slice("[prepare.diagnostics] ".length)
      ) as {
        diagnosticsRejected: string;
        diagnosticsLength: number;
        diagnostics?: unknown;
      };
      expect(logged.diagnosticsRejected).toBe("invalid_json");
      expect(logged.diagnosticsLength).toBe(
        "not-json Authorization: Bearer raw-secret".length
      );
      expect(logged.diagnostics).toBeUndefined();
    } finally {
      logSpy.mockRestore();
      harness.close();
    }
  });

  it("logs schema_invalid for invalid prepare diagnostics without raw payload", async () => {
    const harness = createSqliteD1Harness();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // Silence output; assertions read the spy calls.
    });
    try {
      const terminal = await createPrepareSessionWithConnectedTerminal(harness);
      const diagnostics = JSON.stringify({
        bundleVersion: 2,
        raw: "Authorization: Bearer raw-secret",
      });
      await writeFailedPrepareStepWithDiagnostics({
        harness,
        ...terminal,
        diagnostics,
      });

      const diagnosticsLogLines = readPrepareDiagnosticsLogLines(logSpy);
      expect(diagnosticsLogLines).toHaveLength(1);
      expect(diagnosticsLogLines[0]).not.toContain("raw-secret");
      expect(diagnosticsLogLines[0]).not.toContain("bundleVersion");
      const logged = JSON.parse(
        (diagnosticsLogLines[0] ?? "").slice("[prepare.diagnostics] ".length)
      ) as {
        diagnosticsRejected: string;
        diagnosticsLength: number;
        diagnostics?: unknown;
      };
      expect(logged.diagnosticsRejected).toBe("schema_invalid");
      expect(logged.diagnosticsLength).toBe(diagnostics.length);
      expect(logged.diagnostics).toBeUndefined();
    } finally {
      logSpy.mockRestore();
      harness.close();
    }
  });

  it("redacts smuggled prepare diagnostics credentials before logging", async () => {
    const harness = createSqliteD1Harness();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // Silence output; assertions read the spy calls.
    });
    try {
      const terminal = await createPrepareSessionWithConnectedTerminal(harness);
      await writeFailedPrepareStepWithDiagnostics({
        harness,
        ...terminal,
        diagnostics: buildValidPrepareStepDiagnostics({
          serviceLogTail: ["Authorization: Bearer raw-secret"],
        }),
      });

      const diagnosticsLogLines = readPrepareDiagnosticsLogLines(logSpy);
      expect(diagnosticsLogLines).toHaveLength(1);
      expect(diagnosticsLogLines[0]).not.toContain("raw-secret");
      const logged = JSON.parse(
        (diagnosticsLogLines[0] ?? "").slice("[prepare.diagnostics] ".length)
      ) as {
        diagnostics: { serviceLogTail: string[] };
      };
      expect(logged.diagnostics.serviceLogTail).toEqual([
        "Authorization: Bearer [redacted]",
      ]);
    } finally {
      logSpy.mockRestore();
      harness.close();
    }
  });

  it("keeps failed step writes without diagnostics silent (published CLIs)", async () => {
    const harness = createSqliteD1Harness();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // Silence output; assertions read the spy calls.
    });
    try {
      const terminal = await createPrepareSessionWithConnectedTerminal(harness);
      const blocked = await writeFailedPrepareStepWithDiagnostics({
        harness,
        ...terminal,
      });

      expect(blocked.phase).toBe("blocked");
      const diagnosticsLogLines = readPrepareDiagnosticsLogLines(logSpy);
      expect(diagnosticsLogLines).toHaveLength(0);
    } finally {
      logSpy.mockRestore();
      harness.close();
    }
  });

  it("moves agent selection back to pending when Terminal disconnects before selection is saved", async () => {
    const harness = createSqliteD1Harness();
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {},
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const connected = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-1",
        now: new Date("2026-05-08T00:01:00.000Z"),
      });
      const connectionEpoch = connected.terminalConnection.connectionEpoch ?? 0;

      const disconnected = await disconnectPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionEpoch,
        reasonCode: "socket_closed",
        now: new Date("2026-05-08T00:02:00.000Z"),
      });

      expect(disconnected.phase).toBe("terminal_disconnected");
      expect(
        disconnected.steps.find((step) => step.id === "connect_terminal")?.state
      ).toBe("terminal_disconnected");
      expect(
        disconnected.steps.find((step) => step.id === "choose_local_agents")
          ?.state
      ).toBe("pending");
    } finally {
      harness.close();
    }
  });

  it("keeps a Connect Terminal blocker visible after the wrong Terminal closes", async () => {
    const harness = createSqliteD1Harness();
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {},
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const connected = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-1",
        now: new Date("2026-05-08T00:01:00.000Z"),
      });
      const connectionEpoch = connected.terminalConnection.connectionEpoch ?? 0;
      await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch,
          expectedRevision: connected.sessionRevision,
          stepAttemptId: "attempt-auth",
          stepId: "connect_terminal",
          status: "failed",
          reasonCode: "prepare.auth.account_mismatch",
          message:
            "This Terminal is signed in to a different OpenMeld account than OpenMeld Web.",
        },
        now: new Date("2026-05-08T00:02:00.000Z"),
      });

      const disconnected = await disconnectPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionEpoch,
        reasonCode: "socket_closed",
        now: new Date("2026-05-08T00:03:00.000Z"),
      });

      expect(disconnected.phase).toBe("blocked");
      expect(disconnected.terminalConnection.status).toBe("disconnected");
      expect(
        disconnected.steps.find((step) => step.id === "connect_terminal")?.state
      ).toBe("blocked");
      expect(disconnected.blockers).toMatchObject([
        {
          stepId: "connect_terminal",
          reasonCode: "prepare.auth.account_mismatch",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("completes local prepare when Web chooses no local agents", async () => {
    const harness = createSqliteD1Harness();
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {},
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const connected = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-1",
        now: new Date("2026-05-08T00:01:00.000Z"),
      });

      const skipped = await writeWebAgentSelectionUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          expectedRevision: connected.sessionRevision,
          localAgentIds: [],
        },
        now: new Date("2026-05-08T00:02:00.000Z"),
      });

      expect(skipped.lifecycleStatus).toBe("completed");
      expect(skipped.phase).toBe("ready");
      expect(skipped.selectedLocalAgentIds).toEqual([]);
      expect(
        skipped.steps
          .filter((step) =>
            [
              "choose_local_agents",
              "prepare_selected_agents",
              "refresh_service",
              "report_runtime",
              "verify_setup",
              "ready",
            ].includes(step.id)
          )
          .map((step) => [step.id, step.state, step.summary])
      ).toEqual([
        ["choose_local_agents", "complete", "No local agents selected."],
        [
          "prepare_selected_agents",
          "complete",
          "Skipped. No local agents selected.",
        ],
        [
          "refresh_service",
          "complete",
          "Skipped. OpenMeld Service is only needed for selected local agents.",
        ],
        [
          "report_runtime",
          "complete",
          "Skipped. There are no selected local agents to report.",
        ],
        [
          "verify_setup",
          "complete",
          "Skipped. There are no selected local agents to verify.",
        ],
        ["ready", "complete", "Setup complete. No local agents were selected."],
      ]);

      const diagnostic = await readPrepareDiagnosticUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
      });
      expect(diagnostic.events.at(-1)).toMatchObject({
        eventType: "web.agent_selection_saved",
        localAgentIds: [],
        message: "Local agent selection saved. No local agents selected.",
      });
    } finally {
      harness.close();
    }
  });

  it("does not downgrade a ready session when Terminal closes after setup completes", async () => {
    const harness = createSqliteD1Harness();
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {
          selectedLocalAgentIds: ["codex"],
        },
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const connected = await registerPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionId: "terminal-1",
        now: new Date("2026-05-08T00:01:00.000Z"),
      });
      const connectionEpoch = connected.terminalConnection.connectionEpoch ?? 0;
      const prepared = await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch,
          expectedRevision: connected.sessionRevision,
          stepAttemptId: "attempt-prepare",
          stepId: "prepare_selected_agents",
          status: "completed",
        },
        now: new Date("2026-05-08T00:02:00.000Z"),
      });
      const refreshed = await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch,
          deviceId: "device-actual",
          expectedRevision: prepared.sessionRevision,
          localReadinessSnapshot: buildLocalReadinessSnapshot(),
          runtimeLane: "dev-local",
          stepAttemptId: "attempt-refresh",
          stepId: "refresh_service",
          status: "completed",
        },
        now: new Date("2026-05-08T00:03:00.000Z"),
      });
      const reported = await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch,
          deviceId: "device-actual",
          expectedRevision: refreshed.sessionRevision,
          localReadinessSnapshot: buildLocalReadinessSnapshot(),
          runtimeLane: "dev-local",
          stepAttemptId: "attempt-report",
          stepId: "report_runtime",
          status: "completed",
        },
        now: new Date("2026-05-08T00:04:00.000Z"),
      });
      const completed = await writeTerminalStepUseCase({
        db: harness.db,
        write: {
          prepareSessionId: "prepare-1",
          connectionEpoch,
          deviceId: "device-actual",
          expectedRevision: reported.sessionRevision,
          localReadinessSnapshot: buildLocalReadinessSnapshot(),
          runtimeLane: "dev-local",
          stepAttemptId: "attempt-verify",
          stepId: "verify_setup",
          status: "completed",
        },
        now: new Date("2026-05-08T00:05:00.000Z"),
      });
      const disconnected = await disconnectPrepareTerminalConnectionUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
        connectionEpoch,
        reasonCode: "socket_closed",
        now: new Date("2026-05-08T00:06:00.000Z"),
      });

      expect(completed.lifecycleStatus).toBe("completed");
      expect(completed.phase).toBe("ready");
      expect(disconnected.lifecycleStatus).toBe("completed");
      expect(disconnected.phase).toBe("ready");
      expect(disconnected.terminalConnection.status).toBe("disconnected");
      expect(
        disconnected.steps.find((step) => step.id === "ready")?.state
      ).toBe("complete");
      expect(
        disconnected.steps.find((step) => step.id === "connect_terminal")?.state
      ).toBe("complete");
    } finally {
      harness.close();
    }
  });

  it("records the setup bootstrap result on the completed prepare session", async () => {
    const harness = createSqliteD1Harness();
    try {
      const { snapshot } = await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {},
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const completed = completePrepareSessionSnapshotForTest(snapshot);
      await expect(
        updatePrepareSessionSnapshotIfRevision({
          db: harness.db,
          expectedRevision: snapshot.sessionRevision,
          snapshot: completed,
        })
      ).resolves.toBe("updated");

      const recorded = await writeSetupBootstrapResultUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        write: {
          prepareSessionId: "prepare-1",
          setupBootstrap: buildCompletedSetupBootstrapResult(),
        },
        now: new Date("2026-05-08T00:08:00.000Z"),
      });
      const diagnostic = await readPrepareDiagnosticUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
      });

      expect(recorded.sessionRevision).toBe(completed.sessionRevision + 1);
      expect(recorded.setupBootstrap).toMatchObject({
        status: "completed",
        assistantProfile: null,
        facts: null,
        membership: null,
        welcomeMessage: null,
        welcomingSpace: null,
      });
      expect(diagnostic.events.at(-1)?.eventType).toBe(
        "terminal.setup_bootstrap_recorded"
      );
    } finally {
      harness.close();
    }
  });

  it("rejects setup bootstrap results before the prepare session is complete", async () => {
    const harness = createSqliteD1Harness();
    try {
      await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {},
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });

      await expect(
        writeSetupBootstrapResultUseCase({
          db: harness.db,
          ownerUserId: "owner-1",
          write: {
            prepareSessionId: "prepare-1",
            setupBootstrap: buildCompletedSetupBootstrapResult(),
          },
        })
      ).rejects.toBeInstanceOf(PrepareSessionSetupBootstrapNotReadyError);
    } finally {
      harness.close();
    }
  });

  it("keeps token expiry and event append behavior explicit in the repo", async () => {
    const harness = createSqliteD1Harness();
    try {
      const { snapshot } = await createPrepareSessionUseCase({
        db: harness.db,
        ownerUserId: "owner-1",
        request: {},
        now: CREATED_AT,
        createId: () => "prepare-1",
        createOpaqueToken: () => "preptok_test",
        hashOpaqueToken: async () => "sha256:test",
      });
      const expired = await readPrepareSessionRecordByTokenDigest({
        db: harness.db,
        tokenDigest: "sha256:test",
        nowMs: Date.parse("2026-05-08T01:00:00.000Z"),
      });
      const appended = await appendPrepareSessionEvent({
        db: harness.db,
        ownerUserId: "owner-1",
        event: {
          eventId: "event-2",
          prepareSessionId: snapshot.prepareSessionId,
          sessionRevision: snapshot.sessionRevision,
          eventType: "blocker.added",
          actor: "system",
          stepId: "connect_terminal",
          connectionEpoch: null,
          reasonCode: "prepare.test_blocker",
          message: "Test blocker.",
          localAgentIds: [],
          createdAt: "2026-05-08T00:01:00.000Z",
        },
      });
      const diagnostic = await readPrepareDiagnosticUseCase({
        db: harness.db,
        prepareSessionId: "prepare-1",
      });

      expect(expired).toBeNull();
      expect(appended).toBe(true);
      expect(diagnostic.events.at(-1)?.eventType).toBe("blocker.added");
    } finally {
      harness.close();
    }
  });
});

function completePrepareSessionSnapshotForTest(
  snapshot: PrepareSessionSnapshot
): PrepareSessionSnapshot {
  const completedAt = "2026-05-08T00:07:00.000Z";
  return {
    ...snapshot,
    completedAt,
    lifecycleStatus: "completed",
    phase: "ready",
    sessionRevision: snapshot.sessionRevision + 1,
    steps: snapshot.steps.map((step) => ({
      ...step,
      completedAt,
      startedAt: step.startedAt ?? completedAt,
      state: "complete" as const,
      updatedAt: completedAt,
    })),
    updatedAt: completedAt,
  };
}

function buildCompletedSetupBootstrapResult(): PrepareSetupBootstrapResult {
  return {
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
  };
}

function buildLocalReadinessSnapshot() {
  return {
    observedAt: "2026-05-08T00:02:00.000Z",
    service: {
      expectedVersion: "0.4.0",
      installedVersion: "0.4.0",
      installStatus: "installed_current" as const,
      runtimeStatus: "running" as const,
    },
    skills: {
      status: "up_to_date" as const,
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
