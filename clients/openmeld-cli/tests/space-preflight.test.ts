import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthSessionStateResult } from "../src/config/auth-session";
import type { DaemonServiceRuntimeStatus } from "../src/config/daemon-state";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import {
  formatOpenMeldCliCommand,
  formatOpenMeldCliCommands,
} from "../src/runtime/cli-entry-command";
import { GatewayHttpError } from "../src/space/gateway-response";
import {
  emitSpaceCommandPreflight,
  emitSpaceFailureNextStep,
} from "../src/space/preflight";
import type { CurrentReplyReadinessSnapshot } from "../src/system/current-reply-readiness-snapshot";
import type { AgentReplyReadinessStatus } from "../src/system/reply-readiness";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

vi.mock("../src/config/auth-session", () => ({
  getAuthSessionState: vi.fn(),
}));

const { resolveCurrentReplyReadinessSnapshotMock } = vi.hoisted(() => ({
  resolveCurrentReplyReadinessSnapshotMock: vi.fn(),
}));

vi.mock("../src/system/current-reply-readiness-snapshot", () => ({
  resolveCurrentReplyReadinessSnapshot:
    resolveCurrentReplyReadinessSnapshotMock,
}));

import { getAuthSessionState } from "../src/config/auth-session";
import { OpenMeldLockError } from "../src/config/lock";

const createProfile = (): OpenMeldProfile =>
  createTestOpenMeldProfile({
    openMeldProfileId: "agt-preflight-1",
    profileName: "preflight-agent",
    profileKind: "agent",
  });

const createAuthState = (
  state: AuthSessionStateResult["state"],
  authBaseUrl?: string
): AuthSessionStateResult => ({
  state,
  session:
    state === "valid" && authBaseUrl
      ? {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl,
          clientId: "openmeld-cli",
          createdAt: "2026-03-01T00:00:00.000Z",
        }
      : null,
});

const createDaemonRuntimeStatus = (
  status: DaemonServiceRuntimeStatus["status"]
): DaemonServiceRuntimeStatus => ({
  status,
  mode: status === "running" ? "background" : null,
  pid: status === "running" ? 12_345 : null,
  startedAt: status === "running" ? "2026-03-01T00:00:00.000Z" : null,
  updatedAt: status === "running" ? "2026-03-01T00:00:00.000Z" : null,
  managedBySystemService: false,
  serviceController: "unknown",
  autoStart: false,
  ...(status === "stale" ? { reason: "heartbeat_stale" } : {}),
});

const createPresenter = () => {
  return {
    view: "agent" as const,
    event: vi.fn(),
    line: vi.fn(),
    data: vi.fn(),
  };
};

const createAgentReplyReadiness = (
  overrides: Partial<AgentReplyReadinessStatus> = {}
): AgentReplyReadinessStatus => ({
  deviceReplyReadiness: {
    reasonCodes: [],
    reasonText:
      "This device is ready for Space replies from local agent profiles",
    replyReadiness: "ready",
    updatedAt: "2026-03-01T00:00:00.000Z",
    wakeableRouteCount: 1,
  },
  profileId: "agt-preflight-1",
  reasonCodes: [],
  reasonText: "This profile can reply from Space when mentioned",
  replyReadiness: "ready",
  transportMode: "local-cli",
  updatedAt: "2026-03-01T00:00:00.000Z",
  ...overrides,
});

const createReplyReadinessSnapshot = (
  overrides: Partial<CurrentReplyReadinessSnapshot> = {}
): CurrentReplyReadinessSnapshot => {
  const agentReplyReadiness = createAgentReplyReadiness();
  const {
    agentReplyReadiness: overriddenAgentReplyReadiness,
    daemonRouteObservation,
    daemonStatus,
    deviceReplyReadiness,
    displayRuntimeStatus,
    gatewayChainReadiness,
    inventory,
    observedAt,
    openClawLocalDiagnostics,
    profileWorkspaceRuntimeResolution,
    runtimeProjection,
    runtimeStatus,
    serviceManagerStatus,
  } = overrides;
  return {
    daemonRouteObservation: daemonRouteObservation ?? {
      detail: "No OpenMeld profile was selected for a server route lookup.",
      observedAt: "2026-03-01T00:00:00.000Z",
      profileId: null,
      reasonCode: "profile_not_selected",
      route: null,
      status: "unavailable",
    },
    observedAt: observedAt ?? "2026-03-01T00:00:00.000Z",
    daemonStatus: daemonStatus ?? {
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.0.1",
        installSource: "cli.auto_check",
        installedAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    },
    inventory: inventory ?? null,
    gatewayChainReadiness: gatewayChainReadiness ?? null,
    runtimeProjection: runtimeProjection ?? null,
    runtimeStatus: runtimeStatus ?? createDaemonRuntimeStatus("running"),
    displayRuntimeStatus:
      displayRuntimeStatus ?? createDaemonRuntimeStatus("running"),
    serviceManagerStatus: serviceManagerStatus ?? null,
    deviceReplyReadiness:
      deviceReplyReadiness ?? agentReplyReadiness.deviceReplyReadiness,
    agentReplyReadiness: overriddenAgentReplyReadiness ?? agentReplyReadiness,
    openClawLocalDiagnostics: openClawLocalDiagnostics ?? null,
    profileWorkspaceRuntimeResolution:
      profileWorkspaceRuntimeResolution ?? null,
  };
};

describe("space preflight", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resolveCurrentReplyReadinessSnapshotMock.mockReset();
  });

  it("keeps send preflight lightweight when local service is not required", async () => {
    vi.mocked(getAuthSessionState).mockResolvedValue(createAuthState("valid"));
    const presenter = createPresenter();

    await emitSpaceCommandPreflight({
      presenter,
      command: "send",
      profile: createProfile(),
      baseUrl: "https://gateway.openmeld.invalid",
      resolvedView: "agent",
    });

    expect(resolveCurrentReplyReadinessSnapshotMock).not.toHaveBeenCalled();

    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.send.preflight",
        text: "preflight send: auth=valid, profile=agt-preflight-1, local_service=not_required",
        data: expect.objectContaining({
          command: "send",
          actionRequirements: {
            localService: "not_required",
            localServiceSummary:
              "OpenMeld Service is not required to send a Space message.",
          },
          auth: expect.objectContaining({
            state: "valid",
            ready: true,
          }),
          agentReplyReadiness: null,
          env: expect.objectContaining({
            baseUrl: "https://gateway.openmeld.invalid",
          }),
        }),
      })
    );
    expect(
      vi.mocked(presenter.line).mock.calls[0]?.[0].data
    ).not.toHaveProperty("services");
  });

  it("passes a caller-provided runtime projection into the readiness snapshot", async () => {
    const runtimeProjection = {
      status: "ok" as const,
      mode: "check" as const,
      projectedControllerIds: ["codex"],
      missingControllerIds: [],
      disabledControllerIds: [],
      repairedControllerIds: [],
      reason: "projection was already checked for this command",
    };
    vi.mocked(getAuthSessionState).mockResolvedValue(createAuthState("valid"));
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
      createReplyReadinessSnapshot()
    );

    await emitSpaceCommandPreflight({
      presenter: createPresenter(),
      command: "join",
      profile: createProfile(),
      baseUrl: "https://gateway.openmeld.invalid",
      resolvedView: "human",
      runtimeProjection,
    });

    expect(resolveCurrentReplyReadinessSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeProjection,
      })
    );
  });

  it("does not surface unbound wake readiness as a send preflight blocker", async () => {
    vi.mocked(getAuthSessionState).mockResolvedValue(createAuthState("valid"));
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
      createReplyReadinessSnapshot({
        agentReplyReadiness: createAgentReplyReadiness({
          reasonCodes: ["profile.unbound"],
          reasonText: "local agent connection is missing",
          replyReadiness: "blocked",
        }),
      })
    );
    const presenter = createPresenter();

    await emitSpaceCommandPreflight({
      presenter,
      command: "send",
      profile: createProfile(),
      baseUrl: "https://gateway.openmeld.invalid",
      resolvedView: "agent",
    });

    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.send.preflight",
        data: expect.objectContaining({
          agentReplyReadiness: null,
        }),
      })
    );
  });

  it("keeps local service diagnostics out of the human send gate", async () => {
    vi.mocked(getAuthSessionState).mockResolvedValue(createAuthState("valid"));
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
      createReplyReadinessSnapshot()
    );
    const presenter = createPresenter();

    await emitSpaceCommandPreflight({
      presenter,
      command: "send",
      profile: createProfile(),
      baseUrl: "https://gateway.openmeld.invalid",
      resolvedView: "human",
    });

    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.send.preflight",
      text: "Quick check before send: signed in, profile preflight-agent. OpenMeld Service is not required to send a Space message.",
    });
  });

  it("does not tell leave users to repair local agent readiness before leaving", async () => {
    vi.mocked(getAuthSessionState).mockResolvedValue(createAuthState("valid"));
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
      createReplyReadinessSnapshot({
        deviceReplyReadiness: {
          reasonCodes: ["service.drifted"],
          reasonText:
            "OpenMeld Service artifact drift was detected on this device",
          replyReadiness: "blocked",
          updatedAt: "2026-03-01T00:00:00.000Z",
          wakeableRouteCount: 0,
        },
        agentReplyReadiness: createAgentReplyReadiness({
          deviceReplyReadiness: {
            reasonCodes: ["service.drifted"],
            reasonText:
              "OpenMeld Service artifact drift was detected on this device",
            replyReadiness: "blocked",
            updatedAt: "2026-03-01T00:00:00.000Z",
            wakeableRouteCount: 0,
          },
          reasonCodes: ["profile.unbound", "workspace.missing"],
          reasonText: "local agent connection is missing",
          replyReadiness: "blocked",
        }),
      })
    );
    const presenter = createPresenter();

    await emitSpaceCommandPreflight({
      presenter,
      command: "leave",
      profile: createProfile(),
      baseUrl: "https://gateway.openmeld.invalid",
      resolvedView: "agent",
    });

    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.leave.preflight",
        text: "preflight leave: auth=valid, profile=agt-preflight-1, local_service=not_required",
        data: expect.objectContaining({
          serviceRepairGuidance: null,
        }),
      })
    );
    expect(presenter.line).not.toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.leave.preflight.next_step",
      })
    );
  });

  it("emits readable preflight summary for human view", async () => {
    vi.mocked(getAuthSessionState).mockResolvedValue(createAuthState("valid"));
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
      createReplyReadinessSnapshot()
    );
    const presenter = createPresenter();

    await emitSpaceCommandPreflight({
      presenter,
      command: "create",
      profile: createProfile(),
      baseUrl: "https://gateway.openmeld.invalid",
      resolvedView: "human",
    });

    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.create.preflight",
      text: "Quick check before create: signed in, profile preflight-agent. OpenMeld Service is not required to create a Space.",
    });
    expect(getAuthSessionState).toHaveBeenCalledWith({
      validateRemote: false,
    });
    expect(resolveCurrentReplyReadinessSnapshotMock).not.toHaveBeenCalled();
  });

  it("surfaces auth environment mismatch in human preflight summary", async () => {
    vi.mocked(getAuthSessionState).mockResolvedValue(
      createAuthState("valid", "http://localhost:8788")
    );
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
      createReplyReadinessSnapshot()
    );
    const presenter = createPresenter();

    await emitSpaceCommandPreflight({
      presenter,
      command: "create",
      profile: createProfile(),
      baseUrl: "https://gateway.openmeld.invalid",
      resolvedView: "human",
    });

    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.create.preflight",
      text: "Quick check before create: signed in to another OpenMeld environment (http://localhost:8788), not this gateway, profile preflight-agent. OpenMeld Service is not required to create a Space.",
    });
    expect(resolveCurrentReplyReadinessSnapshotMock).not.toHaveBeenCalled();
  });

  it("emits join quick-check card for human view", async () => {
    vi.mocked(getAuthSessionState).mockResolvedValue(createAuthState("valid"));
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
      createReplyReadinessSnapshot()
    );
    const presenter = createPresenter();

    await emitSpaceCommandPreflight({
      presenter,
      command: "join",
      profile: createProfile(),
      baseUrl: "https://gateway.openmeld.invalid",
      resolvedView: "human",
    });

    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.join.preflight.card.top",
        text: expect.stringContaining("🔎 Join Quick Check"),
      })
    );
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.join.preflight.card.row",
        text: expect.stringContaining("✅ Auth: signed in"),
      })
    );
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.join.preflight.card.row",
        text: expect.stringContaining("👤 Profile: preflight-agent"),
      })
    );
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.join.preflight.card.row",
        text: expect.stringContaining(
          "🧩 Local Service Link: ✅ Running — OpenMeld Service is running and the local service link is available on this device"
        ),
      })
    );
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.join.preflight.card.row",
        text: expect.stringContaining("⚙️ OpenMeld Service Runtime: 🟢 Running"),
      })
    );
    const visibleOutput = presenter.line.mock.calls
      .map(([line]) => line.text)
      .join("\n");
    expect(visibleOutput).not.toContain("Current Agent Reply Readiness");
    expect(visibleOutput).not.toContain("agent reply readiness");
  });

  it("shows stale service runtime in join quick-check", async () => {
    vi.mocked(getAuthSessionState).mockResolvedValue(createAuthState("valid"));
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
      createReplyReadinessSnapshot({
        runtimeStatus: createDaemonRuntimeStatus("stale"),
        displayRuntimeStatus: createDaemonRuntimeStatus("stale"),
        deviceReplyReadiness: {
          reasonCodes: ["service.not_running"],
          reasonText: "OpenMeld Service is not currently ready on this device",
          updatedAt: "2026-03-01T00:00:00.000Z",
          replyReadiness: "degraded",
          wakeableRouteCount: 0,
        },
        agentReplyReadiness: createAgentReplyReadiness({
          deviceReplyReadiness: {
            reasonCodes: ["service.not_running"],
            reasonText:
              "OpenMeld Service is not currently ready on this device",
            updatedAt: "2026-03-01T00:00:00.000Z",
            replyReadiness: "degraded",
            wakeableRouteCount: 0,
          },
          reasonCodes: ["service.not_running"],
          reasonText: "OpenMeld Service is not currently ready on this device",
          replyReadiness: "degraded",
        }),
      })
    );
    const presenter = createPresenter();

    await emitSpaceCommandPreflight({
      presenter,
      command: "join",
      profile: createProfile(),
      baseUrl: "https://gateway.openmeld.invalid",
      resolvedView: "human",
    });

    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.join.preflight.card.row",
        text: expect.stringContaining(
          "🧩 Local Service Link: ⛔ Not running — OpenMeld Service is not currently ready on this device"
        ),
      })
    );
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.join.preflight.card.row",
        text: expect.stringContaining(
          "⚙️ OpenMeld Service Runtime: 🟠 Reconnecting"
        ),
      })
    );
    const visibleOutput = presenter.line.mock.calls
      .map(([line]) => line.text)
      .join("\n");
    expect(visibleOutput).not.toContain("Current Agent Reply Readiness");
    expect(visibleOutput).not.toContain("agent reply readiness");
  });

  it("does not block send preflight on local service drift", async () => {
    vi.mocked(getAuthSessionState).mockResolvedValue(createAuthState("valid"));
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
      createReplyReadinessSnapshot({
        deviceReplyReadiness: {
          reasonCodes: ["service.drifted"],
          reasonText:
            "OpenMeld Service artifact drift was detected on this device",
          updatedAt: "2026-03-01T00:00:00.000Z",
          replyReadiness: "blocked",
          wakeableRouteCount: 0,
        },
        agentReplyReadiness: createAgentReplyReadiness({
          deviceReplyReadiness: {
            reasonCodes: ["service.drifted"],
            reasonText:
              "OpenMeld Service artifact drift was detected on this device",
            updatedAt: "2026-03-01T00:00:00.000Z",
            replyReadiness: "blocked",
            wakeableRouteCount: 0,
          },
          reasonCodes: ["service.drifted"],
          reasonText:
            "OpenMeld Service artifact drift was detected on this device",
          replyReadiness: "blocked",
        }),
      })
    );
    const presenter = createPresenter();

    await emitSpaceCommandPreflight({
      presenter,
      command: "send",
      profile: createProfile(),
      baseUrl: "https://gateway.openmeld.invalid",
      resolvedView: "human",
    });

    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.send.preflight",
        text: "Quick check before send: signed in, profile preflight-agent. OpenMeld Service is not required to send a Space message.",
      })
    );
    expect(presenter.line).not.toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.send.preflight.next_step",
      })
    );
    expect(resolveCurrentReplyReadinessSnapshotMock).not.toHaveBeenCalled();
  });

  it("does not show Wake storage repair guidance as a send preflight blocker", async () => {
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
      createReplyReadinessSnapshot({
        deviceReplyReadiness: {
          reasonCodes: ["dispatch.storage_not_ready"],
          reasonText:
            "Core dispatch storage is not ready for wake execution yet.",
          updatedAt: "2026-03-01T00:00:00.000Z",
          replyReadiness: "blocked",
          wakeableRouteCount: 0,
        },
        agentReplyReadiness: createAgentReplyReadiness({
          deviceReplyReadiness: {
            reasonCodes: ["dispatch.storage_not_ready"],
            reasonText:
              "Core dispatch storage is not ready for wake execution yet.",
            updatedAt: "2026-03-01T00:00:00.000Z",
            replyReadiness: "blocked",
            wakeableRouteCount: 0,
          },
          reasonCodes: ["dispatch.storage_not_ready"],
          reasonText:
            "Core dispatch storage is not ready for wake execution yet.",
          replyReadiness: "blocked",
        }),
      })
    );
    vi.mocked(getAuthSessionState).mockResolvedValue(createAuthState("valid"));
    const presenter = createPresenter();

    await emitSpaceCommandPreflight({
      presenter,
      command: "send",
      profile: createProfile(),
      baseUrl: "https://gateway.openmeld.invalid",
      resolvedView: "human",
    });

    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.send.preflight",
        text: "Quick check before send: signed in, profile preflight-agent. OpenMeld Service is not required to send a Space message.",
      })
    );
    expect(presenter.line).not.toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.send.preflight.next_step",
      })
    );
    expect(resolveCurrentReplyReadinessSnapshotMock).not.toHaveBeenCalled();
  });

  it("emits dev-local restart guidance for missing local gateway auth sessions", () => {
    vi.stubEnv("OPENMELD_ENV_PRESET", "dev-local");
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "join",
      error: new Error(
        'HTTP 502: {"ok":false,"error":{"code":"upstream_unreachable","message":"Cannot access \\"resolveRequestAuth\\" as we couldn\'t find a local dev session for the \\"GatewayAuthRpcEntrypoint\\" entrypoint of service \\"openmeld-auth\\" to proxy to."}}'
      ),
    });

    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.join.next_step",
      text: "Next step: Run `pnpm dev:stop`, then `pnpm dev`, then `openmeld doctor --repair`, then retry.",
      data: {
        reason: "local_dev_session_missing",
        steps: ["pnpm dev:stop", "pnpm dev", "openmeld doctor --repair"],
      },
    });
  });

  it("does not misclassify generic gateway outages as local OpenMeld Service refresh", () => {
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "join",
      error: new Error("gateway is unreachable"),
    });

    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.join.next_step",
      text: "Next step: OpenMeld Cloud service is temporarily unavailable. Try again after OpenMeld is reachable.",
      data: {
        reason: "service_unavailable",
        steps: [],
      },
    });
  });

  it("emits executable next step when auth is required", () => {
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "join",
      error: new Error("HTTP 401: auth.unauthenticated"),
    });

    const loginCommand = formatOpenMeldCliCommand("openmeld login");
    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.join.next_step",
      text: `Next step: Run \`${loginCommand}\` to continue.`,
      data: {
        reason: "auth_required",
        steps: formatOpenMeldCliCommands([
          "openmeld login",
          "openmeld auth status --view agent",
        ]),
      },
    });
  });

  it("switches auth guidance to npx commands under npm exec", () => {
    vi.stubEnv("npm_command", "exec");
    vi.stubEnv("npm_lifecycle_script", '"openmeld"');
    vi.stubEnv(
      "npm_config_user_agent",
      "npm/11.6.2 node/v25.1.0 darwin arm64 workspaces/false"
    );
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "join",
      error: new Error("HTTP 401: auth.unauthenticated"),
    });

    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.join.next_step",
      text: "Next step: Run `npx -y openmeld@latest login` to continue.",
      data: {
        reason: "auth_required",
        steps: [
          "npx -y openmeld@latest login",
          "npx -y openmeld@latest auth status --view agent",
        ],
      },
    });
  });

  it("emits lock guidance when local join lock blocks the command", () => {
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "join",
      error: new OpenMeldLockError({
        path: "/tmp/space-join.lock",
        key: "localhost_8080__space-id__profile-id",
        metaRaw:
          '{"pid":20012,"profile":"profile-id","sessionId":"terminal-ppid-69862","at":"2026-03-04T09:36:28.619Z"}',
      }),
    });

    const retryJoinCommand = formatOpenMeldCliCommand(
      "openmeld space join <space-id>"
    );
    const repairCommand = formatOpenMeldCliCommand("openmeld doctor --repair");
    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.join.next_step",
      text: "Next step: This profile has already joined this space.",
      data: {
        reason: "space_join_locked",
        steps: [
          `Stop the other terminal session running \`${formatOpenMeldCliCommand("openmeld space join")}\`.`,
          retryJoinCommand,
          repairCommand,
        ],
      },
    });
  });

  it("emits repair guidance when an orphaned legacy join lock blocks the command", () => {
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "join",
      error: new OpenMeldLockError({
        path: "/tmp/space-join.lock",
        key: "localhost_8080__space-id__profile-id",
        metaRaw:
          '{"pid":20012,"profile":"profile-id","sessionId":"terminal-ppid-69862","at":"2026-03-04T09:36:28.619Z"}',
        contentionState: "orphaned",
      }),
    });

    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.join.next_step",
      text: "Next step: OpenMeld found a local command lock left by an older version.",
      data: {
        reason: "space_join_locked",
        steps: [
          "Close any other OpenMeld commands, then run `openmeld repair local-state` and try again.",
        ],
      },
    });
  });

  it("emits password guidance when password is required", () => {
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "join",
      error: new Error(
        'HTTP 401: {"ok":false,"error":{"code":"space.password_required","message":"space password required"}}'
      ),
    });

    const expectedCommands = formatOpenMeldCliCommands([
      "openmeld whoami",
      "openmeld space list",
      "openmeld space join <space-id> --password <value>",
    ]);
    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.join.next_step",
      text: "Next step: this OpenMeld account has not joined this protected Space yet; join once with the Space password or switch to a profile that has access.",
      data: {
        reason: "space_password_required",
        steps: expectedCommands,
      },
    });
  });

  it("emits password guidance when gateway wraps required error as upstream_error", () => {
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "join",
      error: new Error(
        'HTTP 401: {"ok":false,"error":{"code":"upstream_error","message":"space password required"}}'
      ),
    });

    const expectedCommands = formatOpenMeldCliCommands([
      "openmeld whoami",
      "openmeld space list",
      "openmeld space join <space-id> --password <value>",
    ]);
    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.join.next_step",
      text: "Next step: this OpenMeld account has not joined this protected Space yet; join once with the Space password or switch to a profile that has access.",
      data: {
        reason: "space_password_required",
        steps: expectedCommands,
      },
    });
  });

  it("emits password guidance when password is invalid", () => {
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "send",
      error: new Error(
        'HTTP 403: {"ok":false,"error":{"code":"space.password_invalid","message":"space password invalid"}}'
      ),
    });

    const expectedCommands = formatOpenMeldCliCommands([
      "openmeld whoami",
      "openmeld space list",
      "openmeld space join <space-id> --password <value>",
    ]);
    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.send.next_step",
      text: "Next step: the provided Space password is invalid; confirm it or ask a Space member to add this profile.",
      data: {
        reason: "space_password_invalid",
        steps: expectedCommands,
      },
    });
  });

  it("emits password guidance when gateway wraps invalid error as upstream_error", () => {
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "send",
      error: new Error(
        'HTTP 403: {"ok":false,"error":{"code":"upstream_error","message":"space password invalid"}}'
      ),
    });

    const expectedCommands = formatOpenMeldCliCommands([
      "openmeld whoami",
      "openmeld space list",
      "openmeld space join <space-id> --password <value>",
    ]);
    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.send.next_step",
      text: "Next step: the provided Space password is invalid; confirm it or ask a Space member to add this profile.",
      data: {
        reason: "space_password_invalid",
        steps: expectedCommands,
      },
    });
  });

  it("emits password guidance when password is too short", () => {
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "create",
      error: new Error(
        'HTTP 400: {"ok":false,"error":{"code":"space.password_too_short","message":"password too short"}}'
      ),
    });

    const expectedCommands = formatOpenMeldCliCommands([
      "openmeld space list",
      "openmeld space create --name <name> --visibility <public|private> --password <value>",
      "openmeld space password <space-id> --password <new-password>",
    ]);
    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.create.next_step",
      text: "Next step: password must be at least 6 characters.",
      data: {
        reason: "space_password_too_short",
        steps: expectedCommands,
      },
    });
  });

  it("keeps password-too-short next steps profile-aware in agent view", () => {
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "create",
      error: new Error(
        'HTTP 400: {"ok":false,"error":{"code":"space.password_too_short","message":"password too short"}}'
      ),
      profileId: "agt-demo",
      resolvedView: "agent",
    });

    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.create.next_step",
      text: "Next step: password must be at least 6 characters.",
      data: {
        reason: "space_password_too_short",
        steps: [
          "openmeld space list --profile agt-demo --view agent",
          "openmeld space create --profile agt-demo --name <name> --visibility <public|private> --password <value> --view agent",
          "openmeld space password --profile agt-demo <space-id> --password <new-password> --view agent",
        ],
      },
    });
  });

  it("tells agents to verify text history before retrying a timed-out send", () => {
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "send",
      error: Object.assign(
        new Error("space.send request timed out after 30000ms"),
        {
          code: "network.timeout",
        }
      ),
    });

    const historyCommand = formatOpenMeldCliCommand(
      "openmeld space history <space-id> --kind text --limit 20 --view agent"
    );
    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.send.next_step",
      text: "Next step: the send request timed out before OpenMeld could confirm the result. Check recent text history before retrying so you do not duplicate a message.",
      data: {
        reason: "space_send_timeout_uncertain",
        steps: [historyCommand],
      },
    });
  });

  it("emits executable next step when binding store is unavailable via structured upstreamCode", () => {
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "send",
      error: new GatewayHttpError({
        code: "upstream_error",
        message: "binding lookup failed",
        rawBody:
          '{"ok":false,"error":{"code":"upstream_error","message":"binding lookup failed","upstreamCode":"controller.binding.lookup_failed"}}',
        status: 503,
        upstreamCode: "controller.binding.lookup_failed",
      }),
    });

    const repairCommand = formatOpenMeldCliCommand("openmeld doctor --repair");
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.send.next_step",
        text: `Next step: run \`pnpm db:migrate:dev\`, then \`${repairCommand}\`, then retry.`,
        data: {
          reason: "binding_store_unavailable",
          steps: ["pnpm db:migrate:dev", repairCommand],
        },
      })
    );
  });

  it("emits executable next step when binding store is unavailable via structured local error code", () => {
    const presenter = createPresenter();

    emitSpaceFailureNextStep({
      presenter,
      command: "send",
      error: Object.assign(new Error("binding lookup failed"), {
        code: "controller.binding.lookup_failed",
      }),
    });

    const repairCommand = formatOpenMeldCliCommand("openmeld doctor --repair");
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.send.next_step",
        text: `Next step: run \`pnpm db:migrate:dev\`, then \`${repairCommand}\`, then retry.`,
        data: {
          reason: "binding_store_unavailable",
          steps: ["pnpm db:migrate:dev", repairCommand],
        },
      })
    );
  });
});
