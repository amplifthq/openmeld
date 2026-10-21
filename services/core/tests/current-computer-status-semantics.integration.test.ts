import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { listOwnedDeviceExecutionTargetRecords } from "../src/runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import {
  getCurrentLocalRuntimeReplyReadinessUseCase,
  listLocalRuntimesUseCase,
} from "../src/start/application/current-device-target-service";
import { resolveCurrentDeviceFromBindings } from "../src/start/infrastructure/postgresql/current-device-derivation-repo";
import { listOwnedDeviceRegistryRecords } from "../src/start/infrastructure/postgresql/owned-device-registry-repo";
import { createPublishedLocalComponentsRelease } from "../test-support/published-local-components-release";
import { env } from "../test-support/worker-env";

type ReadinessStore = Parameters<
  typeof getCurrentLocalRuntimeReplyReadinessUseCase
>[0]["store"];
type TestReport = {
  agentControllerRef: string;
  reasonCodes: string[];
  status: "ready" | "disabled" | "unavailable" | "unknown";
};
const seededFixtures: Array<{
  deviceId: string;
  openMeldServiceRuntimeId: string;
  ownerUserId: string;
}> = [];
afterEach(async () => {
  for (const fixture of seededFixtures.splice(0)) {
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'DELETE FROM "openmeld"."openMeldDaemon_runtime_agent_controller_reports" WHERE openmeld_service_runtime_id = $1',
              values: [],
            },
            values: [fixture.openMeldServiceRuntimeId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."openMeldDaemon_runtime_registry_records" WHERE openmeld_service_runtime_id = $1',
              values: [],
            },
            values: [fixture.openMeldServiceRuntimeId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."openMeldDaemon_owned_devices" WHERE owner_user_id = $1 AND device_id = $2',
              values: [],
            },
            values: [fixture.ownerUserId, fixture.deviceId],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
  }
});
describe("current computer status semantics from D1 evidence", () => {
  it.each([
    {
      description:
        "ignores a disabled broken agent beside an enabled ready agent",
      expected: {
        canReplyFromThisComputer: true,
        executionTargetStatus: "ready",
        nextAction: "none",
        reasonCodes: ["runtime.agent_controller_report.ready"],
        status: "ready",
      },
      reports: [
        disabledReport("builtin:claude-code", "disabled"),
        readyReport("builtin:codex"),
      ],
    },
    {
      description:
        "ignores a disabled healthy agent beside an enabled ready agent",
      expected: {
        canReplyFromThisComputer: true,
        executionTargetStatus: "ready",
        nextAction: "none",
        reasonCodes: ["runtime.agent_controller_report.ready"],
        status: "ready",
      },
      reports: [
        disabledReport("builtin:claude-code", "ready"),
        readyReport("builtin:codex"),
      ],
    },
    {
      description:
        "keeps an enabled check failure warning-only beside a disabled agent",
      expected: {
        canReplyFromThisComputer: false,
        executionTargetStatus: "not_ready",
        nextAction: "check_status",
        reasonCodes: ["controller.interface.check_failed"],
        status: "blocked",
      },
      reports: [
        disabledReport("builtin:claude-code", "disabled"),
        checkFailedReport("builtin:grok-build"),
      ],
    },
    {
      description:
        "keeps real enabled repair evidence destructive beside a disabled agent",
      expected: {
        canReplyFromThisComputer: false,
        executionTargetStatus: "not_ready",
        nextAction: "run_setup",
        reasonCodes: ["controller.interface.error"],
        status: "blocked",
      },
      reports: [
        disabledReport("builtin:claude-code", "ready"),
        repairReport("builtin:grok-build"),
      ],
    },
    {
      description: "keeps all disabled broken agents quiet",
      expected: {
        canReplyFromThisComputer: false,
        executionTargetStatus: "not_ready",
        nextAction: "none",
        reasonCodes: ["local_agent_preparation.not_enabled"],
        status: "blocked",
      },
      reports: [disabledReport("builtin:claude-code", "disabled")],
    },
    {
      description: "keeps all disabled healthy agents quiet",
      expected: {
        canReplyFromThisComputer: false,
        executionTargetStatus: "not_ready",
        nextAction: "none",
        reasonCodes: ["local_agent_preparation.not_enabled"],
        status: "blocked",
      },
      reports: [disabledReport("builtin:claude-code", "ready")],
    },
    {
      description:
        "does not hide real repair evidence behind a retryable check",
      expected: {
        canReplyFromThisComputer: false,
        executionTargetStatus: "not_ready",
        nextAction: "run_setup",
        reasonCodes: [
          "controller.interface.check_failed",
          "controller.interface.error",
        ],
        status: "blocked",
      },
      reports: [
        checkFailedReport("builtin:codex"),
        repairReport("builtin:grok-build"),
      ],
    },
  ])("$description", async ({ expected, reports }) => {
    const fixture = await seedD1Runtime(reports);
    const store = createD1ReadinessStore();
    const readiness = await getCurrentLocalRuntimeReplyReadinessUseCase({
      localComponentsRelease: createPublishedLocalComponentsRelease(),
      lookupOwnerService: () => Promise.resolve(buildLiveOwnerService(fixture)),
      now: new Date(),
      store,
      userId: fixture.ownerUserId,
    });
    expect(readiness).toMatchObject({
      canReplyFromThisComputer: expected.canReplyFromThisComputer,
      nextAction: expected.nextAction,
      primaryBlocker:
        expected.status === "ready"
          ? "none"
          : "agent_controller_report_not_ready",
      runtime: {
        executionTargetStatus: expected.executionTargetStatus,
        reasonCodes: expected.reasonCodes,
      },
      status: expected.status,
    });
    const inventory = await listLocalRuntimesUseCase({
      store,
      userId: fixture.ownerUserId,
    });
    const projectedCapabilities =
      inventory.localRuntimes[0]?.executionTargets[0]?.capabilities ?? [];
    for (const report of reports) {
      expect(projectedCapabilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            agentControllerRef: report.agentControllerRef,
            enabled: !report.reasonCodes.includes(
              "local_agent_preparation.not_enabled"
            ),
          }),
        ])
      );
    }
  });
});
function disabledReport(
  agentControllerRef: string,
  status: "ready" | "disabled"
): TestReport {
  return {
    agentControllerRef,
    reasonCodes: ["local_agent_preparation.not_enabled"],
    status,
  };
}
function readyReport(agentControllerRef: string): TestReport {
  return {
    agentControllerRef,
    reasonCodes: ["runtime.agent_controller_report.ready"],
    status: "ready",
  };
}
function checkFailedReport(agentControllerRef: string): TestReport {
  return {
    agentControllerRef,
    reasonCodes: ["controller.interface.check_failed"],
    status: "unavailable",
  };
}
function repairReport(agentControllerRef: string): TestReport {
  return {
    agentControllerRef,
    reasonCodes: ["controller.interface.error"],
    status: "unavailable",
  };
}
async function seedD1Runtime(reports: TestReport[]) {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const ownerUserId = `owner_computer_status_${suffix}`;
  const deviceId = `device-computer-status-${suffix}`;
  const openMeldServiceRuntimeId = `runtime_computer_status_${suffix}`;
  const nowMs = Date.now();
  seededFixtures.push({ deviceId, openMeldServiceRuntimeId, ownerUserId });
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `INSERT INTO "openmeld"."openMeldDaemon_owned_devices" (
        owner_user_id,
        device_id,
        connected_computer_id,
        observed_display_name,
        user_display_name,
        platform_family,
        os_version,
        device_type,
        first_seen_at_ms,
        last_observed_at_ms,
        updated_at_ms
      ) VALUES ($1, $2, NULL, 'Test Mac', NULL, 'macOS', '15.0', 'laptop', $3, $4, $5)`,
            values: [],
          },
          values: [ownerUserId, deviceId, nowMs, nowMs, nowMs],
        },
        {
          ...{
            text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_registry_records" (
        openmeld_service_runtime_id,
        owner_kind,
        owner_id,
        device_id,
        lane,
        created_at_ms,
        last_registered_at_ms,
        updated_at_ms
      ) VALUES ($1, 'owner_account', $2, $3, 'dev-local', $4, $5, $6)`,
            values: [],
          },
          values: [
            openMeldServiceRuntimeId,
            ownerUserId,
            deviceId,
            nowMs,
            nowMs,
            nowMs,
          ],
        },
        ...reports.map((report) => ({
          ...{
            text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_agent_controller_reports" (
          openmeld_service_runtime_id,
          agent_controller_ref,
          report_status,
          observed_at_ms,
          expires_at_ms,
          reported_reason_codes_json,
          agent_controller_interface_json,
          accepted_at_ms,
          updated_at_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)`,
            values: [],
          },
          values: [
            openMeldServiceRuntimeId,
            report.agentControllerRef,
            report.status,
            nowMs,
            nowMs + 60_000,
            JSON.stringify(report.reasonCodes),
            nowMs,
            nowMs,
          ],
        })),
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return { deviceId, openMeldServiceRuntimeId, ownerUserId };
}
function createD1ReadinessStore(): ReadinessStore {
  const unavailableMutation = (): Promise<never> =>
    Promise.reject(
      new Error("read-only D1 readiness test store does not allow mutations")
    );
  return {
    deleteForgottenDevice: unavailableMutation,
    forgetComputer: unavailableMutation,
    forgetCurrentComputer: unavailableMutation,
    readConnectedComputerIdentity: () => Promise.resolve(null),
    readCurrentDeviceTarget: ({ userId }) =>
      resolveCurrentDeviceFromBindings({
        db: getPostgresDatabase(env),
        userId,
      }),
    readForgottenDevice: () => Promise.resolve(null),
    readOwnedDeviceExecutionTargets: ({ nowMs, userId }) =>
      listOwnedDeviceExecutionTargetRecords({
        db: getPostgresDatabase(env),
        nowMs,
        userId,
      }),
    readOwnedDeviceRegistryRecord: () => Promise.resolve(null),
    readOwnedDevices: async ({ userId }) => {
      const records = await listOwnedDeviceRegistryRecords({
        db: getPostgresDatabase(env),
        userId,
      });
      return records.map((record) => ({
        connectedComputerId: record.connectedComputerId,
        deviceId: record.deviceId,
        deviceType: record.deviceType,
        firstSeenAtMs: record.firstSeenAtMs,
        lastObservedAtMs: record.lastObservedAtMs,
        observedDisplayName: record.observedDisplayName,
        osVersion: record.osVersion,
        platformFamily: record.platformFamily,
        userDisplayName: record.userDisplayName,
      }));
    },
    upsertOwnedDeviceRegistryRecord: unavailableMutation,
  };
}
function buildLiveOwnerService(fixture: {
  deviceId: string;
  openMeldServiceRuntimeId: string;
}) {
  return {
    online: true as const,
    sessions: [
      {
        capabilities: {},
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-computer-status",
        deviceId: fixture.deviceId,
        executionCompatibility: {
          expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          reasonCode: "daemon.runtime_contract.compatible" as const,
          status: "compatible" as const,
        },
        lane: "dev-local" as const,
        lastHeartbeatMs: Date.now(),
        openMeldServiceRuntimeId: fixture.openMeldServiceRuntimeId,
        serviceVersion: "999.0.0",
      },
    ],
  };
}
