import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type { LocalComponentsStatus } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDaemonExecutionCompatibility } from "../runtime-transport/application/daemon-execution-compatibility";
import {
  detachSocket,
  handleHeartbeat,
  handleRegisterSession,
  LEASE_TTL_MS,
  lookupOwnerService,
  lookupRoute,
  lookupRoutesBatch,
  reapExpiredLeases,
} from "../runtime-transport/application/runtime-transport-session-service";
import { createRuntimeTransportMutableState } from "../runtime-transport/application/runtime-transport-state";
import {
  adoptHibernatedSockets,
  persistServiceRuntimeRecords,
  persistServiceRuntimeRecordsNow,
  restoreServiceRuntimeRecords,
} from "../runtime-transport/infrastructure/runtime-transport-runtime-store";

class FakeSocket {
  private attachment: unknown = null;

  serializeAttachment(value: unknown): void {
    this.attachment = value;
  }

  deserializeAttachment(): unknown {
    return this.attachment;
  }
}

class ThrowingAttachmentSocket extends FakeSocket {
  deserializeAttachment(): unknown {
    throw new Error("corrupt attachment");
  }
}

class FakeStorage {
  private readonly values = new Map<string, unknown>();
  private readonly pending: Promise<unknown>[] = [];

  put(key: string, value: unknown): Promise<void> {
    const promise = Promise.resolve().then(() => {
      this.values.set(key, value);
    });
    this.pending.push(promise);
    return promise;
  }

  list<T>(options: { prefix: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const [key, value] of this.values) {
      if (key.startsWith(options.prefix)) {
        result.set(key, value as T);
      }
    }
    return Promise.resolve(result);
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.values.delete(key));
  }

  async flush(): Promise<void> {
    await Promise.all(this.pending);
  }
}

const putServiceRuntimeRecord = async (
  storage: FakeStorage,
  input: {
    ownerUserId: string;
    deviceId: string;
    daemonSessionId: string;
    profileId: string;
    heartbeatAtMs: number;
    deliveryDisconnectedAtMs?: number | null;
    omitDeliveryDisconnectedAtMs?: boolean;
  }
): Promise<void> => {
  await storage.put(`serviceruntime.v1.${input.deviceId}`, {
    v: 1,
    ownerUserId: input.ownerUserId,
    daemonSessionId: input.daemonSessionId,
    deviceId: input.deviceId,
    lane: "dev-local",
    serviceVersion: "0.7.73",
    connectionGeneration: 1,
    connectedAtMs: input.heartbeatAtMs,
    lastHeartbeatMs: input.heartbeatAtMs,
    ...(input.omitDeliveryDisconnectedAtMs
      ? {}
      : { deliveryDisconnectedAtMs: input.deliveryDisconnectedAtMs ?? null }),
    capabilities: {},
    executionCompatibility: resolveDaemonExecutionCompatibility({
      epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
    }),
    localWakeRouteReport: null,
    rejectedProfileRegistrations: [],
    profileLeases: [
      {
        profileId: input.profileId,
        leaseEpoch: 1,
        lastHeartbeatMs: input.heartbeatAtMs,
      },
    ],
  });
};

function createLocalComponentsStatus(input: {
  cliPackageVersion: string;
}): LocalComponentsStatus {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-04T00:00:00.000Z",
    entrypoint: "setup",
    summaryLabel: "Everything is up to date",
    summaryDescription:
      "OpenMeld local components are aligned for this computer.",
    setupAction: "none",
    setupActionLabel: "Everything is up to date",
    setupActionDescription:
      "OpenMeld local components are aligned for this computer.",
    cli: {
      commandContractVersion: "cli-contract-v1",
      latestPackageVersion: "0.7.94",
      packageVersion: input.cliPackageVersion,
      reasonCodes: [],
      requiredCommandContractVersion: null,
      status: "ok",
    },
    service: {
      expectedBundleHash: "a".repeat(64),
      expectedBundleVersion: "0.7.94",
      installedBundleHash: "a".repeat(64),
      installedBundleVersion: "0.7.94",
      reasonCodes: [],
      runtimeContractEpoch: "daemon-epoch-v1",
      serviceContractVersion: "daemon-epoch-v1",
      status: "ok",
    },
    skills: {
      expectedBundleHash: "b".repeat(64),
      installedBundleHash: "b".repeat(64),
      reasonCodes: [],
      skillContractVersion: "skills-contract-v1",
      status: "ok",
      targetCount: 1,
    },
  };
}

describe("runtime transport session service", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("heals persisted owner mismatch from verified owner on register", () => {
    const state = createRuntimeTransportMutableState();
    state.ownerUserId = "owner-stale";
    state.sessionsById.set("daemon-session-verified", {
      ownerUserId: "owner-stale",
      daemonSessionId: "daemon-session-verified",
      deviceId: "device-verified",
      lane: "dev-local",
      connectionGeneration: 2,
      connectedAtMs: 1000,
      lastHeartbeatMs: 1000,
      deliveryDisconnectedAtMs: null,
      capabilities: {},
      executionCompatibility: resolveDaemonExecutionCompatibility({
        epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      }),
      profileIds: new Set<string>(),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    });
    const socket = new FakeSocket() as unknown as WebSocket;

    const response = handleRegisterSession(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-verified",
          deviceId: "device-verified",
          lane: "dev-local",
          daemonSessionId: "daemon-session-verified",
          connectionGeneration: 2,
          profileIds: ["agt-verified"],
          capabilities: {},
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          connectedAtMs: 2000,
        },
        verifiedOwnerUserId: "owner-verified",
        webSocket: socket,
      },
      {
        persistRuntimeRecords: () => undefined,
        cleanupExpiredPendingDispatches: () => undefined,
        failPendingDispatchResultWaitersForConnectionGeneration: () =>
          undefined,
        closeSocket: () => undefined,
      }
    );

    expect(response.rejectedProfiles).toEqual([]);
    expect(state.ownerUserId).toBe("owner-verified");
    expect(state.sessionsById.get("daemon-session-verified")?.ownerUserId).toBe(
      "owner-verified"
    );
    expect(
      state.profileLeasesByProfileId.get("agt-verified")?.daemonSessionId
    ).toBe("daemon-session-verified");
    expect(
      (socket as unknown as FakeSocket).deserializeAttachment()
    ).toMatchObject({
      verifiedOwnerUserId: "owner-verified",
      daemonSessionId: "daemon-session-verified",
      connectionGeneration: 2,
    });
  });

  it("rejects profile leases when the daemon omits the execution contract", () => {
    const state = createRuntimeTransportMutableState();
    const socket = new FakeSocket() as unknown as WebSocket;

    const response = handleRegisterSession(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-verified",
          deviceId: "device-verified",
          lane: "dev-local",
          daemonSessionId: "daemon-session-verified",
          connectionGeneration: 1,
          profileIds: ["agt-verified"],
          capabilities: {},
          connectedAtMs: 2000,
        },
        verifiedOwnerUserId: "owner-verified",
        webSocket: socket,
      },
      {
        persistRuntimeRecords: () => undefined,
        cleanupExpiredPendingDispatches: () => undefined,
        failPendingDispatchResultWaitersForConnectionGeneration: () =>
          undefined,
        closeSocket: () => undefined,
      }
    );

    expect(response.acceptedLeases).toEqual([]);
    expect(response.rejectedProfiles).toEqual([
      {
        profileId: "agt-verified",
        reasonCode: "daemon.session.reject_conflict",
      },
    ]);
    expect(
      lookupOwnerService(
        state,
        {
          v: 1,
          ownerUserId: "owner-verified",
        },
        {
          persistRuntimeRecords: () => undefined,
          cleanupExpiredPendingDispatches: () => undefined,
        }
      )
    ).toMatchObject({
      online: true,
      sessions: [
        {
          executionCompatibility: {
            status: "update_required",
            reasonCode: "daemon.runtime_contract.missing",
          },
        },
      ],
    });
    expect(state.profileLeasesByProfileId.has("agt-verified")).toBe(false);
    expect(
      lookupRoute(
        state,
        {
          v: 1,
          ownerUserId: "owner-verified",
          profileId: "agt-verified",
        },
        {
          persistRuntimeRecords: () => undefined,
          cleanupExpiredPendingDispatches: () => undefined,
        }
      )
    ).toMatchObject({
      online: false,
      reasonCode: "daemon.profile.offline",
    });
  });

  it("orders fresh owner-service sessions by latest heartbeat before stale insertion order", () => {
    vi.useFakeTimers();
    try {
      const nowMs = Date.UTC(2026, 5, 21, 7, 8, 0);
      vi.setSystemTime(nowMs);
      const state = createRuntimeTransportMutableState();
      state.ownerUserId = "owner-verified";
      const executionCompatibility = resolveDaemonExecutionCompatibility({
        epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      });

      state.sessionsById.set("daemon-session-old", {
        ownerUserId: "owner-verified",
        daemonSessionId: "daemon-session-old",
        deviceId: "device-verified",
        lane: "prod",
        serviceVersion: "0.7.74",
        connectionGeneration: 1,
        connectedAtMs: nowMs - 20_000,
        lastHeartbeatMs: nowMs - 20_000,
        deliveryDisconnectedAtMs: null,
        capabilities: {},
        executionCompatibility,
        profileIds: new Set(["agt-verified"]),
        localWakeRouteReport: null,
        rejectedProfileRegistrationsByProfileId: new Map(),
        socket: null,
      });
      state.sessionsById.set("daemon-session-new", {
        ownerUserId: "owner-verified",
        daemonSessionId: "daemon-session-new",
        deviceId: "device-verified",
        lane: "prod",
        serviceVersion: "0.7.75",
        connectionGeneration: 2,
        connectedAtMs: nowMs - 1000,
        lastHeartbeatMs: nowMs - 1000,
        deliveryDisconnectedAtMs: null,
        capabilities: {},
        executionCompatibility,
        profileIds: new Set(["agt-verified"]),
        localWakeRouteReport: null,
        rejectedProfileRegistrationsByProfileId: new Map(),
        socket: null,
      });

      expect(
        lookupOwnerService(
          state,
          {
            v: 1,
            ownerUserId: "owner-verified",
          },
          {
            persistRuntimeRecords: () => undefined,
            cleanupExpiredPendingDispatches: () => undefined,
          }
        )
      ).toMatchObject({
        online: true,
        sessions: [
          {
            daemonSessionId: "daemon-session-new",
            serviceVersion: "0.7.75",
          },
          {
            daemonSessionId: "daemon-session-old",
            serviceVersion: "0.7.74",
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats an explicit user stop as offline without hiding a controlled update", () => {
    vi.useFakeTimers();
    const nowMs = Date.UTC(2026, 7, 7, 5, 30, 0);
    vi.setSystemTime(nowMs);
    const state = createRuntimeTransportMutableState();
    state.ownerUserId = "owner-verified";
    const executionCompatibility = resolveDaemonExecutionCompatibility({
      epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
    });
    const baseSession = {
      ownerUserId: "owner-verified",
      deviceId: "device-verified",
      lane: "prod" as const,
      serviceVersion: "0.7.75",
      connectionGeneration: 1,
      connectedAtMs: nowMs - 1000,
      lastHeartbeatMs: nowMs - 1000,
      deliveryDisconnectedAtMs: nowMs,
      capabilities: {},
      executionCompatibility,
      profileIds: new Set(["agt-verified"]),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    };
    state.sessionsById.set("daemon-session-user-stop", {
      ...baseSession,
      acceptingDispatches: false,
      daemonSessionId: "daemon-session-user-stop",
      stopCause: "user_stop",
    });
    state.sessionsById.set("daemon-session-update", {
      ...baseSession,
      acceptingDispatches: false,
      daemonSessionId: "daemon-session-update",
      stopCause: "controlled_service_update",
    });
    const dependencies = {
      persistRuntimeRecords: () => undefined,
      cleanupExpiredPendingDispatches: () => undefined,
    };

    expect(
      lookupOwnerService(
        state,
        { v: 1, ownerUserId: "owner-verified" },
        dependencies
      )
    ).toMatchObject({
      online: true,
      sessions: [{ daemonSessionId: "daemon-session-update" }],
    });

    state.sessionsById.delete("daemon-session-update");
    expect(
      lookupOwnerService(
        state,
        { v: 1, ownerUserId: "owner-verified" },
        dependencies
      )
    ).toEqual({
      online: false,
      reasonCode: "daemon.session.not_found",
    });
  });

  it("does not report owner service online after Wake route leases expire", () => {
    vi.useFakeTimers();
    try {
      const connectedAtMs = Date.UTC(2026, 2, 14, 0, 0, 0);
      vi.setSystemTime(connectedAtMs);
      const state = createRuntimeTransportMutableState();
      const socket = new FakeSocket() as unknown as WebSocket;
      const deps = {
        persistRuntimeRecords: () => undefined,
        cleanupExpiredPendingDispatches: () => undefined,
        failPendingDispatchResultWaitersForConnectionGeneration: () =>
          undefined,
        closeSocket: () => undefined,
      };

      const register = handleRegisterSession(
        state,
        {
          request: {
            v: 1,
            ownerUserId: "owner-verified",
            deviceId: "device-verified",
            lane: "dev-local",
            daemonSessionId: "daemon-session-verified",
            connectionGeneration: 1,
            profileIds: ["agt-verified"],
            capabilities: {},
            runtimeContract: {
              epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            },
            connectedAtMs,
          },
          verifiedOwnerUserId: "owner-verified",
          webSocket: socket,
        },
        deps
      );

      expect(register.acceptedLeases).toEqual([
        {
          profileId: "agt-verified",
          leaseEpoch: 1,
        },
      ]);

      vi.setSystemTime(connectedAtMs + 200_001);

      expect(
        lookupRoute(
          state,
          {
            v: 1,
            ownerUserId: "owner-verified",
            profileId: "agt-verified",
          },
          {
            persistRuntimeRecords: () => undefined,
            cleanupExpiredPendingDispatches: () => undefined,
          }
        )
      ).toMatchObject({
        online: false,
        reasonCode: "daemon.profile.offline",
      });
      expect(
        lookupOwnerService(
          state,
          {
            v: 1,
            ownerUserId: "owner-verified",
          },
          {
            persistRuntimeRecords: () => undefined,
            cleanupExpiredPendingDispatches: () => undefined,
          }
        )
      ).toEqual({
        online: false,
        reasonCode: "daemon.session.not_found",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns skipped local Wake route reports for offline profiles", () => {
    const state = createRuntimeTransportMutableState();
    const socket = new FakeSocket() as unknown as WebSocket;

    handleRegisterSession(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-verified",
          deviceId: "device-verified",
          lane: "dev-local",
          daemonSessionId: "daemon-session-verified",
          connectionGeneration: 1,
          profileIds: [],
          localWakeRouteReport: {
            reportedAtMs: 2000,
            daemonSessionId: "daemon-session-verified",
            deviceId: "device-verified",
            lane: "dev-local",
            serviceVersion: "0.7.52",
            includedProfileIds: [],
            skippedProfiles: [
              {
                profileId: "agt-skipped",
                profileName: "Skipped Agent",
                skipReason: "projection.missing",
              },
            ],
          },
          capabilities: {},
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          connectedAtMs: 2000,
        },
        verifiedOwnerUserId: "owner-verified",
        webSocket: socket,
      },
      {
        persistRuntimeRecords: () => undefined,
        cleanupExpiredPendingDispatches: () => undefined,
        failPendingDispatchResultWaitersForConnectionGeneration: () =>
          undefined,
        closeSocket: () => undefined,
      }
    );

    expect(
      lookupRoute(
        state,
        {
          v: 1,
          ownerUserId: "owner-verified",
          profileId: "agt-skipped",
        },
        {
          persistRuntimeRecords: () => undefined,
          cleanupExpiredPendingDispatches: () => undefined,
        }
      )
    ).toMatchObject({
      online: false,
      reasonCode: "daemon.profile.offline",
      localWakeRouteReport: {
        reportedAtMs: 2000,
        skippedProfiles: [
          {
            profileId: "agt-skipped",
            skipReason: "projection.missing",
          },
        ],
      },
    });
  });

  it("returns rejected Wake route registrations for offline profiles", () => {
    const state = createRuntimeTransportMutableState();
    const socket = new FakeSocket() as unknown as WebSocket;

    handleRegisterSession(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-verified",
          deviceId: "device-verified",
          lane: "dev-local",
          daemonSessionId: "daemon-session-verified",
          connectionGeneration: 1,
          profileIds: ["agt-rejected"],
          localWakeRouteReport: {
            reportedAtMs: 2000,
            daemonSessionId: "daemon-session-verified",
            deviceId: "device-verified",
            lane: "dev-local",
            serviceVersion: "0.7.52",
            includedProfileIds: ["agt-rejected"],
            skippedProfiles: [],
          },
          capabilities: {},
          connectedAtMs: 2000,
        },
        verifiedOwnerUserId: "owner-verified",
        webSocket: socket,
      },
      {
        persistRuntimeRecords: () => undefined,
        cleanupExpiredPendingDispatches: () => undefined,
        failPendingDispatchResultWaitersForConnectionGeneration: () =>
          undefined,
        closeSocket: () => undefined,
      }
    );

    expect(
      lookupRoute(
        state,
        {
          v: 1,
          ownerUserId: "owner-verified",
          profileId: "agt-rejected",
        },
        {
          persistRuntimeRecords: () => undefined,
          cleanupExpiredPendingDispatches: () => undefined,
        }
      )
    ).toMatchObject({
      online: false,
      reasonCode: "daemon.profile.offline",
      rejectedProfileRegistration: {
        profileId: "agt-rejected",
        reasonCode: "daemon.session.reject_conflict",
        rejectedAtMs: expect.any(Number),
      },
    });
  });

  it("clears existing profile leases when heartbeat omits runtime contract evidence", () => {
    const state = createRuntimeTransportMutableState();
    const socket = new FakeSocket() as unknown as WebSocket;
    const deps = {
      persistRuntimeRecords: () => undefined,
      cleanupExpiredPendingDispatches: () => undefined,
      recordReapedReadinessProfiles: () => undefined,
      failPendingDispatchResultWaitersForConnectionGeneration: () => undefined,
      closeSocket: () => undefined,
    };

    const register = handleRegisterSession(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-verified",
          deviceId: "device-verified",
          lane: "dev-local",
          daemonSessionId: "daemon-session-verified",
          connectionGeneration: 1,
          profileIds: ["agt-verified"],
          capabilities: {},
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          connectedAtMs: 2000,
        },
        verifiedOwnerUserId: "owner-verified",
        webSocket: socket,
      },
      deps
    );

    expect(register.acceptedLeases).toEqual([
      {
        profileId: "agt-verified",
        leaseEpoch: 1,
      },
    ]);

    const heartbeat = handleHeartbeat(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-verified",
          deviceId: "device-verified",
          lane: "dev-local",
          daemonSessionId: "daemon-session-verified",
          leases: [{ profileId: "agt-verified", leaseEpoch: 1 }],
          sentAtMs: 3000,
        },
        verifiedOwnerUserId: "owner-verified",
      },
      deps
    );

    expect(heartbeat.staleLeases).toEqual([
      {
        profileId: "agt-verified",
        leaseEpoch: 1,
      },
    ]);
    expect(state.profileLeasesByProfileId.has("agt-verified")).toBe(false);
  });

  it("updates route capabilities from heartbeat local component reports", () => {
    const state = createRuntimeTransportMutableState();
    const socket = new FakeSocket() as unknown as WebSocket;
    const deps = {
      persistRuntimeRecords: () => undefined,
      cleanupExpiredPendingDispatches: () => undefined,
      failPendingDispatchResultWaitersForConnectionGeneration: () => undefined,
      closeSocket: () => undefined,
    };

    const register = handleRegisterSession(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-components",
          deviceId: "device-components",
          lane: "dev-local",
          daemonSessionId: "daemon-session-components",
          connectionGeneration: 1,
          profileIds: ["agt-components"],
          capabilities: {
            localComponents: createLocalComponentsStatus({
              cliPackageVersion: "0.7.93",
            }),
          },
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          connectedAtMs: 2000,
        },
        verifiedOwnerUserId: "owner-components",
        webSocket: socket,
      },
      deps
    );

    expect(register.acceptedLeases).toEqual([
      {
        profileId: "agt-components",
        leaseEpoch: 1,
      },
    ]);

    const heartbeat = handleHeartbeat(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-components",
          deviceId: "device-components",
          lane: "dev-local",
          daemonSessionId: "daemon-session-components",
          acceptingDispatches: false,
          stopCause: "controlled_service_update",
          leases: [{ profileId: "agt-components", leaseEpoch: 1 }],
          capabilities: {
            localComponents: createLocalComponentsStatus({
              cliPackageVersion: "0.7.94",
            }),
          },
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          sentAtMs: 3000,
        },
        verifiedOwnerUserId: "owner-components",
      },
      deps
    );

    expect(heartbeat).toMatchObject({ ok: true, staleLeases: [] });
    expect(
      state.sessionsById.get("daemon-session-components")?.capabilities
        .localComponents?.cli.packageVersion
    ).toBe("0.7.94");
    expect(
      state.profileLeasesByProfileId.get("agt-components")?.capabilities
        .localComponents?.cli.packageVersion
    ).toBe("0.7.94");
    expect(
      lookupRoute(
        state,
        {
          v: 1,
          ownerUserId: "owner-components",
          profileId: "agt-components",
        },
        deps
      )
    ).toMatchObject({
      online: true,
      acceptingDispatches: false,
      stopCause: "controlled_service_update",
      capabilities: {
        localComponents: {
          cli: {
            packageVersion: "0.7.94",
          },
        },
      },
    });
  });

  it("preserves route capabilities when heartbeat omits capabilities", () => {
    const state = createRuntimeTransportMutableState();
    const socket = new FakeSocket() as unknown as WebSocket;
    const deps = {
      persistRuntimeRecords: () => undefined,
      cleanupExpiredPendingDispatches: () => undefined,
      failPendingDispatchResultWaitersForConnectionGeneration: () => undefined,
      closeSocket: () => undefined,
    };

    const register = handleRegisterSession(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-preserve-components",
          deviceId: "device-preserve-components",
          lane: "dev-local",
          daemonSessionId: "daemon-session-preserve-components",
          connectionGeneration: 1,
          profileIds: ["agt-preserve-components"],
          capabilities: {
            localComponents: createLocalComponentsStatus({
              cliPackageVersion: "0.7.95",
            }),
          },
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          connectedAtMs: 2000,
        },
        verifiedOwnerUserId: "owner-preserve-components",
        webSocket: socket,
      },
      deps
    );

    expect(register.acceptedLeases).toEqual([
      {
        profileId: "agt-preserve-components",
        leaseEpoch: 1,
      },
    ]);

    const heartbeat = handleHeartbeat(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-preserve-components",
          deviceId: "device-preserve-components",
          lane: "dev-local",
          daemonSessionId: "daemon-session-preserve-components",
          leases: [{ profileId: "agt-preserve-components", leaseEpoch: 1 }],
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          sentAtMs: 3000,
        },
        verifiedOwnerUserId: "owner-preserve-components",
      },
      deps
    );

    expect(heartbeat).toMatchObject({ ok: true, staleLeases: [] });
    expect(
      state.sessionsById.get("daemon-session-preserve-components")?.capabilities
        .localComponents?.cli.packageVersion
    ).toBe("0.7.95");
    expect(
      state.profileLeasesByProfileId.get("agt-preserve-components")
        ?.capabilities.localComponents?.cli.packageVersion
    ).toBe("0.7.95");
    expect(
      lookupRoute(
        state,
        {
          v: 1,
          ownerUserId: "owner-preserve-components",
          profileId: "agt-preserve-components",
        },
        deps
      )
    ).toMatchObject({
      online: true,
      capabilities: {
        localComponents: {
          cli: {
            packageVersion: "0.7.95",
          },
        },
      },
    });
  });

  it("clears accepted leases when heartbeat omits runtime contract evidence and lease ids", () => {
    const state = createRuntimeTransportMutableState();
    const socket = new FakeSocket() as unknown as WebSocket;
    const deps = {
      persistRuntimeRecords: () => undefined,
      cleanupExpiredPendingDispatches: () => undefined,
      failPendingDispatchResultWaitersForConnectionGeneration: () => undefined,
      closeSocket: () => undefined,
    };

    const register = handleRegisterSession(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-verified",
          deviceId: "device-verified",
          lane: "dev-local",
          daemonSessionId: "daemon-session-verified",
          connectionGeneration: 1,
          profileIds: ["agt-verified"],
          capabilities: {},
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          connectedAtMs: 2000,
        },
        verifiedOwnerUserId: "owner-verified",
        webSocket: socket,
      },
      deps
    );
    expect(register.acceptedLeases).toEqual([
      {
        profileId: "agt-verified",
        leaseEpoch: 1,
      },
    ]);

    handleRegisterSession(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-verified",
          deviceId: "device-verified",
          lane: "dev-local",
          daemonSessionId: "daemon-session-verified",
          connectionGeneration: 1,
          profileIds: [],
          capabilities: {},
          connectedAtMs: 4000,
        },
        verifiedOwnerUserId: "owner-verified",
        webSocket: socket,
      },
      deps
    );

    expect(
      lookupRoute(
        state,
        {
          v: 1,
          ownerUserId: "owner-verified",
          profileId: "agt-verified",
        },
        {
          persistRuntimeRecords: () => undefined,
          cleanupExpiredPendingDispatches: () => undefined,
        }
      )
    ).toMatchObject({
      online: false,
      reasonCode: "daemon.profile.offline",
    });
    expect(
      lookupOwnerService(
        state,
        {
          v: 1,
          ownerUserId: "owner-verified",
        },
        {
          persistRuntimeRecords: () => undefined,
          cleanupExpiredPendingDispatches: () => undefined,
        }
      )
    ).toMatchObject({
      online: true,
      sessions: [
        {
          executionCompatibility: {
            reasonCode: "daemon.runtime_contract.missing",
            status: "update_required",
          },
        },
      ],
    });

    const compatibleRegister = handleRegisterSession(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-verified",
          deviceId: "device-verified",
          lane: "dev-local",
          daemonSessionId: "daemon-session-verified",
          connectionGeneration: 1,
          profileIds: ["agt-verified"],
          capabilities: {},
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          connectedAtMs: 5000,
        },
        verifiedOwnerUserId: "owner-verified",
        webSocket: socket,
      },
      deps
    );
    expect(compatibleRegister.acceptedLeases).toEqual([
      {
        profileId: "agt-verified",
        leaseEpoch: 1,
      },
    ]);

    const heartbeat = handleHeartbeat(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-verified",
          deviceId: "device-verified",
          lane: "dev-local",
          daemonSessionId: "daemon-session-verified",
          leases: [],
          sentAtMs: 6000,
        },
        verifiedOwnerUserId: "owner-verified",
      },
      deps
    );

    expect(heartbeat.staleLeases).toEqual([
      {
        profileId: "agt-verified",
        leaseEpoch: 1,
      },
    ]);
    expect(
      lookupRoute(
        state,
        {
          v: 1,
          ownerUserId: "owner-verified",
          profileId: "agt-verified",
        },
        {
          persistRuntimeRecords: () => undefined,
          cleanupExpiredPendingDispatches: () => undefined,
        }
      )
    ).toMatchObject({
      online: false,
      reasonCode: "daemon.profile.offline",
    });
    expect(
      lookupOwnerService(
        state,
        {
          v: 1,
          ownerUserId: "owner-verified",
        },
        {
          persistRuntimeRecords: () => undefined,
          cleanupExpiredPendingDispatches: () => undefined,
        }
      )
    ).toMatchObject({
      online: true,
      sessions: [
        {
          executionCompatibility: {
            reasonCode: "daemon.runtime_contract.missing",
            status: "update_required",
          },
        },
      ],
    });
  });

  it("restores Wake routes from ServiceRuntime records across cold starts", async () => {
    const originalState = createRuntimeTransportMutableState();
    const socket = new FakeSocket() as unknown as WebSocket;
    const storage = new FakeStorage();
    const ctx = {
      storage,
      getWebSockets: () => [socket],
    } as unknown as DurableObjectState;
    const deps = {
      persistRuntimeRecords: () => undefined,
      cleanupExpiredPendingDispatches: () => undefined,
      failPendingDispatchResultWaitersForConnectionGeneration: () => undefined,
      closeSocket: () => undefined,
    };

    handleRegisterSession(
      originalState,
      {
        request: {
          v: 1,
          ownerUserId: "owner-verified",
          deviceId: "device-verified",
          lane: "dev-local",
          daemonSessionId: "daemon-session-verified",
          connectionGeneration: 1,
          profileIds: ["agt-verified"],
          localWakeRouteReport: {
            reportedAtMs: 2000,
            daemonSessionId: "daemon-session-verified",
            deviceId: "device-verified",
            lane: "dev-local",
            serviceVersion: "0.7.54",
            includedProfileIds: ["agt-verified"],
            skippedProfiles: [],
          },
          serviceVersion: "0.7.54",
          capabilities: {},
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          connectedAtMs: 2000,
        },
        verifiedOwnerUserId: "owner-verified",
        webSocket: socket,
      },
      deps
    );
    persistServiceRuntimeRecords(ctx, originalState);
    await storage.flush();

    const restoredState = createRuntimeTransportMutableState();
    const closeSocket = vi.fn();
    await restoreServiceRuntimeRecords(ctx, restoredState);
    adoptHibernatedSockets(ctx, restoredState, { closeSocket });

    expect(closeSocket).not.toHaveBeenCalled();
    expect(
      lookupRoute(
        restoredState,
        {
          v: 1,
          ownerUserId: "owner-verified",
          profileId: "agt-verified",
        },
        {
          persistRuntimeRecords: () => undefined,
          cleanupExpiredPendingDispatches: () => undefined,
        }
      )
    ).toMatchObject({
      online: true,
      daemonSessionId: "daemon-session-verified",
      deviceId: "device-verified",
      lane: "dev-local",
      serviceVersion: "0.7.54",
      localWakeRouteReport: {
        includedProfileIds: ["agt-verified"],
      },
    });
  });

  it("answers a routes batch identically to per-profile lookups", () => {
    const state = createRuntimeTransportMutableState();
    const socket = new FakeSocket() as unknown as WebSocket;
    const deps = {
      persistRuntimeRecords: () => undefined,
      cleanupExpiredPendingDispatches: () => undefined,
      failPendingDispatchResultWaitersForConnectionGeneration: () => undefined,
      closeSocket: () => undefined,
    };
    handleRegisterSession(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-batch",
          deviceId: "device-batch",
          lane: "dev-local",
          daemonSessionId: "daemon-session-batch",
          connectionGeneration: 1,
          profileIds: ["agt-batch-a"],
          serviceVersion: "0.7.58",
          capabilities: {},
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          connectedAtMs: 2000,
        },
        verifiedOwnerUserId: "owner-batch",
        webSocket: socket,
      },
      deps
    );

    const batch = lookupRoutesBatch(
      state,
      {
        v: 1,
        ownerUserId: "owner-batch",
        profileIds: ["agt-batch-a", "agt-batch-missing"],
      },
      deps
    );

    expect(batch.routes["agt-batch-a"]).toEqual(
      lookupRoute(
        state,
        { v: 1, ownerUserId: "owner-batch", profileId: "agt-batch-a" },
        deps
      )
    );
    expect(batch.routes["agt-batch-a"]?.online).toBe(true);
    expect(batch.routes["agt-batch-missing"]?.online).toBe(false);
  });

  it("keeps hibernated sockets for unknown sessions instead of closing them", () => {
    const state = createRuntimeTransportMutableState();
    const socket = new FakeSocket() as unknown as WebSocket;
    socket.serializeAttachment({
      verifiedOwnerUserId: "owner-verified",
      daemonSessionId: "daemon-session-lost",
      connectionGeneration: 3,
    });
    const closeSocket = vi.fn();

    adoptHibernatedSockets(
      {
        getWebSockets: () => [socket],
      } as unknown as DurableObjectState,
      state,
      { closeSocket }
    );

    expect(closeSocket).not.toHaveBeenCalled();
    expect(state.sessionIdBySocket.get(socket)).toBe("daemon-session-lost");
  });

  it("closes superseded hibernated sockets with an older connection generation", () => {
    const state = createRuntimeTransportMutableState();
    state.sessionsById.set("daemon-session-verified", {
      ownerUserId: "owner-verified",
      daemonSessionId: "daemon-session-verified",
      deviceId: "device-verified",
      lane: "dev-local",
      connectionGeneration: 5,
      connectedAtMs: 1000,
      lastHeartbeatMs: Date.now(),
      deliveryDisconnectedAtMs: null,
      capabilities: {},
      executionCompatibility: resolveDaemonExecutionCompatibility({
        epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      }),
      profileIds: new Set<string>(),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    });
    const socket = new FakeSocket() as unknown as WebSocket;
    socket.serializeAttachment({
      verifiedOwnerUserId: "owner-verified",
      daemonSessionId: "daemon-session-verified",
      connectionGeneration: 4,
    });
    const closeSocket = vi.fn();

    adoptHibernatedSockets(
      {
        getWebSockets: () => [socket],
      } as unknown as DurableObjectState,
      state,
      { closeSocket }
    );

    expect(closeSocket).toHaveBeenCalledWith(socket, 1012, "session_replaced");
  });

  it("clears delivery disconnect evidence when adopting a hibernated socket", () => {
    const state = createRuntimeTransportMutableState();
    state.sessionsById.set("daemon-session-verified", {
      ownerUserId: "owner-verified",
      daemonSessionId: "daemon-session-verified",
      deviceId: "device-verified",
      lane: "dev-local",
      connectionGeneration: 5,
      connectedAtMs: 1000,
      lastHeartbeatMs: Date.now(),
      deliveryDisconnectedAtMs: Date.now() - 1000,
      capabilities: {},
      executionCompatibility: resolveDaemonExecutionCompatibility({
        epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      }),
      profileIds: new Set<string>(),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    });
    const socket = new FakeSocket() as unknown as WebSocket;
    socket.serializeAttachment({
      verifiedOwnerUserId: "owner-verified",
      daemonSessionId: "daemon-session-verified",
      connectionGeneration: 5,
    });
    const closeSocket = vi.fn();

    adoptHibernatedSockets(
      {
        getWebSockets: () => [socket],
      } as unknown as DurableObjectState,
      state,
      { closeSocket }
    );

    expect(closeSocket).not.toHaveBeenCalled();
    expect(state.sessionsById.get("daemon-session-verified")?.socket).toBe(
      socket
    );
    expect(
      state.sessionsById.get("daemon-session-verified")
        ?.deliveryDisconnectedAtMs
    ).toBeNull();
  });

  it("closes restored sockets missing verified owner attachment", () => {
    const state = createRuntimeTransportMutableState();
    const socket = new FakeSocket() as unknown as WebSocket;
    const closeSocket = vi.fn();

    adoptHibernatedSockets(
      {
        getWebSockets: () => [socket],
      } as unknown as DurableObjectState,
      state,
      { closeSocket }
    );

    expect(closeSocket).toHaveBeenCalledWith(
      socket,
      1008,
      "session_owner_unverified"
    );
    expect(state.sessionIdBySocket.has(socket)).toBe(false);
  });

  it("returns every readiness profile affected by lease and stale-session reaping", () => {
    const state = createRuntimeTransportMutableState();
    const persistRuntimeRecords = vi.fn();
    const cleanupExpiredPendingDispatches = vi.fn();
    const recordReapedReadinessProfiles = vi.fn();
    state.sessionsById.set("daemon-session-expired", {
      ownerUserId: "owner-lease",
      daemonSessionId: "daemon-session-expired",
      deviceId: "device-expired",
      lane: "dev-local",
      connectionGeneration: 1,
      connectedAtMs: 1000,
      lastHeartbeatMs: 1000,
      deliveryDisconnectedAtMs: null,
      capabilities: {},
      executionCompatibility: resolveDaemonExecutionCompatibility({
        epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      }),
      profileIds: new Set<string>(["agt-expired"]),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    });
    state.profileLeasesByProfileId.set("agt-expired", {
      profileId: "agt-expired",
      daemonSessionId: "daemon-session-expired",
      deviceId: "device-expired",
      lane: "dev-local",
      leaseEpoch: 1,
      lastHeartbeatMs: 1000,
      capabilities: {},
      executionCompatibility: resolveDaemonExecutionCompatibility({
        epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      }),
    });
    state.sessionsById.set("daemon-session-report-only", {
      ownerUserId: "owner-lease",
      daemonSessionId: "daemon-session-report-only",
      deviceId: "device-report-only",
      lane: "dev-local",
      connectionGeneration: 1,
      connectedAtMs: 1000,
      lastHeartbeatMs: 1000,
      deliveryDisconnectedAtMs: null,
      capabilities: {},
      executionCompatibility: resolveDaemonExecutionCompatibility({
        epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      }),
      profileIds: new Set<string>(),
      localWakeRouteReport: {
        daemonSessionId: "daemon-session-report-only",
        deviceId: "device-report-only",
        includedProfileIds: ["agt-report-included"],
        lane: "dev-local",
        reportedAtMs: 1000,
        skippedProfiles: [
          {
            profileId: "agt-report-skipped",
            profileName: "Skipped Agent",
            skipReason: "controller.registry.disabled",
          },
        ],
      },
      rejectedProfileRegistrationsByProfileId: new Map([
        [
          "agt-report-rejected",
          {
            profileId: "agt-report-rejected",
            reasonCode: "daemon.runtime_contract.missing",
            rejectedAtMs: 1000,
            daemonSessionId: "daemon-session-report-only",
            deviceId: "device-report-only",
            lane: "dev-local",
          },
        ],
      ]),
      socket: null,
    });

    const result = reapExpiredLeases(state, 1_000_000, {
      cleanupExpiredPendingDispatches,
      persistRuntimeRecords,
      recordReapedReadinessProfiles,
    });

    expect(result.expiredProfileIds).toEqual(["agt-expired"]);
    const removedSessionProfileIds = new Set(result.removedSessionProfileIds);
    expect(removedSessionProfileIds).toEqual(
      new Set([
        "agt-report-included",
        "agt-report-rejected",
        "agt-report-skipped",
      ])
    );
    expect(recordReapedReadinessProfiles).toHaveBeenCalledWith(result);
    expect(state.profileLeasesByProfileId.has("agt-expired")).toBe(false);
    expect(state.sessionsById.has("daemon-session-report-only")).toBe(false);
    expect(cleanupExpiredPendingDispatches).toHaveBeenCalledWith(1_000_000);
    expect(persistRuntimeRecords).toHaveBeenCalled();
  });

  it("returns fresh lease evidence for detached routes without exposing delivery state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const state = createRuntimeTransportMutableState();
    const socket = new FakeSocket() as unknown as WebSocket;
    const deps = {
      closeSocket: () => undefined,
      persistRuntimeRecords: () => undefined,
      cleanupExpiredPendingDispatches: () => undefined,
      failPendingDispatchResultWaitersForConnectionGeneration: () => undefined,
    };
    handleRegisterSession(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-replace",
          deviceId: "device-replace",
          lane: "dev-local",
          daemonSessionId: "daemon-session-replace",
          connectionGeneration: 1,
          profileIds: ["agt-replace"],
          capabilities: {},
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          connectedAtMs: 1_700_000_000_000,
        },
        verifiedOwnerUserId: "owner-replace",
        webSocket: socket,
      },
      deps
    );

    vi.setSystemTime(1_700_000_010_000);
    detachSocket(state, socket, deps);
    const session = state.sessionsById.get("daemon-session-replace");
    expect(session?.lastHeartbeatMs).toBe(1_700_000_000_000);
    expect(session?.deliveryDisconnectedAtMs).toBe(1_700_000_010_000);

    const midReplaceRoute = lookupRoute(
      state,
      {
        v: 1,
        ownerUserId: "owner-replace",
        profileId: "agt-replace",
      },
      deps
    );
    expect(midReplaceRoute).toMatchObject({
      online: false,
      reasonCode: "daemon.profile.offline",
      lastHeartbeatMs: 1_700_000_000_000,
    });
    expect(midReplaceRoute).not.toHaveProperty("deliveryState");

    const pendingFirstReportRoute = lookupRoute(
      state,
      {
        v: 1,
        ownerUserId: "owner-replace",
        profileId: "agt-never-registered",
      },
      deps
    );
    expect(pendingFirstReportRoute).toMatchObject({
      online: false,
      reasonCode: "daemon.profile.pending_first_report",
      ownerService: {
        daemonSessionId: "daemon-session-replace",
        deviceId: "device-replace",
        lane: "dev-local",
        lastHeartbeatMs: 1_700_000_000_000,
      },
    });
    expect("lastHeartbeatMs" in pendingFirstReportRoute).toBe(false);

    vi.setSystemTime(1_700_000_010_000 + LEASE_TTL_MS + 1);
    const expiredPendingFirstReportRoute = lookupRoute(
      state,
      {
        v: 1,
        ownerUserId: "owner-replace",
        profileId: "agt-never-registered",
      },
      deps
    );
    expect(expiredPendingFirstReportRoute).toMatchObject({
      online: false,
      reasonCode: "daemon.profile.offline",
    });
    expect(expiredPendingFirstReportRoute).not.toHaveProperty("ownerService");
    vi.useRealTimers();
  });

  it("does not clear delivery disconnect evidence on heartbeat without a socket", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const state = createRuntimeTransportMutableState();
    const socket = new FakeSocket() as unknown as WebSocket;
    const deps = {
      closeSocket: () => undefined,
      persistRuntimeRecords: () => undefined,
      cleanupExpiredPendingDispatches: () => undefined,
      failPendingDispatchResultWaitersForConnectionGeneration: () => undefined,
    };
    handleRegisterSession(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-heartbeat-detached",
          deviceId: "device-heartbeat-detached",
          lane: "dev-local",
          daemonSessionId: "daemon-session-heartbeat-detached",
          connectionGeneration: 1,
          profileIds: ["agt-heartbeat-detached"],
          capabilities: {},
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          connectedAtMs: 1_700_000_000_000,
        },
        verifiedOwnerUserId: "owner-heartbeat-detached",
        webSocket: socket,
      },
      deps
    );

    vi.setSystemTime(1_700_000_010_000);
    detachSocket(state, socket, deps);
    vi.setSystemTime(1_700_000_011_000);
    const heartbeat = handleHeartbeat(
      state,
      {
        request: {
          v: 1,
          ownerUserId: "owner-heartbeat-detached",
          deviceId: "device-heartbeat-detached",
          lane: "dev-local",
          daemonSessionId: "daemon-session-heartbeat-detached",
          serviceVersion: "0.7.73",
          leases: [{ profileId: "agt-heartbeat-detached", leaseEpoch: 1 }],
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          sentAtMs: 1_700_000_011_000,
        },
        verifiedOwnerUserId: "owner-heartbeat-detached",
      },
      deps
    );

    expect(heartbeat.ok).toBe(true);
    expect(
      state.sessionsById.get("daemon-session-heartbeat-detached")
        ?.deliveryDisconnectedAtMs
    ).toBe(1_700_000_010_000);
    const route = lookupRoute(
      state,
      {
        v: 1,
        ownerUserId: "owner-heartbeat-detached",
        profileId: "agt-heartbeat-detached",
      },
      deps
    );
    expect(route).toMatchObject({
      online: false,
      reasonCode: "daemon.profile.offline",
      lastHeartbeatMs: 1_700_000_011_000,
    });
    expect(route).not.toHaveProperty("deliveryState");
    vi.useRealTimers();
  });

  it("synthesizes restore-time delivery disconnect evidence for legacy records without a disconnect timestamp", async () => {
    vi.useFakeTimers();
    const heartbeatAtMs = 1_700_000_000_000;
    const restoredAtMs = heartbeatAtMs + 1000;
    vi.setSystemTime(heartbeatAtMs);
    const storage = new FakeStorage();
    const ctx = {
      storage,
      getWebSockets: () => [],
    } as unknown as DurableObjectState;
    const deps = {
      closeSocket: () => undefined,
      persistRuntimeRecords: () => undefined,
      cleanupExpiredPendingDispatches: () => undefined,
      failPendingDispatchResultWaitersForConnectionGeneration: () => undefined,
    };

    await putServiceRuntimeRecord(storage, {
      ownerUserId: "owner-restored",
      deviceId: "device-restored",
      daemonSessionId: "daemon-session-restored",
      profileId: "agt-restored",
      heartbeatAtMs,
      omitDeliveryDisconnectedAtMs: true,
    });

    vi.setSystemTime(restoredAtMs);
    const restoredState = createRuntimeTransportMutableState();
    const restoreResult = await restoreServiceRuntimeRecords(
      ctx,
      restoredState
    );

    const firstLookupRoute = lookupRoute(
      restoredState,
      {
        v: 1,
        ownerUserId: "owner-restored",
        profileId: "agt-restored",
      },
      deps
    );
    expect(firstLookupRoute).toMatchObject({
      online: false,
      reasonCode: "daemon.profile.offline",
      lastHeartbeatMs: heartbeatAtMs,
    });
    expect(firstLookupRoute).not.toHaveProperty("deliveryState");
    expect(
      restoredState.sessionsById.get("daemon-session-restored")
        ?.deliveryDisconnectedAtMs
    ).toBe(restoredAtMs);
    expect(restoreResult.needsPersist).toBe(true);
    vi.useRealTimers();
  });

  it("restores a persisted delivery disconnect timestamp without replacing it", async () => {
    vi.useFakeTimers();
    const heartbeatAtMs = 1_700_000_000_000;
    const deliveryDisconnectedAtMs = 1_700_000_010_000;
    const restoredAtMs = deliveryDisconnectedAtMs + 1000;
    vi.setSystemTime(heartbeatAtMs);
    const storage = new FakeStorage();
    const ctx = {
      storage,
      getWebSockets: () => [],
    } as unknown as DurableObjectState;
    const deps = {
      closeSocket: () => undefined,
      persistRuntimeRecords: () => undefined,
      cleanupExpiredPendingDispatches: () => undefined,
      failPendingDispatchResultWaitersForConnectionGeneration: () => undefined,
    };

    await putServiceRuntimeRecord(storage, {
      ownerUserId: "owner-stale-restored",
      deviceId: "device-stale-restored",
      daemonSessionId: "daemon-session-stale-restored",
      profileId: "agt-stale-restored",
      heartbeatAtMs,
      deliveryDisconnectedAtMs,
    });

    vi.setSystemTime(restoredAtMs);
    const restoredState = createRuntimeTransportMutableState();
    const restoreResult = await restoreServiceRuntimeRecords(
      ctx,
      restoredState
    );

    const route = lookupRoute(
      restoredState,
      {
        v: 1,
        ownerUserId: "owner-stale-restored",
        profileId: "agt-stale-restored",
      },
      deps
    );

    expect(route).toMatchObject({
      online: false,
      reasonCode: "daemon.profile.offline",
      lastHeartbeatMs: heartbeatAtMs,
    });
    expect(route).not.toHaveProperty("deliveryState");
    expect(
      restoredState.sessionsById.get("daemon-session-stale-restored")
        ?.deliveryDisconnectedAtMs
    ).toBe(deliveryDisconnectedAtMs);
    expect(restoreResult.needsPersist).toBe(false);
    vi.useRealTimers();
  });

  it("persists a synthesized restore-time disconnect clock across repeated cold starts", async () => {
    vi.useFakeTimers();
    const heartbeatAtMs = 1_700_000_000_000;
    const restoredAtMs = heartbeatAtMs + 1000;
    vi.setSystemTime(heartbeatAtMs);
    const originalState = createRuntimeTransportMutableState();
    const socket = new FakeSocket() as unknown as WebSocket;
    const storage = new FakeStorage();
    const ctx = {
      storage,
      getWebSockets: () => [],
    } as unknown as DurableObjectState;
    const deps = {
      closeSocket: () => undefined,
      persistRuntimeRecords: () => undefined,
      cleanupExpiredPendingDispatches: () => undefined,
      failPendingDispatchResultWaitersForConnectionGeneration: () => undefined,
    };

    handleRegisterSession(
      originalState,
      {
        request: {
          v: 1,
          ownerUserId: "owner-repeat-restored",
          deviceId: "device-repeat-restored",
          lane: "dev-local",
          daemonSessionId: "daemon-session-repeat-restored",
          connectionGeneration: 1,
          profileIds: ["agt-repeat-restored"],
          capabilities: {},
          runtimeContract: {
            epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          },
          connectedAtMs: heartbeatAtMs,
        },
        verifiedOwnerUserId: "owner-repeat-restored",
        webSocket: socket,
      },
      deps
    );
    persistServiceRuntimeRecords(ctx, originalState);
    await storage.flush();

    vi.setSystemTime(restoredAtMs);
    const restoredState = createRuntimeTransportMutableState();
    const firstRestoreResult = await restoreServiceRuntimeRecords(
      ctx,
      restoredState
    );
    const routeAfterFirstRestore = lookupRoute(
      restoredState,
      {
        v: 1,
        ownerUserId: "owner-repeat-restored",
        profileId: "agt-repeat-restored",
      },
      deps
    );

    expect(routeAfterFirstRestore).toMatchObject({
      online: false,
      reasonCode: "daemon.profile.offline",
      lastHeartbeatMs: heartbeatAtMs,
    });
    expect(routeAfterFirstRestore).not.toHaveProperty("deliveryState");
    expect(firstRestoreResult.needsPersist).toBe(true);
    expect(
      restoredState.sessionsById.get("daemon-session-repeat-restored")
        ?.deliveryDisconnectedAtMs
    ).toBe(restoredAtMs);

    await persistServiceRuntimeRecordsNow(ctx, restoredState);

    vi.setSystemTime(restoredAtMs + 1000);
    const secondRestoredState = createRuntimeTransportMutableState();
    const secondRestoreResult = await restoreServiceRuntimeRecords(
      ctx,
      secondRestoredState
    );
    const routeAfterSecondRestore = lookupRoute(
      secondRestoredState,
      {
        v: 1,
        ownerUserId: "owner-repeat-restored",
        profileId: "agt-repeat-restored",
      },
      deps
    );

    expect(routeAfterSecondRestore).toMatchObject({
      online: false,
      reasonCode: "daemon.profile.offline",
      lastHeartbeatMs: heartbeatAtMs,
    });
    expect(routeAfterSecondRestore).not.toHaveProperty("deliveryState");
    expect(
      secondRestoredState.sessionsById.get("daemon-session-repeat-restored")
        ?.deliveryDisconnectedAtMs
    ).toBe(restoredAtMs);
    expect(secondRestoreResult.needsPersist).toBe(false);
    vi.useRealTimers();
  });

  it("clears a restored delivery disconnect timestamp when adopting a hibernated socket", async () => {
    vi.useFakeTimers();
    const heartbeatAtMs = 1_700_000_000_000;
    const deliveryDisconnectedAtMs = 1_700_000_010_000;
    vi.setSystemTime(deliveryDisconnectedAtMs + 1000);
    const storage = new FakeStorage();
    const socket = new FakeSocket() as unknown as WebSocket;
    socket.serializeAttachment({
      verifiedOwnerUserId: "owner-adopt-restored",
      daemonSessionId: "daemon-session-adopt-restored",
      connectionGeneration: 1,
    });
    const ctx = {
      storage,
      getWebSockets: () => [socket],
    } as unknown as DurableObjectState;
    const closeSocket = vi.fn();

    await putServiceRuntimeRecord(storage, {
      ownerUserId: "owner-adopt-restored",
      deviceId: "device-adopt-restored",
      daemonSessionId: "daemon-session-adopt-restored",
      profileId: "agt-adopt-restored",
      heartbeatAtMs,
      deliveryDisconnectedAtMs,
    });

    const restoredState = createRuntimeTransportMutableState();
    const restoreResult = await restoreServiceRuntimeRecords(
      ctx,
      restoredState
    );
    const adoptResult = adoptHibernatedSockets(ctx, restoredState, {
      closeSocket,
    });

    expect(restoreResult.needsPersist).toBe(false);
    expect(adoptResult.needsPersist).toBe(true);
    expect(closeSocket).not.toHaveBeenCalled();
    expect(
      restoredState.sessionsById.get("daemon-session-adopt-restored")
        ?.deliveryDisconnectedAtMs
    ).toBeNull();
    expect(
      restoredState.sessionsById.get("daemon-session-adopt-restored")?.socket
    ).toBe(socket);
    vi.useRealTimers();
  });

  it("closes a hibernated socket with corrupt attachment as unverified", () => {
    const state = createRuntimeTransportMutableState();
    const socket = new ThrowingAttachmentSocket() as unknown as WebSocket;
    const ctx = {
      storage: new FakeStorage(),
      getWebSockets: () => [socket],
    } as unknown as DurableObjectState;
    const closeSocket = vi.fn();

    const result = adoptHibernatedSockets(ctx, state, { closeSocket });

    expect(result.needsPersist).toBe(false);
    expect(closeSocket).toHaveBeenCalledWith(
      socket,
      1008,
      "session_owner_unverified"
    );
  });
});
