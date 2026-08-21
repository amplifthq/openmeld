import type {
  AgentControllerInterfaceSnapshot,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcEnrollLocalRuntime,
  rpcListLocalRuntimes,
  rpcSetLocalRuntimeDisplayName,
  rpcSubmitRuntimeAgentControllerReports,
  rpcWriteCurrentDeviceObservedMetadata,
} from "../src/rpc/methods";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("current device local runtimes RPC read model", () => {
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
    usageLimits: [
      {
        key: "codex:primary",
        label: "5-hour usage",
        observedAt: "2026-06-28T00:00:00.000Z",
        resetsAt: "2026-06-28T05:00:00.000Z",
        status: "available",
        usedPercent: 42,
      },
    ],
    version: "0.1.0",
  } satisfies AgentControllerInterfaceSnapshot;

  it("does not partially write current target or owned device rows when setup carries invalid connected computer evidence", async () => {
    const harness = createSqliteD1Harness();
    applyOwnedDeviceExecutionTargetMigrations(harness);
    try {
      const env = { OPENMELD_DB: harness.db } as CoreBindings;
      const context = createRequestContext();
      insertBindingWithRuntime(harness, {
        ownerUserId: "owner-1",
        deviceId: "device-existing",
        suffix: "existing",
      });
      harness.run({
        sql: `
          INSERT INTO openMeldDaemon_connected_computers (
            owner_user_id,
            connected_computer_id,
            created_at_ms,
            updated_at_ms
          )
          VALUES (?, ?, ?, ?)
        `,
        params: ["owner-1", "computer-existing", 1, 1],
      });
      await rpcEnrollLocalRuntime(env, {
        connectedComputerId: "computer-existing",
        context,
        deviceId: "device-existing",
        runtimeLane: "dev-local",
      });

      await expect(
        rpcEnrollLocalRuntime(env, {
          connectedComputerId: "computer-missing",
          context,
          deviceId: "device-new-home",
          runtimeLane: "dev-local",
        })
      ).rejects.toMatchObject({
        status: 409,
        code: "connected_computer.enrollment_invalid",
      });

      expect(
        harness.queryAll<{
          connected_computer_id: string | null;
          device_id: string;
        }>({
          sql: `
            SELECT device_id, connected_computer_id
            FROM openMeldDaemon_owned_devices
            WHERE owner_user_id = ?
            ORDER BY device_id
          `,
          params: ["owner-1"],
        })
      ).toEqual([
        {
          connected_computer_id: "computer-existing",
          device_id: "device-existing",
        },
      ]);

      await expect(
        rpcListLocalRuntimes(env, {
          context,
        })
      ).resolves.toMatchObject({
        currentDeviceId: "device-existing",
        currentRuntimeLane: "dev-local",
        localRuntimes: [
          {
            connectedComputerId: "computer-existing",
            deviceId: "device-existing",
          },
        ],
      });
    } finally {
      harness.close();
    }
  });

  it("uses registry observed metadata as the local runtime last observed moment", async () => {
    const harness = createSqliteD1Harness();
    applyOwnedDeviceExecutionTargetMigrations(harness);
    try {
      const env = { OPENMELD_DB: harness.db } as CoreBindings;
      const context = createRequestContext();
      insertBindingWithRuntime(harness, {
        ownerUserId: "owner-1",
        deviceId: "device-macbook",
        suffix: "macbook",
      });

      await rpcEnrollLocalRuntime(env, {
        context,
        deviceId: "device-macbook",
        runtimeLane: "dev-local",
      });
      await rpcWriteCurrentDeviceObservedMetadata(env, {
        context,
        deviceId: "device-macbook",
        metadata: {
          observedDisplayName: "Felix's MacBook Pro",
          platformFamily: "macOS",
          osVersion: "25.4.0",
          deviceType: "laptop",
          observedAtMs: Date.parse("2026-04-28T00:30:00.000Z"),
        },
      });

      await expect(
        rpcListLocalRuntimes(env, {
          context,
        })
      ).resolves.toMatchObject({
        currentDeviceId: "device-macbook",
        currentRuntimeLane: "dev-local",
        localRuntimes: [
          {
            deviceId: "device-macbook",
            deviceDisplayName: "Felix's MacBook Pro",
            deviceDisplayNameSource: "observed",
            lastObservedAtMs: Date.parse("2026-04-28T00:30:00.000Z"),
            isCurrent: true,
            executionTargets: [
              expect.objectContaining({
                deviceId: "device-macbook",
                isCurrent: true,
              }),
            ],
          },
        ],
      });
    } finally {
      harness.close();
    }
  });

  it("projects reported Agent Controller Interface evidence through local runtimes", async () => {
    const harness = createSqliteD1Harness();
    applyOwnedDeviceExecutionTargetMigrations(harness);
    try {
      const env = { OPENMELD_DB: harness.db } as CoreBindings;
      const context = createRequestContext();
      insertBindingWithRuntime(harness, {
        ownerUserId: "owner-1",
        deviceId: "device-macbook",
        suffix: "macbook",
      });
      await rpcEnrollLocalRuntime(env, {
        context,
        deviceId: "device-macbook",
        runtimeLane: "dev-local",
      });
      const observedAtMs = Date.now();

      await rpcSubmitRuntimeAgentControllerReports(env, {
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-macbook",
        },
        context,
        deviceId: "device-macbook",
        lane: "dev-local",
        reports: [
          {
            agentControllerRef: "builtin:codex",
            agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
            observedAtMs,
            expiresAtMs: observedAtMs + 60 * 60_000,
            reasonCodes: ["runtime.agent_controller_report.ready"],
            status: "ready",
          },
        ],
      });

      const compatibilityResponse = await rpcListLocalRuntimes(env, {
        context,
      });
      expect(
        compatibilityResponse.localRuntimes[0]?.executionTargets[0]
          ?.capabilities[0]?.agentControllerInterface?.usageLimits
      ).toBeUndefined();

      await expect(
        rpcListLocalRuntimes(env, {
          context,
          includeUsageLimits: "true",
        })
      ).resolves.toMatchObject({
        localRuntimes: [
          {
            deviceId: "device-macbook",
            executionTargets: [
              {
                capabilities: [
                  {
                    agentControllerRef: "builtin:codex",
                    agentControllerInterface: {
                      ...CODEX_AGENT_CONTROLLER_INTERFACE,
                      usageLimits:
                        CODEX_AGENT_CONTROLLER_INTERFACE.usageLimits.map(
                          (limit) => ({ ...limit, status: "stale" })
                        ),
                    },
                    status: "ready",
                  },
                ],
              },
            ],
          },
        ],
      });

      const resetExpiredReportObservedAtMs = observedAtMs + 1;
      const resetExpiredUsageObservedAt = new Date(observedAtMs).toISOString();
      const [resetExpiredUsageLimit] =
        CODEX_AGENT_CONTROLLER_INTERFACE.usageLimits;
      if (!resetExpiredUsageLimit) {
        throw new Error("Codex Usage Limit fixture is missing");
      }
      await rpcSubmitRuntimeAgentControllerReports(env, {
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-macbook",
        },
        context,
        deviceId: "device-macbook",
        lane: "dev-local",
        reports: [
          {
            agentControllerRef: "builtin:codex",
            agentControllerInterface: {
              ...CODEX_AGENT_CONTROLLER_INTERFACE,
              usageLimits: [
                {
                  ...resetExpiredUsageLimit,
                  observedAt: resetExpiredUsageObservedAt,
                  resetsAt: new Date(observedAtMs - 1).toISOString(),
                  status: "available",
                },
              ],
            },
            observedAtMs: resetExpiredReportObservedAtMs,
            expiresAtMs: resetExpiredReportObservedAtMs + 60 * 60_000,
            reasonCodes: ["runtime.agent_controller_report.ready"],
            status: "ready",
          },
        ],
      });

      const resetExpiredResponse = await rpcListLocalRuntimes(env, {
        context,
        includeUsageLimits: "true",
      });
      expect(
        resetExpiredResponse.localRuntimes[0]?.executionTargets[0]
          ?.capabilities[0]?.agentControllerInterface?.usageLimits?.[0]?.status
      ).toBe("stale");

      const mutationResponse = await rpcSetLocalRuntimeDisplayName(env, {
        context,
        deviceId: "device-macbook",
        displayName: "Studio Mac",
      });
      expect(
        mutationResponse.localRuntimes[0]?.executionTargets[0]?.capabilities[0]
          ?.agentControllerInterface?.usageLimits
      ).toBeUndefined();
    } finally {
      harness.close();
    }
  });
});

function applyOwnedDeviceExecutionTargetMigrations(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  applyDrizzleMigrationForTable(
    harness,
    "openMeldDaemon_runtime_registry_records"
  );
  applyDrizzleMigrationForTable(
    harness,
    "openMeldDaemon_runtime_agent_controller_reports"
  );
  applyDrizzleMigrationForTable(
    harness,
    "openMeldDaemon_agent_profile_bindings"
  );
}

function insertBindingWithRuntime(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    ownerUserId: string;
    deviceId: string;
    suffix: string;
  }
): void {
  const nowMs = Date.parse("2026-04-28T00:00:00.000Z");
  harness.run({
    sql: `
      INSERT INTO openMeldDaemon_runtime_registry_records (
        openmeld_service_runtime_id,
        owner_kind,
        owner_id,
        device_id,
        lane,
        created_at_ms,
        last_registered_at_ms,
        updated_at_ms
      )
      VALUES (?, 'owner_account', ?, ?, 'dev-local', ?, ?, ?)
    `,
    params: [
      `runtime-${input.suffix}`,
      input.ownerUserId,
      input.deviceId,
      nowMs,
      nowMs,
      nowMs,
    ],
  });
  harness.run({
    sql: `
      INSERT INTO openMeldDaemon_agent_profile_bindings (
        binding_id,
        owner_kind,
        owner_id,
        agent_profile_id,
        openmeld_service_runtime_id,
        agent_controller_ref,
        binding_state,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, 'owner_account', ?, ?, ?, 'builtin:codex', 'enabled_primary', ?, ?)
    `,
    params: [
      `binding-${input.suffix}`,
      input.ownerUserId,
      `agt-${input.suffix}`,
      `runtime-${input.suffix}`,
      nowMs,
      nowMs,
    ],
  });
}

function createRequestContext(): OpenMeldRequestContext {
  return {
    actorContext: {
      requestId: "request-current-device-local-runtimes",
      openMeldProfileId: "11111111-1111-4111-8111-111111111111",
      profileKind: "human",
      profileName: "Felix",
      ownerUserId: "owner-1",
    },
  };
}
