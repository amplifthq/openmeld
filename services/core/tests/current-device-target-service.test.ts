import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  localComponentsReleaseManifestSchema,
} from "@openmeld/schemas";
import type {
  AgentControllerInterfaceSnapshot,
  LocalComponentsStatus,
  RuntimeTransportCapabilities,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import releaseManifestJson from "../../../release/local-components.json";
import { REQUIRED_SERVICE_UPDATE_RELEASE_MANIFEST } from "../src/__tests__/local-components-release-manifest-fixture";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as localComponentsUpdateProjection from "../src/local-components/update-projection";
import {
  ConnectedComputerEnrollmentInvalidError,
  enrollLocalSetupDeviceUseCase,
  forgetComputerUseCase,
  forgetCurrentComputerUseCase,
  getCurrentDeviceTargetUseCase,
  getCurrentLocalRuntimeReplyReadinessUseCase,
  listLocalRuntimesUseCase,
  setLocalRuntimeDisplayNameUseCase,
} from "../src/start/application/current-device-target-service";
import { ensureOwnedDevicePlaceholderUseCase } from "../src/start/application/owned-device-registry-service";

const COMPATIBLE_SERVICE = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  reasonCode: "daemon.runtime_contract.compatible",
  status: "compatible",
} as const;
const resolveLocalComponentUpdateProjection =
  localComponentsUpdateProjection.resolveLocalComponentUpdateProjection;

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

const CURRENT_RELEASE_MANIFEST =
  localComponentsReleaseManifestSchema.parse(releaseManifestJson);

const CURRENT_LOCAL_COMPONENTS_STATUS = {
  schemaVersion: 1,
  generatedAt: "2026-07-01T00:00:00.000Z",
  entrypoint: "setup",
  summaryLabel: "Everything is up to date",
  summaryDescription:
    "OpenMeld local components are aligned for this computer.",
  setupAction: "none",
  setupActionLabel: "Everything is up to date",
  setupActionDescription:
    "OpenMeld local components are aligned for this computer.",
  cli: {
    commandContractVersion:
      CURRENT_RELEASE_MANIFEST.components.cli.commandContractVersion,
    latestPackageVersion:
      CURRENT_RELEASE_MANIFEST.components.cli.packageVersion,
    packageVersion: CURRENT_RELEASE_MANIFEST.components.cli.packageVersion,
    reasonCodes: [],
    requiredCommandContractVersion: null,
    status: "ok",
  },
  service: {
    expectedBundleHash: CURRENT_RELEASE_MANIFEST.components.service.bundleHash,
    expectedBundleVersion:
      CURRENT_RELEASE_MANIFEST.components.service.bundleVersion,
    installedBundleHash: null,
    installedBundleVersion:
      CURRENT_RELEASE_MANIFEST.components.service.bundleVersion,
    reasonCodes: [],
    runtimeContractEpoch:
      CURRENT_RELEASE_MANIFEST.components.service.runtimeContractEpoch,
    serviceContractVersion:
      CURRENT_RELEASE_MANIFEST.components.service.serviceContractVersion,
    status: "ok",
  },
  skills: {
    expectedBundleHash: CURRENT_RELEASE_MANIFEST.components.skills.bundleHash,
    installedBundleHash: CURRENT_RELEASE_MANIFEST.components.skills.bundleHash,
    reasonCodes: [],
    skillContractVersion:
      CURRENT_RELEASE_MANIFEST.components.skills.skillContractVersion,
    status: "ok",
    targetCount: CURRENT_RELEASE_MANIFEST.components.skills.skillIds.length,
  },
} satisfies LocalComponentsStatus;

function useRequiredServiceUpdatePolicy() {
  vi.spyOn(
    localComponentsUpdateProjection,
    "resolveLocalComponentUpdateProjection"
  ).mockImplementation((input) =>
    resolveLocalComponentUpdateProjection({
      ...input,
      releaseManifest: REQUIRED_SERVICE_UPDATE_RELEASE_MANIFEST,
    })
  );
}

type OwnedDeviceRegistryRecord = {
  ownerUserId: string;
  deviceId: string;
  connectedComputerId?: string | null;
  observedDisplayName: string | null;
  userDisplayName: string | null;
  platformFamily: "macOS" | "Windows" | "Linux" | "Unknown" | null;
  osVersion: string | null;
  deviceType: "laptop" | "desktop" | "server" | "unknown" | null;
  firstSeenAtMs: number;
  lastObservedAtMs: number | null;
  updatedAtMs: number;
};

describe("current device target service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns missing when no current device target has been selected", async () => {
    const store = createInMemoryCurrentDeviceTargetStore();

    await expect(
      getCurrentDeviceTargetUseCase({
        store,
        userId: "owner-1",
      })
    ).resolves.toEqual({
      availability: "missing",
    });
  });

  it("seeds and reads the current device target through the store", async () => {
    const store = createInMemoryCurrentDeviceTargetStore();

    await expect(
      seedCurrentDeviceTarget({
        store,
        userId: "owner-1",
        deviceId: "device-123",
        runtimeLane: "dev-local",
        now: new Date("2026-04-10T00:00:00.000Z"),
      })
    ).resolves.toEqual({
      availability: "resolved",
      deviceId: "device-123",
      runtimeLane: "dev-local",
    });
    await expect(
      getCurrentDeviceTargetUseCase({
        store,
        userId: "owner-1",
      })
    ).resolves.toEqual({
      availability: "resolved",
      deviceId: "device-123",
      runtimeLane: "dev-local",
    });
  });

  it("keeps current device target state isolated per owner", async () => {
    const store = createInMemoryCurrentDeviceTargetStore();

    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
    });
    await seedCurrentDeviceTarget({
      store,
      userId: "owner-2",
      deviceId: "device-owner-2",
      runtimeLane: "canary",
    });

    await expect(
      getCurrentDeviceTargetUseCase({
        store,
        userId: "owner-1",
      })
    ).resolves.toEqual({
      availability: "resolved",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
    });
    await expect(
      getCurrentDeviceTargetUseCase({
        store,
        userId: "owner-2",
      })
    ).resolves.toEqual({
      availability: "resolved",
      deviceId: "device-owner-2",
      runtimeLane: "canary",
    });
  });

  it("fails closed when the input deviceId is invalid", async () => {
    const store = createInMemoryCurrentDeviceTargetStore();

    await expect(
      enrollLocalSetupDeviceUseCase({
        store,
        userId: "owner-1",
        deviceId: "   ",
        runtimeLane: "dev-local",
      })
    ).rejects.toThrow("failed to enroll local runtime");
  });

  it("lists local runtimes alongside the current device selection", async () => {
    const store = createInMemoryCurrentDeviceTargetStore();

    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      listLocalRuntimesUseCase({
        store,
        userId: "owner-1",
      })
    ).resolves.toEqual({
      currentConnectedComputerId: null,
      currentDeviceId: "device-owner-1",
      currentRuntimeLane: "dev-local",
      legacyDeviceEvidence: [],
      localRuntimes: [
        {
          deviceId: "device-owner-1",
          deviceDisplayName: "This computer",
          deviceDisplayNameSource: "placeholder",
          platformFamily: "Unknown",
          osVersion: null,
          deviceType: "unknown",
          firstSeenAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
          lastObservedAtMs: null,
          isCurrent: true,
          executionTargets: [],
        },
      ],
    });
  });

  it("lists local runtimes through the canonical local runtime read model", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });

    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    const result = await listLocalRuntimesUseCase({
      store,
      userId: "owner-1",
    });

    expect(result).toMatchObject({
      currentDeviceId: "device-owner-1",
      currentRuntimeLane: "dev-local",
      localRuntimes: [
        {
          deviceId: "device-owner-1",
          executionTargets: [
            {
              runtimeLane: "dev-local",
              status: "ready",
              capabilities: [
                expect.objectContaining({
                  agentControllerRef: "builtin:codex",
                  agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
                }),
              ],
            },
          ],
          isCurrent: true,
        },
      ],
    });
    const localAgentCatalog =
      result.localRuntimes[0]?.executionTargets[0]?.localAgentCatalog;
    expect(localAgentCatalog).toMatchObject({
      detectedSupported: 1,
    });
    expect(localAgentCatalog?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "claude-code",
          detected: false,
          displayName: "Claude Code",
          enabled: false,
          launchStatus: "not_available",
          selectable: false,
          selectableReason: "not_detected",
          targetKind: "builtin",
        }),
        expect.objectContaining({
          agentId: "codex",
          detected: true,
          displayName: "Codex",
          enabled: true,
          launchStatus: "ready",
          selectable: true,
          selectableReason: null,
          targetKind: "builtin",
        }),
        expect.objectContaining({
          agentId: "openclaw",
          detected: false,
          displayName: "OpenClaw",
          enabled: false,
          launchStatus: "not_available",
          selectable: false,
          selectableReason: "not_detected",
          targetKind: "builtin",
        }),
      ])
    );
  });

  it("projects optional Computer file access control only from a compatible live Service", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      store,
      userId: "owner-1",
    });

    const buildOwnerServiceLookup =
      (capabilities: RuntimeTransportCapabilities) => () =>
        Promise.resolve({
          online: true as const,
          sessions: [
            {
              capabilities,
              connectionGeneration: 1,
              daemonSessionId: "daemon-session-1",
              deviceId: "device-owner-1",
              executionCompatibility: COMPATIBLE_SERVICE,
              lane: "dev-local" as const,
              lastHeartbeatMs: Date.parse("2026-04-10T00:05:00.000Z"),
              serviceVersion: "999.0.0",
            },
          ],
        });

    const compatibleResult = await listLocalRuntimesUseCase({
      lookupOwnerService: buildOwnerServiceLookup({
        computerFileAccess: {
          readPolicy: true,
          updatePolicy: true,
        },
        localFolderPicker: {
          selectFolders: true,
        },
      }),
      store,
      userId: "owner-1",
    });
    expect(compatibleResult.localRuntimes[0]).toMatchObject({
      computerFileAccess: { readPolicy: true, updatePolicy: true },
      executionTargets: [],
      localFolderPicker: { selectFolders: true },
    });

    const legacyResult = await listLocalRuntimesUseCase({
      lookupOwnerService: buildOwnerServiceLookup({}),
      store,
      userId: "owner-1",
    });
    expect(legacyResult.localRuntimes[0]?.computerFileAccess).toBeUndefined();
    expect(legacyResult.localRuntimes[0]?.localFolderPicker).toBeUndefined();
  });

  it("projects current-device capabilities only from the freshest Service session", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      store,
      userId: "owner-1",
    });

    const result = await listLocalRuntimesUseCase({
      lookupOwnerService: () =>
        Promise.resolve({
          online: true as const,
          sessions: [
            {
              capabilities: {},
              connectionGeneration: 2,
              daemonSessionId: "daemon-session-current",
              deviceId: "device-owner-1",
              executionCompatibility: COMPATIBLE_SERVICE,
              lane: "dev-local" as const,
              lastHeartbeatMs: Date.parse("2026-04-10T00:06:00.000Z"),
              serviceVersion: "999.0.0",
            },
            {
              capabilities: {
                computerFileAccess: {
                  readPolicy: true,
                  updatePolicy: true,
                },
                localAgentControl: {
                  manageInstallations: true,
                  refreshCatalog: true,
                  setEnabled: true,
                  setProfileWorkspace: true,
                },
                localFolderPicker: { selectFolders: true },
                localProjectControl: {
                  connectCandidate: true,
                  connectDeclaredPath: true,
                  discoverProjects: true,
                  moveConnection: true,
                  removeConnection: true,
                  removeMissingConnections: true,
                  setDefaultConnection: true,
                },
              },
              connectionGeneration: 1,
              daemonSessionId: "daemon-session-stale",
              deviceId: "device-owner-1",
              executionCompatibility: COMPATIBLE_SERVICE,
              lane: "dev-local" as const,
              lastHeartbeatMs: Date.parse("2026-04-10T00:05:00.000Z"),
              serviceVersion: "998.0.0",
            },
          ],
        }),
      store,
      userId: "owner-1",
    });

    expect(result.localRuntimes[0]).toMatchObject({
      executionTargets: [
        {
          localAgentControl: {
            refreshCatalog: false,
            setEnabled: false,
            setProfileWorkspace: false,
          },
          localProjectControl: {
            connectCandidate: false,
            connectDeclaredPath: false,
            discoverProjects: false,
            moveConnection: false,
            removeConnection: false,
            removeMissingConnections: false,
            setDefaultConnection: false,
          },
        },
      ],
    });
    expect(result.localRuntimes[0]?.computerFileAccess).toBeUndefined();
    expect(result.localRuntimes[0]?.localFolderPicker).toBeUndefined();
  });

  it("projects connected computers as cards while keeping unmapped device rows as legacy evidence", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "device-current",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: ["runtime.legacy_device_disconnected"],
            capabilityStatus: "stale",
            deviceId: "device-old",
            lastObservedAtMs: Date.parse("2026-04-01T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3E5",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            connectedComputerId: "computer_felix_macbook",
            deviceId: "device-current",
            ownerUserId: "owner-1",
          }),
          createOwnedDeviceRecord({
            connectedComputerId: null,
            deviceId: "device-old",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      activationSource: "local_setup",
      deviceId: "device-current",
      runtimeLane: "dev-local",
      store,
      userId: "owner-1",
    });

    const result = await listLocalRuntimesUseCase({
      connectionIdentityAdoption: "safe_legacy_current",
      store,
      userId: "owner-1",
    });

    expect(result.currentConnectedComputerId).toBe("computer_felix_macbook");
    expect(result.localRuntimes).toHaveLength(1);
    expect(result.localRuntimes[0]).toMatchObject({
      connectedComputerId: "computer_felix_macbook",
      connectionStatus: "connected",
      deviceId: "device-current",
      legacyDeviceIds: ["device-current"],
      isCurrent: true,
    });
    expect(result.localRuntimes[0]?.executionTargets).toHaveLength(1);
    expect(result.legacyDeviceEvidence).toEqual([
      expect.objectContaining({
        connectionStatus: "legacy_disconnected",
        deviceId: "device-old",
        executionTargets: [
          expect.objectContaining({
            deviceId: "device-old",
            reasonCodes: ["runtime.legacy_device_disconnected"],
            status: "stale",
          }),
        ],
      }),
    ]);
  });

  it("adopts the legacy current device when it has fresh runtime evidence", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "device-current",
            lastObservedAtMs: Date.parse("2026-05-22T08:00:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      nextConnectedComputerIds: ["computer_adopted"],
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            connectedComputerId: null,
            deviceId: "device-current",
            ownerUserId: "owner-1",
          }),
          createOwnedDeviceRecord({
            connectedComputerId: null,
            deviceId: "device-old",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      deviceId: "device-current",
      runtimeLane: "dev-local",
      store,
      userId: "owner-1",
    });

    const result = await listLocalRuntimesUseCase({
      connectionIdentityAdoption: "safe_legacy_current",
      store,
      userId: "owner-1",
    });

    expect(result.currentConnectedComputerId).toBe("computer_adopted");
    expect(result.currentDeviceId).toBe("device-current");
    expect(result.localRuntimes).toHaveLength(1);
    expect(result.localRuntimes[0]).toMatchObject({
      connectedComputerId: "computer_adopted",
      connectionStatus: "connected",
      deviceId: "device-current",
      legacyDeviceIds: ["device-current"],
    });
    expect(result.legacyDeviceEvidence).toEqual([
      expect.objectContaining({
        connectionStatus: "legacy_disconnected",
        deviceId: "device-old",
      }),
    ]);
  });

  it("does not adopt legacy current device evidence from default local runtime reads", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "device-current",
            lastObservedAtMs: Date.parse("2026-05-22T08:00:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      nextConnectedComputerIds: ["computer_should_not_be_created"],
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            connectedComputerId: null,
            deviceId: "device-current",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      deviceId: "device-current",
      runtimeLane: "dev-local",
      store,
      userId: "owner-1",
    });

    const result = await listLocalRuntimesUseCase({
      store,
      userId: "owner-1",
    });

    expect(result.currentConnectedComputerId).toBeNull();
    expect(result.localRuntimes).toHaveLength(1);
    expect(result.localRuntimes[0]).toMatchObject({
      deviceId: "device-current",
      isCurrent: true,
    });
    expect(result.localRuntimes[0]?.connectedComputerId).toBeUndefined();
    expect(result.legacyDeviceEvidence).toEqual([
      expect.objectContaining({
        connectionStatus: "legacy_disconnected",
        deviceId: "device-current",
      }),
    ]);
    expect(store.readConnectedComputerIdsForTest("owner-1")).toEqual([]);
  });

  it("keeps the Binding-derived current device instead of adopting a fresh legacy candidate", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: ["runtime.legacy_device_disconnected"],
            capabilityStatus: "stale",
            deviceId: "device-old-current",
            lastObservedAtMs: Date.parse("2026-05-01T08:00:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "device-fresh-service",
            lastObservedAtMs: Date.parse("2026-05-22T08:00:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3E5",
            runtimeLane: "dev-local",
          },
        ],
      },
      nextConnectedComputerIds: ["computer_adopted_fresh"],
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            connectedComputerId: null,
            deviceId: "device-old-current",
            ownerUserId: "owner-1",
          }),
          createOwnedDeviceRecord({
            connectedComputerId: null,
            deviceId: "device-fresh-service",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      deviceId: "device-old-current",
      runtimeLane: "dev-local",
      store,
      userId: "owner-1",
    });

    const result = await listLocalRuntimesUseCase({
      connectionIdentityAdoption: "safe_legacy_current",
      store,
      userId: "owner-1",
    });

    expect(result.currentDeviceId).toBe("device-old-current");
    expect(result.currentConnectedComputerId).toBeNull();
    expect(store.readConnectedComputerIdsForTest("owner-1")).toEqual([]);
    await expect(
      getCurrentDeviceTargetUseCase({
        store,
        userId: "owner-1",
      })
    ).resolves.toEqual({
      availability: "resolved",
      deviceId: "device-old-current",
      runtimeLane: "dev-local",
    });
  });

  it("does not adopt legacy device records without one fresh current-runtime candidate", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: ["runtime.capability_stale"],
            capabilityStatus: "stale",
            deviceId: "device-current",
            lastObservedAtMs: Date.parse("2026-05-01T08:00:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      nextConnectedComputerIds: ["computer_should_not_be_created"],
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            connectedComputerId: null,
            deviceId: "device-current",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      deviceId: "device-current",
      runtimeLane: "dev-local",
      store,
      userId: "owner-1",
    });

    const result = await listLocalRuntimesUseCase({
      connectionIdentityAdoption: "safe_legacy_current",
      store,
      userId: "owner-1",
    });

    expect(result.currentConnectedComputerId).toBeNull();
    expect(result.localRuntimes).toEqual([]);
    expect(result.legacyDeviceEvidence).toEqual([
      expect.objectContaining({
        connectionStatus: "legacy_disconnected",
        deviceId: "device-current",
      }),
    ]);
    expect(store.readConnectedComputerIdsForTest("owner-1")).toEqual([]);
  });

  it("does not adopt when multiple fresh legacy runtimes compete and the current target is not one of them", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: ["runtime.legacy_device_disconnected"],
            capabilityStatus: "stale",
            deviceId: "device-old-current",
            lastObservedAtMs: Date.parse("2026-05-01T08:00:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "device-fresh-a",
            lastObservedAtMs: Date.parse("2026-05-22T08:00:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3E5",
            runtimeLane: "dev-local",
          },
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "device-fresh-b",
            lastObservedAtMs: Date.parse("2026-05-22T08:01:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3E6",
            runtimeLane: "dev-local",
          },
        ],
      },
      nextConnectedComputerIds: ["computer_should_not_be_created"],
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            connectedComputerId: null,
            deviceId: "device-old-current",
            ownerUserId: "owner-1",
          }),
          createOwnedDeviceRecord({
            connectedComputerId: null,
            deviceId: "device-fresh-a",
            ownerUserId: "owner-1",
          }),
          createOwnedDeviceRecord({
            connectedComputerId: null,
            deviceId: "device-fresh-b",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      deviceId: "device-old-current",
      runtimeLane: "dev-local",
      store,
      userId: "owner-1",
    });

    const result = await listLocalRuntimesUseCase({
      connectionIdentityAdoption: "safe_legacy_current",
      store,
      userId: "owner-1",
    });

    expect(result.currentConnectedComputerId).toBeNull();
    expect(result.localRuntimes).toEqual([]);
    expect(result.currentDeviceId).toBe("device-old-current");
    expect(result.legacyDeviceEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ deviceId: "device-old-current" }),
        expect.objectContaining({ deviceId: "device-fresh-a" }),
        expect.objectContaining({ deviceId: "device-fresh-b" }),
      ])
    );
    expect(store.readConnectedComputerIdsForTest("owner-1")).toEqual([]);
  });

  it("creates and reuses connected computer identity only through local setup", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      nextConnectedComputerIds: ["computer_generated_1"],
    });

    await seedCurrentDeviceTarget({
      activationSource: "local_setup",
      deviceId: "device-current",
      runtimeLane: "dev-local",
      store,
      userId: "owner-1",
    });
    await seedCurrentDeviceTarget({
      activationSource: "local_setup",
      deviceId: "device-current",
      runtimeLane: "dev-local",
      store,
      userId: "owner-1",
    });

    const result = await listLocalRuntimesUseCase({
      store,
      userId: "owner-1",
    });

    expect(result.currentConnectedComputerId).toBe("computer_generated_1");
    expect(result.localRuntimes).toHaveLength(1);
    expect(result.localRuntimes[0]).toMatchObject({
      connectedComputerId: "computer_generated_1",
      connectionStatus: "connected",
      deviceId: "device-current",
      legacyDeviceIds: ["device-current"],
    });
    expect(store.readConnectedComputerIdsForTest("owner-1")).toEqual([
      "computer_generated_1",
    ]);
  });

  it("does not create connected computer identity from plain current-device writes", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      nextConnectedComputerIds: ["computer_should_not_exist"],
    });

    await seedCurrentDeviceTarget({
      deviceId: "device-current",
      runtimeLane: "dev-local",
      store,
      userId: "owner-1",
    });

    const result = await listLocalRuntimesUseCase({
      store,
      userId: "owner-1",
    });

    expect(result.currentConnectedComputerId).toBeNull();
    expect(result.localRuntimes).toHaveLength(1);
    expect(result.localRuntimes[0]?.connectedComputerId).toBeUndefined();
    expect(store.readConnectedComputerIdsForTest("owner-1")).toEqual([]);
  });

  it("reuses verified local enrollment evidence during setup", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      connectedComputerIdsByUserId: {
        "owner-1": ["computer_existing"],
      },
      nextConnectedComputerIds: ["computer_should_not_be_created"],
    });

    await seedCurrentDeviceTarget({
      activationSource: "local_setup",
      connectedComputerId: "computer_existing",
      deviceId: "device-new-home",
      runtimeLane: "dev-local",
      store,
      userId: "owner-1",
    });

    const result = await listLocalRuntimesUseCase({
      store,
      userId: "owner-1",
    });

    expect(result.currentConnectedComputerId).toBe("computer_existing");
    expect(result.localRuntimes[0]).toMatchObject({
      connectedComputerId: "computer_existing",
      deviceId: "device-new-home",
    });
    expect(store.readConnectedComputerIdsForTest("owner-1")).toEqual([
      "computer_existing",
    ]);
  });

  it("moves a rotated device identity back to the explicitly selected computer", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      connectedComputerIdsByUserId: {
        "owner-1": ["computer-existing", "computer-duplicate"],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            connectedComputerId: "computer-duplicate",
            deviceId: "device-rotated",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });

    await expect(
      enrollLocalSetupDeviceUseCase({
        connectedComputerId: "computer-existing",
        deviceId: "device-rotated",
        runtimeLane: "dev-local",
        store,
        userId: "owner-1",
      })
    ).resolves.toMatchObject({
      connectedComputerId: "computer-existing",
      deviceId: "device-rotated",
    });

    const result = await listLocalRuntimesUseCase({
      store,
      userId: "owner-1",
    });
    expect(result.localRuntimes).toHaveLength(1);
    expect(result.localRuntimes[0]).toMatchObject({
      connectedComputerId: "computer-existing",
      deviceId: "device-rotated",
    });
  });

  it("fails closed when setup carries unknown local enrollment evidence", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      nextConnectedComputerIds: ["computer_should_not_be_created"],
    });

    await expect(
      enrollLocalSetupDeviceUseCase({
        connectedComputerId: "computer_missing",
        deviceId: "device-new-home",
        runtimeLane: "dev-local",
        store,
        userId: "owner-1",
      })
    ).rejects.toBeInstanceOf(ConnectedComputerEnrollmentInvalidError);

    expect(store.readConnectedComputerIdsForTest("owner-1")).toEqual([]);
  });

  it("does not change current target or owned devices when setup carries invalid local enrollment evidence", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      connectedComputerIdsByUserId: {
        "owner-1": ["computer_existing"],
      },
      nextConnectedComputerIds: ["computer_should_not_be_created"],
    });
    await seedCurrentDeviceTarget({
      activationSource: "local_setup",
      connectedComputerId: "computer_existing",
      deviceId: "device-existing",
      runtimeLane: "dev-local",
      store,
      userId: "owner-1",
    });

    await expect(
      enrollLocalSetupDeviceUseCase({
        connectedComputerId: "computer_missing",
        deviceId: "device-new-home",
        runtimeLane: "dev-local",
        store,
        userId: "owner-1",
      })
    ).rejects.toBeInstanceOf(ConnectedComputerEnrollmentInvalidError);

    await expect(
      getCurrentDeviceTargetUseCase({
        store,
        userId: "owner-1",
      })
    ).resolves.toEqual({
      availability: "resolved",
      deviceId: "device-existing",
      runtimeLane: "dev-local",
    });
    await expect(
      store.readOwnedDevices({
        userId: "owner-1",
      })
    ).resolves.toEqual([
      expect.objectContaining({
        connectedComputerId: "computer_existing",
        deviceId: "device-existing",
      }),
    ]);

    const localRuntimes = await listLocalRuntimesUseCase({
      store,
      userId: "owner-1",
    });
    expect(
      localRuntimes.localRuntimes.some(
        (runtime) => runtime.deviceId === "device-new-home"
      )
    ).toBe(false);
    expect(
      localRuntimes.legacyDeviceEvidence?.some(
        (runtime) => runtime.deviceId === "device-new-home"
      )
    ).toBe(false);
    expect(store.readConnectedComputerIdsForTest("owner-1")).toEqual([
      "computer_existing",
    ]);
  });

  it("reports ready only when the current local runtime and owner service session are aligned", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      getCurrentLocalRuntimeReplyReadinessUseCase({
        lookupOwnerService: () =>
          Promise.resolve({
            online: true,
            sessions: [
              {
                capabilities: {
                  localComponents: CURRENT_LOCAL_COMPONENTS_STATUS,
                },
                connectionGeneration: 1,
                daemonSessionId: "daemon-session-1",
                deviceId: "device-owner-1",
                executionCompatibility: COMPATIBLE_SERVICE,
                lane: "dev-local",
                lastHeartbeatMs: Date.parse("2026-04-10T00:05:00.000Z"),
                serviceVersion: "999.0.0",
              },
            ],
          }),
        now: new Date("2026-04-10T00:10:00.000Z"),
        store,
        userId: "owner-1",
      })
    ).resolves.toMatchObject({
      canReplyFromThisComputer: true,
      localComponents: {
        cli: {
          installedPackageVersion:
            CURRENT_RELEASE_MANIFEST.components.cli.packageVersion,
          status: "current",
        },
        skills: {
          status: "current",
          targetCount:
            CURRENT_RELEASE_MANIFEST.components.skills.skillIds.length,
        },
      },
      nextAction: "none",
      primaryBlocker: "none",
      service: {
        connected: true,
        matchingCurrentRuntime: true,
      },
      status: "ready",
    });
  });

  it.each([
    {
      description:
        "keeps an incomplete local-agent check blocked without sending the member through setup",
      expectedNextAction: "check_status" as const,
      expectedExecutionTargetStatus: "partial" as const,
      failedReasonCodes: ["controller.interface.check_failed"],
      includeReadyController: true,
      readyReasonCodes: ["runtime.agent_controller_report.ready"],
    },
    {
      description:
        "ignores diagnostic reason codes from ready local agents when another check is retryable",
      expectedNextAction: "check_status" as const,
      expectedExecutionTargetStatus: "partial" as const,
      failedReasonCodes: ["controller.interface.check_failed"],
      includeReadyController: true,
      readyReasonCodes: ["runtime.ready"],
    },
    {
      description:
        "keeps an entirely not-ready set of retryable local-agent checks out of setup",
      expectedNextAction: "check_status" as const,
      expectedExecutionTargetStatus: "not_ready" as const,
      failedReasonCodes: ["controller.interface.check_failed"],
      includeReadyController: false,
      readyReasonCodes: [],
    },
    {
      description:
        "keeps setup guidance when an incomplete check also has real repair evidence",
      expectedNextAction: "run_setup" as const,
      expectedExecutionTargetStatus: "partial" as const,
      failedReasonCodes: [
        "controller.interface.check_failed",
        "controller.interface.error",
      ],
      includeReadyController: true,
      readyReasonCodes: ["runtime.agent_controller_report.ready"],
    },
  ])("$description", async ({
    expectedExecutionTargetStatus,
    expectedNextAction,
    failedReasonCodes,
    includeReadyController,
    readyReasonCodes,
  }) => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          ...(includeReadyController
            ? [
                {
                  agentControllerRef: "builtin:codex",
                  capabilityReasonCodes: readyReasonCodes,
                  capabilityStatus: "ready" as const,
                  deviceId: "device-owner-1",
                  lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
                  openMeldServiceRuntimeId:
                    "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
                  runtimeLane: "dev-local" as const,
                },
              ]
            : []),
          {
            agentControllerRef: "builtin:claude-code",
            capabilityReasonCodes: failedReasonCodes,
            capabilityStatus: "not_ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      getCurrentLocalRuntimeReplyReadinessUseCase({
        lookupOwnerService: () =>
          Promise.resolve({
            online: true,
            sessions: [
              {
                capabilities: {
                  localComponents: CURRENT_LOCAL_COMPONENTS_STATUS,
                },
                connectionGeneration: 1,
                daemonSessionId: "daemon-session-1",
                deviceId: "device-owner-1",
                executionCompatibility: COMPATIBLE_SERVICE,
                lane: "dev-local",
                lastHeartbeatMs: Date.parse("2026-04-10T00:05:00.000Z"),
                serviceVersion: "999.0.0",
              },
            ],
          }),
        now: new Date("2026-04-10T00:10:00.000Z"),
        store,
        userId: "owner-1",
      })
    ).resolves.toMatchObject({
      canReplyFromThisComputer: false,
      nextAction: expectedNextAction,
      primaryBlocker: "agent_controller_report_not_ready",
      runtime: {
        executionTargetStatus: expectedExecutionTargetStatus,
        reasonCodes: [
          ...(includeReadyController ? readyReasonCodes : []),
          ...failedReasonCodes,
        ],
      },
      status: "blocked",
    });
  });

  it("marks the runtime projection as sign-in-only when every not-ready capability only needs authentication", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:claude-code",
            capabilityEnabled: true,
            capabilityReasonCodes: ["controller.auth.unauthenticated"],
            capabilityStatus: "not_ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
          {
            agentControllerRef: "builtin:codex",
            capabilityEnabled: true,
            capabilityReasonCodes: ["controller.auth.unauthenticated"],
            capabilityStatus: "not_ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      getCurrentLocalRuntimeReplyReadinessUseCase({
        lookupOwnerService: () =>
          Promise.resolve({
            online: true,
            sessions: [
              {
                capabilities: {
                  localComponents: CURRENT_LOCAL_COMPONENTS_STATUS,
                },
                connectionGeneration: 1,
                daemonSessionId: "daemon-session-1",
                deviceId: "device-owner-1",
                executionCompatibility: COMPATIBLE_SERVICE,
                lane: "dev-local",
                lastHeartbeatMs: Date.parse("2026-04-10T00:05:00.000Z"),
                serviceVersion: "999.0.0",
              },
            ],
          }),
        now: new Date("2026-04-10T00:10:00.000Z"),
        store,
        userId: "owner-1",
      })
    ).resolves.toMatchObject({
      nextAction: "run_setup",
      runtime: {
        reasonCodes: ["controller.auth.unauthenticated"],
        signInOnlyBlockers: true,
      },
    });
  });

  it("keeps mixed real failures out of the sign-in-only projection", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:claude-code",
            capabilityEnabled: true,
            capabilityReasonCodes: ["controller.auth.unauthenticated"],
            capabilityStatus: "not_ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
          {
            agentControllerRef: "builtin:codex",
            capabilityEnabled: true,
            capabilityReasonCodes: ["controller.interface.check_failed"],
            capabilityStatus: "not_ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      getCurrentLocalRuntimeReplyReadinessUseCase({
        lookupOwnerService: () =>
          Promise.resolve({
            online: true,
            sessions: [
              {
                capabilities: {
                  localComponents: CURRENT_LOCAL_COMPONENTS_STATUS,
                },
                connectionGeneration: 1,
                daemonSessionId: "daemon-session-1",
                deviceId: "device-owner-1",
                executionCompatibility: COMPATIBLE_SERVICE,
                lane: "dev-local",
                lastHeartbeatMs: Date.parse("2026-04-10T00:05:00.000Z"),
                serviceVersion: "999.0.0",
              },
            ],
          }),
        now: new Date("2026-04-10T00:10:00.000Z"),
        store,
        userId: "owner-1",
      })
    ).resolves.toMatchObject({
      nextAction: "run_setup",
      runtime: {
        signInOnlyBlockers: false,
      },
    });
  });

  it("excludes a disabled local-agent failure from current-computer reply readiness", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityEnabled: true,
            capabilityReasonCodes: ["runtime.agent_controller_report.ready"],
            capabilityStatus: "ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
          {
            agentControllerRef: "builtin:claude-code",
            capabilityEnabled: false,
            capabilityReasonCodes: ["local_agent_preparation.not_enabled"],
            capabilityStatus: "not_ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      getCurrentLocalRuntimeReplyReadinessUseCase({
        lookupOwnerService: () =>
          Promise.resolve({
            online: true,
            sessions: [
              {
                capabilities: {
                  localComponents: CURRENT_LOCAL_COMPONENTS_STATUS,
                },
                connectionGeneration: 1,
                daemonSessionId: "daemon-session-1",
                deviceId: "device-owner-1",
                executionCompatibility: COMPATIBLE_SERVICE,
                lane: "dev-local",
                lastHeartbeatMs: Date.parse("2026-04-10T00:05:00.000Z"),
                serviceVersion: "999.0.0",
              },
            ],
          }),
        now: new Date("2026-04-10T00:10:00.000Z"),
        store,
        userId: "owner-1",
      })
    ).resolves.toMatchObject({
      canReplyFromThisComputer: true,
      nextAction: "none",
      primaryBlocker: "none",
      runtime: {
        executionTargetStatus: "ready",
        reasonCodes: ["runtime.agent_controller_report.ready"],
      },
      status: "ready",
    });

    await expect(
      listLocalRuntimesUseCase({ store, userId: "owner-1" })
    ).resolves.toMatchObject({
      localRuntimes: [
        {
          executionTargets: [
            {
              capabilities: expect.arrayContaining([
                expect.objectContaining({
                  agentControllerRef: "builtin:claude-code",
                  enabled: false,
                  status: "not_ready",
                }),
              ]),
            },
          ],
        },
      ],
    });
  });

  it("keeps an enabled check failure retryable when another local agent is disabled", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:grok-build",
            capabilityEnabled: true,
            capabilityReasonCodes: ["controller.interface.check_failed"],
            capabilityStatus: "not_ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
          {
            agentControllerRef: "builtin:claude-code",
            capabilityEnabled: false,
            capabilityReasonCodes: ["local_agent_preparation.not_enabled"],
            capabilityStatus: "not_ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      getCurrentLocalRuntimeReplyReadinessUseCase({
        lookupOwnerService: () =>
          Promise.resolve({
            online: true,
            sessions: [
              {
                capabilities: {
                  localComponents: CURRENT_LOCAL_COMPONENTS_STATUS,
                },
                connectionGeneration: 1,
                daemonSessionId: "daemon-session-1",
                deviceId: "device-owner-1",
                executionCompatibility: COMPATIBLE_SERVICE,
                lane: "dev-local",
                lastHeartbeatMs: Date.parse("2026-04-10T00:05:00.000Z"),
                serviceVersion: "999.0.0",
              },
            ],
          }),
        now: new Date("2026-04-10T00:10:00.000Z"),
        store,
        userId: "owner-1",
      })
    ).resolves.toMatchObject({
      canReplyFromThisComputer: false,
      nextAction: "check_status",
      primaryBlocker: "agent_controller_report_not_ready",
      runtime: {
        executionTargetStatus: "not_ready",
        reasonCodes: ["controller.interface.check_failed"],
      },
      status: "blocked",
    });
  });

  it.each([
    "ready",
    "not_ready",
  ] as const)("keeps an all-disabled computer quiet when its hidden capability is %s", async (capabilityStatus) => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:claude-code",
            capabilityEnabled: false,
            capabilityReasonCodes: ["local_agent_preparation.not_enabled"],
            capabilityStatus,
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      getCurrentLocalRuntimeReplyReadinessUseCase({
        lookupOwnerService: () =>
          Promise.resolve({
            online: true,
            sessions: [
              {
                capabilities: {
                  localComponents: CURRENT_LOCAL_COMPONENTS_STATUS,
                },
                connectionGeneration: 1,
                daemonSessionId: "daemon-session-1",
                deviceId: "device-owner-1",
                executionCompatibility: COMPATIBLE_SERVICE,
                lane: "dev-local",
                lastHeartbeatMs: Date.parse("2026-04-10T00:05:00.000Z"),
                serviceVersion: "999.0.0",
              },
            ],
          }),
        now: new Date("2026-04-10T00:10:00.000Z"),
        store,
        userId: "owner-1",
      })
    ).resolves.toMatchObject({
      canReplyFromThisComputer: false,
      message: "All local agents on this computer are turned off.",
      nextAction: "none",
      primaryBlocker: "agent_controller_report_not_ready",
      runtime: {
        executionTargetStatus: "not_ready",
        reasonCodes: ["local_agent_preparation.not_enabled"],
      },
      status: "blocked",
    });
  });

  it("reports a connected computer as ready from ServiceRuntime liveness even before any Agent Profile is bound", async () => {
    // Regression: a freshly connected computer (OpenMeld Service + local agents up)
    // has no enabled-primary Binding yet, so the Binding-derived current-device
    // pointer is "missing". Connectivity is a ServiceRuntime heartbeat fact
    // (agent-transport-contract.md, "Service Online Evidence"), so reply-readiness
    // must report this computer connected, not "Set up this computer".
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    // Intentionally NOT seeding a current device target: no Binding exists.

    await expect(
      getCurrentLocalRuntimeReplyReadinessUseCase({
        lookupOwnerService: () =>
          Promise.resolve({
            online: true,
            sessions: [
              {
                capabilities: {},
                connectionGeneration: 1,
                daemonSessionId: "daemon-session-1",
                deviceId: "device-owner-1",
                executionCompatibility: COMPATIBLE_SERVICE,
                lane: "dev-local",
                lastHeartbeatMs: Date.parse("2026-04-10T00:05:00.000Z"),
                serviceVersion: "999.0.0",
              },
            ],
          }),
        now: new Date("2026-04-10T00:10:00.000Z"),
        store,
        userId: "owner-1",
      })
    ).resolves.toMatchObject({
      canReplyFromThisComputer: true,
      currentTarget: {
        availability: "resolved",
        deviceId: "device-owner-1",
        runtimeLane: "dev-local",
      },
      nextAction: "none",
      primaryBlocker: "none",
      service: {
        connected: true,
        matchingCurrentRuntime: true,
      },
      status: "ready",
    });
  });

  it("still reports missing when there is no Binding and no live ServiceRuntime session", async () => {
    // Without a Binding AND without a fresh ServiceRuntime heartbeat there is no
    // connectivity evidence, so the computer is genuinely not connected.
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });

    await expect(
      getCurrentLocalRuntimeReplyReadinessUseCase({
        lookupOwnerService: () =>
          Promise.resolve({
            online: false,
            reasonCode: "daemon.profile.offline",
          }),
        now: new Date("2026-04-10T00:10:00.000Z"),
        store,
        userId: "owner-1",
      })
    ).resolves.toMatchObject({
      canReplyFromThisComputer: false,
      currentTarget: { availability: "missing" },
      nextAction: "connect_service",
      primaryBlocker: "current_runtime_missing",
      status: "blocked",
    });
  });

  it("keeps current local runtime readiness ready when the matching OpenMeld Service session is online but registry freshness is stale", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: ["runtime.agent_controller_report.ready"],
            capabilityStatus: "stale",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      getCurrentLocalRuntimeReplyReadinessUseCase({
        lookupOwnerService: () =>
          Promise.resolve({
            online: true,
            sessions: [
              {
                capabilities: {},
                connectionGeneration: 7,
                daemonSessionId: "daemon-session-1",
                deviceId: "device-owner-1",
                executionCompatibility: COMPATIBLE_SERVICE,
                lane: "dev-local",
                lastHeartbeatMs: Date.parse("2026-04-10T00:12:00.000Z"),
                serviceVersion: "999.0.0",
              },
            ],
          }),
        now: new Date("2026-04-10T00:13:00.000Z"),
        store,
        userId: "owner-1",
      })
    ).resolves.toMatchObject({
      canReplyFromThisComputer: true,
      nextAction: "none",
      primaryBlocker: "none",
      runtime: {
        executionTargetStatus: "stale",
        reasonCodes: ["runtime.agent_controller_report.ready"],
      },
      service: {
        connected: true,
        matchingCurrentRuntime: true,
      },
      status: "ready",
    });
  });

  it("blocks current local runtime readiness when a required Service update lacks version evidence", async () => {
    useRequiredServiceUpdatePolicy();

    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      getCurrentLocalRuntimeReplyReadinessUseCase({
        lookupOwnerService: () =>
          Promise.resolve({
            online: true,
            sessions: [
              {
                capabilities: {},
                connectionGeneration: 1,
                daemonSessionId: "daemon-session-1",
                deviceId: "device-owner-1",
                executionCompatibility: COMPATIBLE_SERVICE,
                lane: "dev-local",
                lastHeartbeatMs: Date.parse("2026-04-10T00:05:00.000Z"),
              },
            ],
          }),
        now: new Date("2026-04-10T00:10:00.000Z"),
        store,
        userId: "owner-1",
      })
    ).resolves.toMatchObject({
      canReplyFromThisComputer: false,
      localComponents: {
        service: {
          reasonCodes: ["service.version_not_reported"],
          status: "update_required",
          wakeBlocked: true,
        },
        setupAction: "update_service",
      },
      nextAction: "update_service",
      primaryBlocker: "service_update_required",
      status: "blocked",
    });
  });

  it("blocks current local runtime readiness when OpenMeld Service is connected to a different computer", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      getCurrentLocalRuntimeReplyReadinessUseCase({
        lookupOwnerService: () =>
          Promise.resolve({
            online: true,
            sessions: [
              {
                capabilities: {},
                connectionGeneration: 1,
                daemonSessionId: "daemon-session-1",
                deviceId: "device-owner-2",
                executionCompatibility: COMPATIBLE_SERVICE,
                lane: "dev-local",
                lastHeartbeatMs: Date.parse("2026-04-10T00:05:00.000Z"),
              },
            ],
          }),
        now: new Date("2026-04-10T00:10:00.000Z"),
        store,
        userId: "owner-1",
      })
    ).resolves.toMatchObject({
      canReplyFromThisComputer: false,
      nextAction: "reconnect_service",
      primaryBlocker: "service_not_connected",
      service: {
        connected: false,
        matchingCurrentRuntime: false,
        reasonCodes: ["service.current_runtime_session_missing"],
      },
      status: "blocked",
    });
  });

  it("lists execution targets by device, lane, command, and runtime authority", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: ["runtime.ready"],
            capabilityStatus: "ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "canary",
          },
          {
            agentControllerRef: "builtin:claude-code",
            capabilityReasonCodes: ["service.not_running"],
            capabilityStatus: "not_ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:06:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "canary",
          },
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: ["runtime.agent_controller_report_stale"],
            capabilityStatus: "stale",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:01:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D5",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });

    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "canary",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    const result = await listLocalRuntimesUseCase({
      store,
      userId: "owner-1",
    });

    expect(result.localRuntimes[0]?.executionTargets).toEqual([
      expect.objectContaining({
        isCurrent: true,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
        runtimeLane: "canary",
        status: "partial",
        userFacingCommand: "openmeld-canary",
      }),
      expect.objectContaining({
        isCurrent: false,
        runtimeLane: "dev-local",
        status: "stale",
        userFacingCommand: "openmeld-dev",
      }),
    ]);
  });

  it("does not mark a ready execution target as missing when the agent controller report has no reason codes", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      executionTargetsByUserId: {
        "owner-1": [
          {
            agentControllerRef: "builtin:codex",
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "device-owner-1",
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            runtimeLane: "dev-local",
          },
        ],
      },
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-owner-1",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });

    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    const result = await listLocalRuntimesUseCase({
      store,
      userId: "owner-1",
    });

    expect(result.localRuntimes[0]?.executionTargets[0]).toMatchObject({
      reasonCodes: [],
      status: "ready",
    });
  });

  it("uses observed metadata when it exists", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      ownedDevicesByUserId: {
        "owner-1": [
          {
            ownerUserId: "owner-1",
            deviceId: "device-owner-1",
            observedDisplayName: "Felix's MacBook Pro",
            userDisplayName: null,
            platformFamily: "macOS",
            osVersion: "15.0",
            deviceType: "laptop",
            firstSeenAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
            updatedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
          },
        ],
      },
    });

    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      listLocalRuntimesUseCase({
        store,
        userId: "owner-1",
      })
    ).resolves.toEqual({
      currentConnectedComputerId: null,
      currentDeviceId: "device-owner-1",
      currentRuntimeLane: "dev-local",
      legacyDeviceEvidence: [],
      localRuntimes: [
        {
          deviceId: "device-owner-1",
          deviceDisplayName: "Felix's MacBook Pro",
          deviceDisplayNameSource: "observed",
          platformFamily: "macOS",
          osVersion: "15.0",
          deviceType: "laptop",
          firstSeenAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
          lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
          isCurrent: true,
          executionTargets: [],
        },
      ],
    });
  });

  it("uses the user display name when the owner renames a computer", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      ownedDevicesByUserId: {
        "owner-1": [
          {
            ownerUserId: "owner-1",
            deviceId: "device-owner-1",
            observedDisplayName: "Felix's MacBook Pro",
            userDisplayName: null,
            platformFamily: "macOS",
            osVersion: "15.0",
            deviceType: "laptop",
            firstSeenAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
            updatedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
          },
        ],
      },
    });

    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      setLocalRuntimeDisplayNameUseCase({
        store,
        userId: "owner-1",
        deviceId: "device-owner-1",
        displayName: "  Office MacBook  ",
        now: new Date("2026-04-10T00:10:00.000Z"),
      })
    ).resolves.toEqual({
      currentConnectedComputerId: null,
      currentDeviceId: "device-owner-1",
      currentRuntimeLane: "dev-local",
      legacyDeviceEvidence: [],
      localRuntimes: [
        {
          deviceId: "device-owner-1",
          deviceDisplayName: "Office MacBook",
          deviceDisplayNameSource: "user",
          platformFamily: "macOS",
          osVersion: "15.0",
          deviceType: "laptop",
          firstSeenAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
          lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
          isCurrent: true,
          executionTargets: [],
        },
      ],
    });
  });

  it("clears the user display name and falls back to observed metadata", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      ownedDevicesByUserId: {
        "owner-1": [
          {
            ownerUserId: "owner-1",
            deviceId: "device-owner-1",
            observedDisplayName: "Felix's MacBook Pro",
            userDisplayName: "Office MacBook",
            platformFamily: "macOS",
            osVersion: "15.0",
            deviceType: "laptop",
            firstSeenAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
            updatedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
            lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
          },
        ],
      },
    });

    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-owner-1",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      setLocalRuntimeDisplayNameUseCase({
        store,
        userId: "owner-1",
        deviceId: "device-owner-1",
        displayName: null,
        now: new Date("2026-04-10T00:10:00.000Z"),
      })
    ).resolves.toEqual({
      currentConnectedComputerId: null,
      currentDeviceId: "device-owner-1",
      currentRuntimeLane: "dev-local",
      legacyDeviceEvidence: [],
      localRuntimes: [
        {
          deviceId: "device-owner-1",
          deviceDisplayName: "Felix's MacBook Pro",
          deviceDisplayNameSource: "observed",
          platformFamily: "macOS",
          osVersion: "15.0",
          deviceType: "laptop",
          firstSeenAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
          lastObservedAtMs: Date.parse("2026-04-10T00:05:00.000Z"),
          isCurrent: true,
          executionTargets: [],
        },
      ],
    });
  });

  it("creates a placeholder row before renaming a fresh computer", async () => {
    const store = createInMemoryCurrentDeviceTargetStore();

    await expect(
      setLocalRuntimeDisplayNameUseCase({
        store,
        userId: "owner-1",
        deviceId: "device-fresh",
        displayName: "Fresh Laptop",
        now: new Date("2026-04-10T00:10:00.000Z"),
      })
    ).resolves.toEqual({
      currentConnectedComputerId: null,
      currentDeviceId: null,
      currentRuntimeLane: null,
      legacyDeviceEvidence: [],
      localRuntimes: [
        {
          deviceId: "device-fresh",
          deviceDisplayName: "Fresh Laptop",
          deviceDisplayNameSource: "user",
          platformFamily: "Unknown",
          osVersion: null,
          deviceType: "unknown",
          firstSeenAtMs: Date.parse("2026-04-10T00:10:00.000Z"),
          lastObservedAtMs: null,
          isCurrent: false,
          executionTargets: [],
        },
      ],
    });
  });

  it("uses the unnamed computer placeholder for a non-current device without metadata", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      ownedDevicesByUserId: {
        "owner-1": [
          {
            ownerUserId: "owner-1",
            deviceId: "device-current",
            observedDisplayName: null,
            userDisplayName: null,
            platformFamily: null,
            osVersion: null,
            deviceType: null,
            firstSeenAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
            updatedAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
            lastObservedAtMs: null,
          },
          {
            ownerUserId: "owner-1",
            deviceId: "device-other",
            observedDisplayName: null,
            userDisplayName: null,
            platformFamily: null,
            osVersion: null,
            deviceType: null,
            firstSeenAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
            updatedAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
            lastObservedAtMs: null,
          },
        ],
      },
    });

    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-current",
      runtimeLane: "dev-local",
      now: new Date("2026-04-10T00:00:00.000Z"),
    });

    await expect(
      listLocalRuntimesUseCase({
        store,
        userId: "owner-1",
      })
    ).resolves.toEqual({
      currentConnectedComputerId: null,
      currentDeviceId: "device-current",
      currentRuntimeLane: "dev-local",
      legacyDeviceEvidence: [],
      localRuntimes: [
        {
          deviceId: "device-current",
          deviceDisplayName: "This computer",
          deviceDisplayNameSource: "placeholder",
          platformFamily: "Unknown",
          osVersion: null,
          deviceType: "unknown",
          firstSeenAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
          lastObservedAtMs: null,
          isCurrent: true,
          executionTargets: [],
        },
        {
          deviceId: "device-other",
          deviceDisplayName: "Unnamed computer",
          deviceDisplayNameSource: "placeholder",
          platformFamily: "Unknown",
          osVersion: null,
          deviceType: "unknown",
          firstSeenAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
          lastObservedAtMs: null,
          isCurrent: false,
          executionTargets: [],
        },
      ],
    });
  });

  it("forgets the current computer without deleting other computers", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-current",
            ownerUserId: "owner-1",
          }),
          createOwnedDeviceRecord({
            deviceId: "device-other",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-current",
      runtimeLane: "dev-local",
    });

    await expect(
      forgetCurrentComputerUseCase({
        store,
        userId: "owner-1",
        now: new Date("2026-04-10T00:00:00.000Z"),
      })
    ).resolves.toMatchObject({
      status: "forgotten",
      forgottenDeviceId: "device-current",
      currentDeviceTarget: {
        availability: "missing",
      },
    });
  });

  it("forgets a non-current owned computer without changing the current computer", async () => {
    const store = createInMemoryCurrentDeviceTargetStore({
      ownedDevicesByUserId: {
        "owner-1": [
          createOwnedDeviceRecord({
            deviceId: "device-current",
            ownerUserId: "owner-1",
          }),
          createOwnedDeviceRecord({
            deviceId: "device-other",
            ownerUserId: "owner-1",
          }),
        ],
      },
    });
    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-current",
      runtimeLane: "dev-local",
    });

    await expect(
      forgetComputerUseCase({
        store,
        userId: "owner-1",
        deviceId: "device-other",
        now: new Date("2026-04-10T00:00:00.000Z"),
      })
    ).resolves.toMatchObject({
      status: "forgotten",
      forgottenDeviceId: "device-other",
      currentDeviceTarget: {
        availability: "resolved",
        deviceId: "device-current",
        runtimeLane: "dev-local",
      },
    });
  });

  it("returns already_missing when there is no current computer to forget", async () => {
    const store = createInMemoryCurrentDeviceTargetStore();

    await expect(
      forgetCurrentComputerUseCase({
        store,
        userId: "owner-1",
      })
    ).resolves.toEqual({
      status: "already_missing",
      forgottenDeviceId: null,
      currentDeviceTarget: {
        availability: "missing",
      },
    });
  });

  it("reactivates a forgotten computer through local setup enrollment", async () => {
    const store = createInMemoryCurrentDeviceTargetStore();
    await seedCurrentDeviceTarget({
      store,
      userId: "owner-1",
      deviceId: "device-current",
      runtimeLane: "dev-local",
    });
    await forgetCurrentComputerUseCase({
      store,
      userId: "owner-1",
    });

    await expect(
      store.readForgottenDevice({
        userId: "owner-1",
        deviceId: "device-current",
      })
    ).resolves.toEqual({ deviceId: "device-current" });

    await expect(
      enrollLocalSetupDeviceUseCase({
        store,
        userId: "owner-1",
        deviceId: "device-current",
        runtimeLane: "dev-local",
      })
    ).resolves.toEqual({
      connectedComputerId: "computer_device-current",
      deviceId: "device-current",
      runtimeLane: "dev-local",
    });
    await expect(
      store.readForgottenDevice({
        userId: "owner-1",
        deviceId: "device-current",
      })
    ).resolves.toBeNull();
  });
});

async function seedCurrentDeviceTarget(input: {
  store: ReturnType<typeof createInMemoryCurrentDeviceTargetStore>;
  userId: string;
  deviceId: string;
  connectedComputerId?: string;
  runtimeLane: "prod" | "dev-local" | "canary";
  activationSource?: "local_setup";
  writeMode?: "replace" | "if_missing";
  now?: Date;
}): Promise<{
  availability: "resolved";
  deviceId: string;
  runtimeLane: "prod" | "dev-local" | "canary";
  connectedComputerId?: string;
}> {
  const updatedAtMs = (input.now ?? new Date()).getTime();
  if (input.writeMode === "if_missing") {
    await input.store.createCurrentDeviceTargetIfMissing({
      userId: input.userId,
      deviceId: input.deviceId,
      runtimeLane: input.runtimeLane,
      updatedAtMs,
    });
  } else {
    await input.store.replaceCurrentDeviceTarget({
      userId: input.userId,
      deviceId: input.deviceId,
      runtimeLane: input.runtimeLane,
      updatedAtMs,
    });
  }
  const resolved = await input.store.readCurrentDeviceTarget({
    userId: input.userId,
  });
  if (resolved.availability !== "resolved") {
    throw new Error("seedCurrentDeviceTarget: target not seeded");
  }
  await ensureOwnedDevicePlaceholderUseCase({
    store: input.store,
    userId: input.userId,
    deviceId: resolved.deviceId,
    now: input.now,
  });
  if (input.activationSource === "local_setup") {
    const connected = await input.store.connectCurrentDeviceIdentity({
      userId: input.userId,
      deviceId: resolved.deviceId,
      ...(input.connectedComputerId
        ? { requestedConnectedComputerId: input.connectedComputerId }
        : {}),
      runtimeLane: resolved.runtimeLane,
      connectedAtMs: updatedAtMs,
    });
    if (connected.status !== "connected") {
      throw new Error(
        `seedCurrentDeviceTarget: enrollment failed for ${connected.requestedConnectedComputerId}`
      );
    }
    return {
      ...resolved,
      connectedComputerId: connected.connectedComputerId,
    };
  }
  return resolved;
}

function createInMemoryCurrentDeviceTargetStore(input?: {
  executionTargetsByUserId?: Record<
    string,
    {
      agentControllerRef: string | null;
      agentControllerInterface?: AgentControllerInterfaceSnapshot | null;
      capabilityEnabled?: boolean;
      capabilityReasonCodes: readonly string[];
      capabilityStatus: "ready" | "not_ready" | "stale" | "unknown";
      deviceId: string;
      lastObservedAtMs: number | null;
      openMeldServiceRuntimeId: string;
      runtimeLane: "prod" | "dev-local" | "canary";
    }[]
  >;
  nextConnectedComputerIds?: string[];
  connectedComputerIdsByUserId?: Record<string, string[]>;
  ownedDevicesByUserId?: Record<string, OwnedDeviceRegistryRecord[]>;
}): {
  readCurrentDeviceTarget(input: { userId: string }): Promise<
    | {
        availability: "missing";
      }
    | {
        availability: "resolved";
        deviceId: string;
        runtimeLane: "prod" | "dev-local" | "canary";
      }
  >;
  replaceCurrentDeviceTarget(input: {
    userId: string;
    deviceId: string;
    runtimeLane: "prod" | "dev-local" | "canary";
    updatedAtMs: number;
  }): Promise<void>;
  createCurrentDeviceTargetIfMissing(input: {
    userId: string;
    deviceId: string;
    runtimeLane: "prod" | "dev-local" | "canary";
    updatedAtMs: number;
  }): Promise<void>;
  connectCurrentDeviceIdentity(input: {
    userId: string;
    deviceId: string;
    requestedConnectedComputerId?: string;
    runtimeLane: "prod" | "dev-local" | "canary";
    connectedAtMs: number;
  }): Promise<
    | { status: "connected"; connectedComputerId: string }
    | { status: "requested_not_found"; requestedConnectedComputerId: string }
  >;
  readConnectedComputerIdentity(input: {
    userId: string;
    connectedComputerId: string;
  }): Promise<{ connectedComputerId: string } | null>;
  readConnectedComputerIdsForTest(userId: string): string[];
  readOwnedDevices(input: { userId: string }): Promise<
    readonly {
      deviceId: string;
      connectedComputerId?: string | null;
      userDisplayName?: string | null;
      observedDisplayName?: string | null;
      platformFamily?: "macOS" | "Windows" | "Linux" | "Unknown" | null;
      osVersion?: string | null;
      deviceType?: "laptop" | "desktop" | "server" | "unknown" | null;
      firstSeenAtMs: number;
      lastObservedAtMs: number | null;
    }[]
  >;
  readOwnedDeviceExecutionTargets(input: {
    nowMs: number;
    userId: string;
  }): Promise<
    readonly {
      agentControllerRef: string | null;
      agentControllerInterface?: AgentControllerInterfaceSnapshot | null;
      capabilityEnabled: boolean;
      capabilityReasonCodes: readonly string[];
      capabilityStatus: "ready" | "not_ready" | "stale" | "unknown";
      deviceId: string;
      lastObservedAtMs: number | null;
      openMeldServiceRuntimeId: string;
      runtimeLane: "prod" | "dev-local" | "canary";
    }[]
  >;
  readOwnedDeviceRegistryRecord(input: {
    userId: string;
    deviceId: string;
  }): Promise<OwnedDeviceRegistryRecord | null>;
  upsertOwnedDeviceRegistryRecord(input: {
    record: OwnedDeviceRegistryRecord;
  }): Promise<void>;
  readForgottenDevice(input: {
    userId: string;
    deviceId: string;
  }): Promise<{ deviceId: string } | null>;
  deleteForgottenDevice(input: {
    userId: string;
    deviceId: string;
  }): Promise<void>;
  forgetCurrentComputer(input: {
    userId: string;
    forgottenAtMs: number;
  }): Promise<
    | {
        status: "forgotten";
        forgottenDeviceId: string;
      }
    | {
        status: "already_missing";
        forgottenDeviceId: null;
      }
  >;
  forgetComputer(input: {
    userId: string;
    deviceId: string;
    forgottenAtMs: number;
  }): Promise<
    | {
        status: "forgotten";
        forgottenDeviceId: string;
      }
    | {
        status: "already_missing";
        forgottenDeviceId: null;
      }
  >;
} {
  const records = new Map<
    string,
    {
      deviceId: string;
      runtimeLane: "prod" | "dev-local" | "canary";
      updatedAtMs: number;
    }
  >();
  const forgottenDevicesByUserId = new Map<string, Set<string>>();
  const connectedComputerIdsByUserId = new Map<string, Set<string>>(
    Object.entries(input?.connectedComputerIdsByUserId ?? {}).map(
      ([userId, connectedComputerIds]) => [
        userId,
        new Set(connectedComputerIds),
      ]
    )
  );
  const nextConnectedComputerIds = [...(input?.nextConnectedComputerIds ?? [])];
  const ownedDeviceRegistryRowsByUserId = new Map<
    string,
    Map<string, OwnedDeviceRegistryRecord>
  >(
    Object.entries(input?.ownedDevicesByUserId ?? {}).map(([userId, rows]) => [
      userId,
      new Map(rows.map((row) => [row.deviceId, row])),
    ])
  );
  const executionTargetsByUserId = new Map(
    Object.entries(input?.executionTargetsByUserId ?? {})
  );

  return {
    readCurrentDeviceTarget: (input) => {
      const record = records.get(input.userId);
      if (!record) {
        return Promise.resolve({
          availability: "missing",
        });
      }
      return Promise.resolve({
        availability: "resolved",
        deviceId: record.deviceId,
        runtimeLane: record.runtimeLane,
      });
    },
    replaceCurrentDeviceTarget: (input) => {
      records.set(input.userId, {
        deviceId: input.deviceId,
        runtimeLane: input.runtimeLane,
        updatedAtMs: input.updatedAtMs,
      });
      return Promise.resolve();
    },
    createCurrentDeviceTargetIfMissing: (input) => {
      if (!records.has(input.userId)) {
        records.set(input.userId, {
          deviceId: input.deviceId,
          runtimeLane: input.runtimeLane,
          updatedAtMs: input.updatedAtMs,
        });
      }

      return Promise.resolve();
    },
    readConnectedComputerIdentity: (input) => {
      const connectedComputerId = connectedComputerIdsByUserId
        .get(input.userId)
        ?.has(input.connectedComputerId)
        ? input.connectedComputerId
        : null;

      return Promise.resolve(
        connectedComputerId === null ? null : { connectedComputerId }
      );
    },
    connectCurrentDeviceIdentity: (input) => {
      const rows =
        ownedDeviceRegistryRowsByUserId.get(input.userId) ?? new Map();
      const existing = rows.get(input.deviceId);
      const verifiedRequestedConnectedComputerId =
        input.requestedConnectedComputerId &&
        connectedComputerIdsByUserId
          .get(input.userId)
          ?.has(input.requestedConnectedComputerId)
          ? input.requestedConnectedComputerId
          : null;
      if (
        input.requestedConnectedComputerId &&
        !verifiedRequestedConnectedComputerId
      ) {
        return Promise.resolve({
          status: "requested_not_found",
          requestedConnectedComputerId: input.requestedConnectedComputerId,
        });
      }
      const connectedComputerId =
        verifiedRequestedConnectedComputerId ??
        existing?.connectedComputerId ??
        nextConnectedComputerIds.shift() ??
        `computer_${input.deviceId}`;
      const nowMs = input.connectedAtMs;
      rows.set(input.deviceId, {
        ownerUserId: input.userId,
        deviceId: input.deviceId,
        connectedComputerId,
        observedDisplayName: existing?.observedDisplayName ?? null,
        userDisplayName: existing?.userDisplayName ?? null,
        platformFamily: existing?.platformFamily ?? null,
        osVersion: existing?.osVersion ?? null,
        deviceType: existing?.deviceType ?? null,
        firstSeenAtMs: existing?.firstSeenAtMs ?? nowMs,
        lastObservedAtMs: existing?.lastObservedAtMs ?? null,
        updatedAtMs: nowMs,
      });
      ownedDeviceRegistryRowsByUserId.set(input.userId, rows);
      const connectedComputerIds =
        connectedComputerIdsByUserId.get(input.userId) ?? new Set<string>();
      connectedComputerIds.add(connectedComputerId);
      if (
        existing?.connectedComputerId &&
        existing.connectedComputerId !== connectedComputerId &&
        ![...rows.values()].some(
          (row) => row.connectedComputerId === existing.connectedComputerId
        )
      ) {
        connectedComputerIds.delete(existing.connectedComputerId);
      }
      connectedComputerIdsByUserId.set(input.userId, connectedComputerIds);

      return Promise.resolve({ status: "connected", connectedComputerId });
    },
    readConnectedComputerIdsForTest: (userId) => [
      ...(connectedComputerIdsByUserId.get(userId) ?? []),
    ],
    readForgottenDevice: (input) => {
      const forgottenDevices = forgottenDevicesByUserId.get(input.userId);
      return Promise.resolve(
        forgottenDevices?.has(input.deviceId)
          ? { deviceId: input.deviceId }
          : null
      );
    },
    deleteForgottenDevice: (input) => {
      forgottenDevicesByUserId.get(input.userId)?.delete(input.deviceId);
      return Promise.resolve();
    },
    forgetCurrentComputer: (input) => {
      const current = records.get(input.userId);
      if (!current) {
        return Promise.resolve({
          status: "already_missing",
          forgottenDeviceId: null,
        });
      }
      const forgottenDevices =
        forgottenDevicesByUserId.get(input.userId) ?? new Set<string>();
      forgottenDevices.add(current.deviceId);
      forgottenDevicesByUserId.set(input.userId, forgottenDevices);
      records.delete(input.userId);
      ownedDeviceRegistryRowsByUserId
        .get(input.userId)
        ?.delete(current.deviceId);
      return Promise.resolve({
        status: "forgotten",
        forgottenDeviceId: current.deviceId,
      });
    },
    forgetComputer: (input) => {
      const rows = ownedDeviceRegistryRowsByUserId.get(input.userId);
      if (!rows?.has(input.deviceId)) {
        return Promise.resolve({
          status: "already_missing",
          forgottenDeviceId: null,
        });
      }
      const forgottenDevices =
        forgottenDevicesByUserId.get(input.userId) ?? new Set<string>();
      forgottenDevices.add(input.deviceId);
      forgottenDevicesByUserId.set(input.userId, forgottenDevices);
      rows.delete(input.deviceId);
      if (records.get(input.userId)?.deviceId === input.deviceId) {
        records.delete(input.userId);
      }
      return Promise.resolve({
        status: "forgotten",
        forgottenDeviceId: input.deviceId,
      });
    },
    readOwnedDevices: (input) => {
      const configuredDevices = ownedDeviceRegistryRowsByUserId.get(
        input.userId
      );
      if (configuredDevices) {
        return Promise.resolve(
          [...configuredDevices.values()].map((device) => ({
            deviceId: device.deviceId,
            connectedComputerId: device.connectedComputerId,
            userDisplayName: device.userDisplayName,
            observedDisplayName: device.observedDisplayName,
            platformFamily: device.platformFamily,
            osVersion: device.osVersion,
            deviceType: device.deviceType,
            firstSeenAtMs: device.firstSeenAtMs,
            lastObservedAtMs: device.lastObservedAtMs,
          }))
        );
      }
      return Promise.resolve([]);
    },
    readOwnedDeviceExecutionTargets: (input) =>
      Promise.resolve(
        (executionTargetsByUserId.get(input.userId) ?? []).map((target) => ({
          ...target,
          capabilityEnabled: target.capabilityEnabled ?? true,
        }))
      ),
    readOwnedDeviceRegistryRecord: (input) => {
      const rows = ownedDeviceRegistryRowsByUserId.get(input.userId);
      return Promise.resolve(rows?.get(input.deviceId) ?? null);
    },
    upsertOwnedDeviceRegistryRecord: (input) => {
      const rows =
        ownedDeviceRegistryRowsByUserId.get(input.record.ownerUserId) ??
        new Map();
      rows.set(input.record.deviceId, input.record);
      ownedDeviceRegistryRowsByUserId.set(input.record.ownerUserId, rows);
      return Promise.resolve();
    },
  };
}

function createOwnedDeviceRecord(input: {
  connectedComputerId?: string | null;
  deviceId: string;
  ownerUserId: string;
}): OwnedDeviceRegistryRecord {
  return {
    ownerUserId: input.ownerUserId,
    deviceId: input.deviceId,
    ...(input.connectedComputerId === undefined
      ? {}
      : { connectedComputerId: input.connectedComputerId }),
    observedDisplayName: null,
    userDisplayName: null,
    platformFamily: null,
    osVersion: null,
    deviceType: null,
    firstSeenAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
    lastObservedAtMs: null,
    updatedAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
  };
}
