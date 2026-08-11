import { setupPlanAgentViewPayloadSchema } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  assertProjectBindingProducerCompatibleMock,
  resolveCurrentReplyReadinessSnapshotMock,
  syncDeviceRuntimeStateProjectionMock,
  syncProfileWorkspaceStateMock,
} = vi.hoisted(() => ({
  assertProjectBindingProducerCompatibleMock: vi.fn(),
  resolveCurrentReplyReadinessSnapshotMock: vi.fn(),
  syncDeviceRuntimeStateProjectionMock: vi.fn(),
  syncProfileWorkspaceStateMock: vi.fn(),
}));

import { runDoctor } from "../src/commands/doctor";
import { runInit } from "../src/commands/init";
import { setAuthSession } from "../src/config/auth-session";
import { writeDaemonRuntimeLease } from "../src/config/daemon-runtime-lease";
import {
  DAEMON_SERVICE_RUNTIME_STATE_SCHEMA,
  setDaemonServiceRuntimeState,
} from "../src/config/daemon-state";
import { requireOpenMeldProfile } from "../src/config/resolve-openmeld-profile";
import {
  recordRuntimeReportingFailure,
  recordRuntimeReportingSuccess,
} from "../src/local-service/state/runtime-reporting-health-state";
import type { CurrentReplyReadinessSnapshot } from "../src/system/current-reply-readiness-snapshot";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const TEST_REPORTING_SERVICE_IDENTITY = {
  contractGeneration: 1,
  deviceId: "device-doctor-test",
} as const;

function createReplyReadinessSnapshot(
  overrides: Partial<CurrentReplyReadinessSnapshot> = {}
): CurrentReplyReadinessSnapshot {
  return {
    daemonRouteObservation: {
      detail: "No OpenMeld profile was selected for a reply route lookup.",
      observedAt: "2026-04-14T12:00:00.000Z",
      profileId: null,
      reasonCode: "profile_not_selected",
      route: null,
      status: "unavailable",
    },
    observedAt: "2026-04-14T12:00:00.000Z",
    daemonStatus: {
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.2.9",
        installSource: "daemon.command.install",
        installedAt: "2026-04-14T12:00:00.000Z",
        updatedAt: "2026-04-14T12:00:00.000Z",
      },
    },
    inventory: null,
    runtimeProjection: null,
    runtimeStatus: null,
    displayRuntimeStatus: null,
    serviceManagerStatus: null,
    gatewayChainReadiness: null,
    deviceReplyReadiness: {
      reasonCodes: [],
      reasonText: "",
      replyReadiness: "ready",
      updatedAt: "2026-04-14T12:00:00.000Z",
      wakeableRouteCount: 1,
    },
    agentReplyReadiness: null,
    openClawLocalDiagnostics: null,
    profileWorkspaceRuntimeResolution: null,
    ...overrides,
  };
}

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const profile = {
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    profileName: "Mira",
    profileKind: "human",
    status: "active",
    ownerUserId: "user-1",
    source: "cli_create",
    createdByUserId: "user-1",
    lastUsedAt: null,
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  } as const;
  return {
    requireOpenMeldProfile: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) => ({
        ...profile,
        openMeldProfileId: String(
          openMeldProfileId ?? profile.openMeldProfileId
        ),
      })
    ),
    isSelectedOpenMeldProfileRequiredError: vi.fn(
      (error: unknown) =>
        error instanceof Error &&
        error.message ===
          "no OpenMeld profile is selected for this terminal session yet; run `openmeld start` to choose one, or pass `--profile <id>`."
    ),
    resolveOpenMeldProfileOrNull: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) => ({
        ...profile,
        openMeldProfileId: String(
          openMeldProfileId ?? profile.openMeldProfileId
        ),
      })
    ),
  };
});

vi.mock("../src/agent-activity/project-binding-producer-gate", async () => {
  const actual = await vi.importActual<
    typeof import("../src/agent-activity/project-binding-producer-gate")
  >("../src/agent-activity/project-binding-producer-gate");
  return {
    ...actual,
    assertProjectBindingProducerCompatible: (
      ...args: Parameters<typeof assertProjectBindingProducerCompatibleMock>
    ) => assertProjectBindingProducerCompatibleMock(...args),
  };
});

vi.mock(
  "../src/local-service/reporting/device-runtime-state-sync",
  async () => {
    const actual = await vi.importActual<
      typeof import("../src/local-service/reporting/device-runtime-state-sync")
    >("../src/local-service/reporting/device-runtime-state-sync");
    return {
      ...actual,
      syncDeviceRuntimeStateProjection: (
        ...args: Parameters<typeof syncDeviceRuntimeStateProjectionMock>
      ) => syncDeviceRuntimeStateProjectionMock(...args),
    };
  }
);

vi.mock("../src/system/profile-workspace-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/system/profile-workspace-state")
  >("../src/system/profile-workspace-state");
  return {
    ...actual,
    syncProfileWorkspaceState: (
      ...args: Parameters<typeof syncProfileWorkspaceStateMock>
    ) => syncProfileWorkspaceStateMock(...args),
  };
});

vi.mock("../src/system/current-reply-readiness-snapshot", async () => {
  const actual = await vi.importActual<
    typeof import("../src/system/current-reply-readiness-snapshot")
  >("../src/system/current-reply-readiness-snapshot");
  return {
    ...actual,
    resolveCurrentReplyReadinessSnapshot: (
      ...args: Parameters<typeof resolveCurrentReplyReadinessSnapshotMock>
    ) => resolveCurrentReplyReadinessSnapshotMock(...args),
  };
});

describe("doctor view mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
    );
    assertProjectBindingProducerCompatibleMock.mockReset();
    resolveCurrentReplyReadinessSnapshotMock.mockReset();
    syncDeviceRuntimeStateProjectionMock.mockReset();
    syncProfileWorkspaceStateMock.mockReset();
  });

  it("emits structured line events in agent view", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-mira",
          email: "mira@openmeld.invalid",
          name: "Mira",
        },
      });
      syncDeviceRuntimeStateProjectionMock.mockResolvedValue({
        status: "ok",
        mode: "check",
        projectedControllerIds: [],
        missingControllerIds: [],
        disabledControllerIds: [],
        repairedControllerIds: [],
        reason: "local projection is healthy",
      });
      syncProfileWorkspaceStateMock.mockResolvedValue({
        invalidWorkspaceProfileIds: [],
        migratedProfileIds: [],
        missingWorkspaceProfileIds: [],
        mode: "check",
        projectedProfileIds: [],
        provisionedProfileIds: [],
        reason: "projected agent profile workspaces look good",
        status: "ok",
      });
      await runInit({
        profile: "11111111-1111-4111-8111-111111111111",
        profileId: "aaaaaaaa-0000-0000-0000-000000000000",
        profileName: "Mira",
        kind: "human",
        silent: true,
      });
      const runtimeNow = new Date().toISOString();
      await setDaemonServiceRuntimeState({
        autoStart: false,
        command: "node openmeld service run --mode foreground",
        gatewayUrl: "https://gateway.openmeld.invalid",
        heartbeatAt: runtimeNow,
        managedBySystemService: false,
        mode: "foreground",
        pid: process.pid,
        schema: DAEMON_SERVICE_RUNTIME_STATE_SCHEMA,
        serviceController: "legacy-detached",
        startedAt: runtimeNow,
        status: "running",
        stopRequestedAt: null,
        updatedAt: runtimeNow,
        v: 1,
        openMeldProfileId: null,
      });
      await writeDaemonRuntimeLease({
        bundleId: "doctor-reporting-health-test",
        generation: 1,
        heartbeatAt: runtimeNow,
        managedBySystemService: false,
        mode: "foreground",
        pid: process.pid,
        schema: "openmeld-daemon-runtime-lease-v1",
        serviceController: "legacy-detached",
        startedAt: runtimeNow,
        updatedAt: runtimeNow,
        v: 1,
      });
      await recordRuntimeReportingSuccess({
        channel: "runtimeAgentController",
        at: runtimeNow,
        serviceIdentity: TEST_REPORTING_SERVICE_IDENTITY,
      });
      await recordRuntimeReportingSuccess({
        channel: "providerConversationProof",
        at: runtimeNow,
        serviceIdentity: TEST_REPORTING_SERVICE_IDENTITY,
      });

      vi.spyOn(globalThis, "fetch").mockImplementation(
        (input: string | URL | Request) => {
          const url = String(input);
          if (url.includes("/api/auth/get-session")) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  session: { expires: "2026-12-31T00:00:00.000Z" },
                  user: { id: "user-mira", email: "mira@openmeld.invalid" },
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }
              )
            );
          }
          if (url.includes("/v1/diagnostics/chain")) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  service: "openmeld-gateway",
                  auth: { service: "openmeld-auth" },
                  core: { service: "openmeld-core" },
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }
              )
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ service: "openmeld-gateway" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runDoctor({
          profile: "11111111-1111-4111-8111-111111111111",
          baseUrl: "https://gateway.openmeld.invalid",
          view: "agent",
        });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));

      const setupPlan = lines.find((line) => line.code === "setup.plan");
      expect(setupPlan).toBeDefined();
      const parsedSetupPlan = setupPlanAgentViewPayloadSchema.safeParse(
        setupPlan?.payload
      );
      expect(parsedSetupPlan.success).toBe(true);
      if (!parsedSetupPlan.success) {
        return;
      }
      expect(parsedSetupPlan.data.readOnly).toBe(true);
      expect(parsedSetupPlan.data.facts.auth).toMatchObject({
        signedIn: true,
        actingProfileId: "11111111-1111-4111-8111-111111111111",
      });
      expect(lines.length).toBeGreaterThanOrEqual(6);
      expect(lines.some((line) => line.code === "doctor.check.ok")).toBe(true);
      expect(
        lines.find((line) => line.data?.label === "runtime-reporting-health")
      ).toMatchObject({
        code: "doctor.check.ok",
        text: expect.stringContaining("Local agent reporting is healthy"),
      });
      expect(
        lines.find((line) => line.data?.label === "project-binding-store")
      ).toMatchObject({
        code: "doctor.check.ok",
        data: { migrationStatus: "missing" },
        text: expect.stringContaining("local Project connection store"),
      });
      expect(lines.some((item) => item.text?.includes("ok gateway URL"))).toBe(
        true
      );
      expect(
        lines.some((item) => item.text?.includes("ok gateway chain"))
      ).toBe(true);
      expect(
        lines.some(
          (item) =>
            String(item.text).includes("OpenMeld setup looks good") ||
            String(item.text).includes("OpenMeld setup could not be checked")
        )
      ).toBe(true);
      expect(lines.some((item) => String(item.text).includes("->"))).toBe(
        false
      );

      for (let failureIndex = 0; failureIndex < 3; failureIndex += 1) {
        await recordRuntimeReportingFailure({
          channel: "runtimeAgentController",
          message: "authentication required",
          reasonCode: "runtime.reporting.authentication_required",
          serviceIdentity: TEST_REPORTING_SERVICE_IDENTITY,
        });
      }
      const degradedOutput = await withCapturedStdio(async () => {
        await runDoctor({
          profile: "11111111-1111-4111-8111-111111111111",
          baseUrl: "https://gateway.openmeld.invalid",
          view: "agent",
        });
      });
      const degradedLines = degradedOutput.stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
      expect(
        degradedLines.some(
          (line) =>
            line.code === "doctor.check.warn" &&
            line.data?.label === "runtime-reporting-health" &&
            String(line.text).includes(
              "Local agent version and status data may not be syncing to OpenMeld"
            ) &&
            String(line.text).includes("Runtime agent controller reporting") &&
            String(line.text).includes("last error: authentication required") &&
            line.data?.runtimeAgentController?.lastFailureReasonCode ===
              "runtime.reporting.authentication_required" &&
            line.data?.runtimeAgentController?.consecutiveFailures === 3 &&
            line.data?.providerConversationProof?.consecutiveFailures === 0
        )
      ).toBe(true);
    });
  });

  it("throws dual-view guide summary when checks fail in agent view", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-2",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-mira",
          email: "mira@openmeld.invalid",
          name: "Mira",
        },
      });
      syncDeviceRuntimeStateProjectionMock.mockResolvedValueOnce({
        status: "ok",
        mode: "check",
        projectedControllerIds: [],
        missingControllerIds: [],
        disabledControllerIds: [],
        repairedControllerIds: [],
        reason: "local projection is healthy",
      });
      syncProfileWorkspaceStateMock.mockResolvedValueOnce({
        invalidWorkspaceProfileIds: [],
        migratedProfileIds: [],
        missingWorkspaceProfileIds: [],
        mode: "check",
        projectedProfileIds: [],
        provisionedProfileIds: [],
        reason: "projected agent profile workspaces look good",
        status: "ok",
      });
      await runInit({
        profile: "11111111-1111-4111-8111-111111111111",
        profileId: "aaaaaaaa-0000-0000-0000-000000000000",
        profileName: "Mira",
        kind: "human",
        silent: true,
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/api/auth/get-session")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                session: { expires: "2026-12-31T00:00:00.000Z" },
                user: { id: "user-mira", email: "mira@openmeld.invalid" },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return Promise.resolve(
          new Response("gateway error", {
            status: 503,
          })
        );
      });

      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runDoctor({
            profile: "11111111-1111-4111-8111-111111111111",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "agent",
          });
        } catch (error) {
          thrown = error;
        }
      });

      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain(
        "openmeld doctor detected one or more failed checks."
      );
      expect(message).toContain("[FOR HUMAN OPERATORS]");
      expect(message).toContain("[FOR AGENTS]");

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
      expect(lines.some((line) => line.code === "doctor.check.fail")).toBe(
        true
      );
    });
  });

  it("reports gateway chain failure details in agent view", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-3",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-mira",
          email: "mira@openmeld.invalid",
          name: "Mira",
        },
      });
      syncDeviceRuntimeStateProjectionMock.mockResolvedValueOnce({
        status: "ok",
        mode: "check",
        projectedControllerIds: [],
        missingControllerIds: [],
        disabledControllerIds: [],
        repairedControllerIds: [],
        reason: "local projection is healthy",
      });
      syncProfileWorkspaceStateMock.mockResolvedValueOnce({
        invalidWorkspaceProfileIds: [],
        migratedProfileIds: [],
        missingWorkspaceProfileIds: [],
        mode: "check",
        projectedProfileIds: [],
        provisionedProfileIds: [],
        reason: "projected agent profile workspaces look good",
        status: "ok",
      });
      await runInit({
        profile: "11111111-1111-4111-8111-111111111111",
        profileId: "aaaaaaaa-0000-0000-0000-000000000000",
        profileName: "Mira",
        kind: "human",
        silent: true,
      });

      vi.spyOn(globalThis, "fetch").mockImplementation(
        (input: string | URL | Request) => {
          const url = String(input);
          if (url.includes("/api/auth/get-session")) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  session: { expires: "2026-12-31T00:00:00.000Z" },
                  user: { id: "user-mira", email: "mira@openmeld.invalid" },
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }
              )
            );
          }
          if (url.includes("/v1/diagnostics/chain")) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  ok: false,
                  error: {
                    code: "upstream_unreachable",
                    message:
                      "Cannot access core ping: couldn't find a local dev session",
                  },
                }),
                {
                  status: 502,
                  headers: { "content-type": "application/json" },
                }
              )
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ service: "openmeld-gateway" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
      );

      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runDoctor({
            profile: "11111111-1111-4111-8111-111111111111",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "agent",
          });
        } catch (error) {
          thrown = error;
        }
      });

      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain(
        "openmeld doctor detected one or more failed checks."
      );

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
      expect(lines.some((line) => line.code === "doctor.check.fail")).toBe(
        true
      );
      expect(
        lines.some((line) =>
          String(line.text).includes(
            "upstream_unreachable: Cannot access core ping"
          )
        )
      ).toBe(true);
    });
  });

  it("warns about remote OpenMeld checks when agent view is not signed in", async () => {
    await withTempHome(async () => {
      syncDeviceRuntimeStateProjectionMock.mockResolvedValueOnce({
        status: "skipped",
        mode: "check",
        projectedControllerIds: [],
        missingControllerIds: [],
        disabledControllerIds: [],
        repairedControllerIds: [],
        reason: "authentication is not valid",
      });
      syncProfileWorkspaceStateMock.mockResolvedValueOnce({
        invalidWorkspaceProfileIds: [],
        migratedProfileIds: [],
        missingWorkspaceProfileIds: [],
        mode: "check",
        projectedProfileIds: [],
        provisionedProfileIds: [],
        reason: "projected agent profile workspaces look good",
        status: "ok",
      });
      await runInit({
        profile: "11111111-1111-4111-8111-111111111111",
        profileId: "aaaaaaaa-0000-0000-0000-000000000000",
        profileName: "Mira",
        kind: "human",
        silent: true,
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ service: "openmeld-gateway" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runDoctor({
          profile: "11111111-1111-4111-8111-111111111111",
          baseUrl: "https://gateway.openmeld.invalid",
          view: "agent",
        });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
      expect(lines.some((line) => line.code === "doctor.check.warn")).toBe(
        true
      );
      expect(
        lines.some((line) =>
          String(line.text).includes("sign in to check your OpenMeld profile")
        )
      ).toBe(true);
      expect(
        lines.some((line) =>
          String(line.text).includes(
            "Gateway chain checks were skipped because sign-in is required."
          )
        )
      ).toBe(true);
    });
  });

  it("uses unified workspace terms in doctor output", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-workspace-doctor",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-mira",
          email: "mira@openmeld.invalid",
          name: "Mira",
        },
      });
      syncDeviceRuntimeStateProjectionMock.mockResolvedValueOnce({
        status: "ok",
        mode: "repair",
        projectedControllerIds: [],
        missingControllerIds: [],
        disabledControllerIds: [],
        repairedControllerIds: [],
        reason: "local projection is healthy",
      });
      syncProfileWorkspaceStateMock.mockResolvedValueOnce({
        invalidWorkspaceProfileIds: ["agt_invalid"],
        migratedProfileIds: ["agt_invalid"],
        missingWorkspaceProfileIds: ["agt_missing"],
        mode: "repair",
        projectedProfileIds: ["agt_missing", "agt_invalid"],
        provisionedProfileIds: ["agt_missing"],
        reason: "one or more projected profile workspaces need attention",
        status: "degraded",
      });
      await runInit({
        profile: "11111111-1111-4111-8111-111111111111",
        profileId: "aaaaaaaa-0000-0000-0000-000000000000",
        profileName: "Mira",
        kind: "human",
        silent: true,
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ service: "openmeld-gateway" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runDoctor({
            profile: "11111111-1111-4111-8111-111111111111",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "agent",
            repair: true,
          });
        } catch (error) {
          thrown = error;
        }
      });

      expect(thrown).toBeInstanceOf(Error);
      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));

      expect(
        lines.some((line) =>
          String(line.text).includes(
            "This device is missing local workspace files"
          )
        )
      ).toBe(true);
      expect(
        lines.some((line) =>
          String(line.text).includes("This device has broken local workspace")
        )
      ).toBe(true);
      expect(
        lines.some((line) =>
          String(line.text).includes(
            "Repair refreshed older local workspace config"
          )
        )
      ).toBe(true);
      expect(
        lines.some((line) =>
          String(line.text).includes("Repair created local workspace files")
        )
      ).toBe(true);
      expect(lines.some((line) => line.code === "setup.plan")).toBe(false);
    });
  });

  it("shows selected-profile-missing as info instead of failure in human view", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-4",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-mira",
          email: "mira@openmeld.invalid",
          name: "Mira",
        },
      });
      syncDeviceRuntimeStateProjectionMock.mockResolvedValueOnce({
        status: "ok",
        mode: "check",
        projectedControllerIds: [],
        missingControllerIds: [],
        disabledControllerIds: [],
        repairedControllerIds: [],
        reason: "local projection is healthy",
      });
      syncProfileWorkspaceStateMock.mockResolvedValueOnce({
        invalidWorkspaceProfileIds: [],
        migratedProfileIds: [],
        missingWorkspaceProfileIds: [],
        mode: "check",
        projectedProfileIds: [],
        provisionedProfileIds: [],
        reason: "projected agent profile workspaces look good",
        status: "ok",
      });

      const { requireOpenMeldProfile } = await import(
        "../src/config/resolve-openmeld-profile"
      );
      vi.mocked(requireOpenMeldProfile).mockRejectedValueOnce(
        new Error(
          "no OpenMeld profile is selected for this terminal session yet; run `openmeld start` to choose one, or pass `--profile <id>`."
        )
      );

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/api/auth/get-session")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                session: { expires: "2026-12-31T00:00:00.000Z" },
                user: { id: "user-mira", email: "mira@openmeld.invalid" },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ service: "openmeld-gateway" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runDoctor({
          baseUrl: "https://gateway.openmeld.invalid",
          view: "human",
        });
      });

      expect(stdout).toContain(
        "ℹ️ No OpenMeld profile is selected for this terminal yet. Profile-specific checks were skipped."
      );
      expect(stdout).toContain(
        "ℹ️ Gateway chain checks were skipped because no OpenMeld profile is selected for this terminal yet."
      );
      expect(stdout).not.toContain("❌ openmeld-profile failed");
      expect(stdout).not.toContain("OpenMeld diagnostics found issues.");
    });
  });

  it("reports selected agent profile route issues in doctor output", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-route",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-mira",
          email: "mira@openmeld.invalid",
          name: "Mira",
        },
      });
      syncDeviceRuntimeStateProjectionMock.mockResolvedValueOnce({
        status: "ok",
        mode: "check",
        projectedControllerIds: [],
        missingControllerIds: [],
        disabledControllerIds: [],
        repairedControllerIds: [],
        reason: "local projection is healthy",
      });
      syncProfileWorkspaceStateMock.mockResolvedValueOnce({
        invalidWorkspaceProfileIds: [],
        migratedProfileIds: [],
        missingWorkspaceProfileIds: [],
        mode: "check",
        projectedProfileIds: [],
        provisionedProfileIds: [],
        reason: "projected agent profile workspaces look good",
        status: "ok",
      });
      vi.mocked(requireOpenMeldProfile).mockResolvedValueOnce({
        openMeldProfileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        profileName: "Route Bot",
        profileHandle: "route-bot",
        profileKind: "agent",
        status: "active",
        ownerUserId: "user-mira",
        source: "cli_create",
        createdByUserId: "user-mira",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValueOnce(
        createReplyReadinessSnapshot({
          agentReplyReadiness: null,
          daemonRouteObservation: {
            detail:
              "OpenMeld server can't currently see an active reply route for this profile (server reported daemon.profile.offline).",
            observedAt: "2026-04-14T12:00:00.000Z",
            profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            reasonCode: "route.not_registered",
            route: {
              online: false,
              reasonCode: "daemon.profile.offline",
            },
            status: "offline",
          },
        })
      );
      await runInit({
        profile: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        profileName: "Route Bot",
        kind: "agent",
        silent: true,
      });

      vi.spyOn(globalThis, "fetch").mockImplementation(
        (input: string | URL | Request) => {
          const url = String(input);
          if (url.includes("/api/auth/get-session")) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  session: { expires: "2026-12-31T00:00:00.000Z" },
                  user: { id: "user-mira", email: "mira@openmeld.invalid" },
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }
              )
            );
          }
          if (url.includes("/v1/diagnostics/chain")) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  service: "openmeld-gateway",
                  auth: { service: "openmeld-auth" },
                  core: { service: "openmeld-core" },
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }
              )
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ service: "openmeld-gateway" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
      );

      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runDoctor({
            profile: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            baseUrl: "https://gateway.openmeld.invalid",
            view: "agent",
          });
        } catch (error) {
          thrown = error;
        }
      });

      expect(thrown).toBeInstanceOf(Error);
      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
      expect(
        lines.some((line) =>
          String(line.text).includes(
            "OpenMeld server can't currently deliver wakes to this profile."
          )
        )
      ).toBe(true);
      expect(
        lines.some((line) =>
          String(line.text).includes(
            "openmeld service status --profile agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          )
        )
      ).toBe(true);
    });
  });
});
