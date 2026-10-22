import { PostgresDatabase } from "@openmeld/db/postgresql";
import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type {
  LocalComponentsStatus,
  OpenMeldDaemonDispatchQueueMessage,
} from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as agentProfileBindingRepo from "../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as dispatchSourceSignalContext from "../dispatch/application/dispatch-source-signal-context";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as dispatchLedgerPostgres from "../dispatch/infrastructure/postgresql/dispatch-ledger-postgresql";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as runtimeCoordinatorClient from "../dispatch/infrastructure/runtime-transport/runtime-coordinator-client";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as daemonTransportClient from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as localComponentsUpdateProjection from "../local-components/update-projection";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as informationProtectionRepo from "../organizations/organization-information-protection-repository";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as runtimeRegistryRepo from "../runtime-registry/infrastructure/postgresql/runtime-registry-repo";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as forgottenDeviceRepo from "../start/infrastructure/postgresql/forgotten-device-repo";
import { REQUIRED_SERVICE_UPDATE_RELEASE_MANIFEST } from "./local-components-release-manifest-fixture";

const recordDispatchAttemptExecutionOwnershipMock = vi.fn<
  (...args: unknown[]) => Promise<void>
>(async () => undefined);

import { createPublishedCliReleasesBucket } from "../../test-support/published-local-components-release";
import {
  type DispatchExecutionValidationError,
  deliverDispatchMessageToDaemon,
  resolveDispatchTargetProfileName,
} from "../dispatch/application/dispatch-execution-service";
import { deliverRuntimeTransportDispatch } from "../dispatch/infrastructure/runtime-transport/runtime-coordinator-client";
import {
  lookupRuntimeTransportOwnerService,
  lookupRuntimeTransportRoute,
} from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import { readRuntimeRegistryRecordByRuntimeId } from "../runtime-registry/infrastructure/postgresql/runtime-registry-repo";

const TEST_TARGET_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const LIVE_CODEX_CAPABILITIES = {
  runtimeAdapters: [
    {
      adapterId: "codex",
      capabilityDeclaration: {
        continuationCapability: "standard" as const,
        preparationRequirement: "none" as const,
        runtimeWorkingDirectoryMode: "spawn_cwd" as const,
        streamingCapability: "final_only" as const,
        workspaceResumeBehavior: "transparent" as const,
      },
      transportModes: ["local-cli" as const],
    },
  ],
};
const MATCHING_LOCAL_COMPONENTS_STATUS: LocalComponentsStatus = {
  schemaVersion: 1,
  generatedAt: "2026-07-02T00:00:00.000Z",
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
      "openmeld-cli-command-contract-2026-05-local-components-v1",
    latestPackageVersion: "999.0.0",
    packageVersion: "999.0.0",
    reasonCodes: [],
    requiredCommandContractVersion: null,
    status: "ok",
  },
  service: {
    expectedBundleHash:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    expectedBundleVersion: "999.0.0",
    installedBundleHash:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    installedBundleVersion: "999.0.0",
    reasonCodes: [],
    runtimeContractEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
    serviceContractVersion: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
    status: "ok",
  },
  skills: {
    expectedBundleHash:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    installedBundleHash:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    reasonCodes: [],
    skillContractVersion: "openmeld-skills-contract-2026-05-required-v1",
    status: "ok",
    targetCount: 1,
  },
};
const COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  reasonCode: "daemon.runtime_contract.compatible",
  status: "compatible",
} as const;
const resolveLocalComponentUpdateProjection =
  localComponentsUpdateProjection.resolveLocalComponentUpdateProjection;
const MISSING_CONTRACT_SERVICE = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: null,
  reasonCode: "daemon.runtime_contract.missing",
  status: "update_required",
} as const;
const MISMATCH_CONTRACT_SERVICE = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: "daemon-runtime-epoch-previous",
  reasonCode: "daemon.runtime_contract.mismatch",
  status: "update_required",
} as const;

function useRequiredServiceUpdatePolicy() {
  return vi
    .spyOn(
      localComponentsUpdateProjection,
      "resolveLocalComponentUpdateProjection"
    )
    .mockImplementation((input) =>
      resolveLocalComponentUpdateProjection({
        ...input,
        release: {
          manifest: REQUIRED_SERVICE_UPDATE_RELEASE_MANIFEST,
          availabilityCatalog: null,
        },
      })
    );
}

const createDispatchMessage = (
  overrides: Partial<OpenMeldDaemonDispatchQueueMessage> = {}
): OpenMeldDaemonDispatchQueueMessage => ({
  v: 2,
  dispatchId: "dispatch-profile-identity-1",
  spaceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  sourceEventId: "event-profile-identity-1",
  targetProfileId: TEST_TARGET_PROFILE_ID,
  dispatchChainId: "dispatch-profile-identity-1",
  autoRelayDepth: 0,
  visitedProfileIds: [],
  visitedProfileIdsHash: "stable32:profileidentity",
  dispatchContractVersion: 2,
  dispatchPolicy: "mention_only",
  ruleSource: "registry",
  ruleId: "registry.default.all_members.v1",
  ruleReason: "default allow all members mention",
  taskId: "task-profile-identity-1",
  transportMode: null,
  controllerSnapshot: {
    targetBindingState: "bound",
    targetBindingEnabled: true,
    agentControllerRef: null,
  },
  contextIdMappingSpec: null,
  dispatchRulesSnapshot: {
    dispatchPolicy: "mention_only",
    ruleSource: "registry",
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
  },
  dispatchSnapshot: {
    dispatchPolicy: "mention_only",
    ruleSource: "registry",
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
    targetBindingState: "bound",
    targetBindingEnabled: true,
  },
  idempotencyKey: `5:event-profile-identity-1|5:${TEST_TARGET_PROFILE_ID}`,
  enqueuedAtMs: Date.now(),
  ...overrides,
});

function createAvailableAuthRpc(defaultProjectId: string | null = null) {
  return {
    resolveProfileById: vi.fn(async () => ({
      ok: true as const,
      profile: {
        defaultProjectId,
        ownerUserId: "user-1",
        profileHandle: "snapshot-codex",
        profileId: TEST_TARGET_PROFILE_ID,
        profileKind: "agent" as const,
        profileName: "Snapshot Codex",
        status: "active" as const,
      },
    })),
  };
}

describe("dispatch execution profile identity boundaries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    // vi.mock module factories do not reach the worker-entry module graph in
    // vitest-pool-workers (src/index.ts already loaded these modules in the
    // same isolate), so per-test spies on the shared module namespaces are the
    // only mocking mechanism that actually intercepts the dispatch pipeline.
    vi.spyOn(
      dispatchSourceSignalContext,
      "readDispatchSourceSignalContext"
    ).mockResolvedValue({
      profileId: null,
      profileKind: null,
      profileHandle: null,
      profileMentionLabel: null,
      text: "hello from dispatch profile identity test",
    });
    vi.spyOn(
      forgottenDeviceRepo,
      "readForgottenDeviceRecord"
    ).mockResolvedValue(null);
    vi.spyOn(
      informationProtectionRepo,
      "readOrganizationInformationProtectionPolicyForSpace"
    ).mockResolvedValue(null);
    vi.spyOn(
      runtimeCoordinatorClient,
      "buildRuntimeTransportDeliverDispatchRequest"
    ).mockReturnValue({ payload: {} } as never);
    vi.spyOn(
      runtimeCoordinatorClient,
      "deliverRuntimeTransportDispatch"
    ).mockResolvedValue({
      accepted: true,
      status: "delivered",
    });
    vi.spyOn(
      daemonTransportClient,
      "lookupRuntimeTransportRoute"
    ).mockResolvedValue({
      online: true,
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      serviceVersion: "999.0.0",
      connectionGeneration: 1,
      leaseEpoch: 1,
      lastHeartbeatMs: 1,
      capabilities: LIVE_CODEX_CAPABILITIES,
      executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
    });
    vi.spyOn(
      daemonTransportClient,
      "lookupRuntimeTransportOwnerService"
    ).mockResolvedValue({
      online: false,
      reasonCode: "daemon.session.not_found",
    });
    vi.spyOn(
      runtimeCoordinatorClient,
      "waitRuntimeTransportDispatchResult"
    ).mockImplementation(() => undefined as never);
    vi.spyOn(
      agentProfileBindingRepo,
      "readPrimaryAgentProfileBindingRecord"
    ).mockResolvedValue({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      bindingId: "binding-1",
      bindingState: "enabled_primary",
      agentControllerRef: "builtin:codex",
      createdAtMs: 1,
      disabledAtMs: null,
      owner: {
        id: "user-1",
        kind: "owner_account",
      },
      openMeldServiceRuntimeId: "runtime-1",
      updatedAtMs: 1,
    } as never);
    vi.spyOn(
      runtimeRegistryRepo,
      "readRuntimeRegistryRecordByRuntimeId"
    ).mockResolvedValue({
      record: {
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-1",
        },
        runtimeLookupInput: {
          deviceId: "device-1",
          lane: "dev-local",
          owner: {
            id: "user-1",
            kind: "owner_account",
          },
        },
      },
      status: "found",
    } as never);
    vi.spyOn(
      dispatchLedgerPostgres,
      "recordDispatchAttemptExecutionOwnership"
    ).mockImplementation((...args) =>
      recordDispatchAttemptExecutionOwnershipMock(...args)
    );
  });

  it("returns null display name and logs when failure-hint name lookup cannot reach auth rpc", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const result = await resolveDispatchTargetProfileName({
      authRpc: undefined,
      targetProfileId: TEST_TARGET_PROFILE_ID,
    });

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_target_profile_identity_unavailable]",
      expect.objectContaining({
        reasonCode: "dispatch.target_profile_identity.auth_rpc_unavailable",
        source: "dispatch_failure_hint_target_profile_name",
        targetProfileId: TEST_TARGET_PROFILE_ID,
      })
    );
  });

  it("fails the main dispatch path when auth rpc identity lookup is unavailable and explicit snapshots are missing", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      deliverDispatchMessageToDaemon({
        attemptId: "attempt-profile-identity-1",
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        env: {
          OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
          OPENMELD_AUTH_WORKER: undefined,
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://127.0.0.1:1/unexpected_test_database_access",
          },
        } as never,
        message: createDispatchMessage(),
        targetOwnerUserId: "user-1",
      })
    ).rejects.toMatchObject({
      code: "dispatch.target_profile_identity.auth_rpc_unavailable",
      name: "DispatchExecutionValidationError",
    } satisfies Partial<DispatchExecutionValidationError>);

    expect(deliverRuntimeTransportDispatch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_target_profile_identity_unavailable]",
      expect.objectContaining({
        reasonCode: "dispatch.target_profile_identity.auth_rpc_unavailable",
        source: "dispatch_execution_preflight",
        targetProfileId: TEST_TARGET_PROFILE_ID,
      })
    );
  });

  it("fails the main dispatch path with a stable lookup_failed code when auth rpc returns ok:false", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      deliverDispatchMessageToDaemon({
        attemptId: "attempt-profile-identity-lookup-failed-1",
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        env: {
          OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
          OPENMELD_AUTH_WORKER: {
            resolveProfileById: vi.fn().mockResolvedValue({
              ok: false,
              code: "auth.profile_lookup_failed",
              message: "profile lookup failed",
            }),
          },
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://127.0.0.1:1/unexpected_test_database_access",
          },
        } as never,
        message: createDispatchMessage({
          dispatchId: "dispatch-profile-identity-lookup-failed-1",
        }),
        targetOwnerUserId: "user-1",
      })
    ).rejects.toMatchObject({
      code: "dispatch.target_profile_identity.lookup_failed",
      name: "DispatchExecutionValidationError",
    } satisfies Partial<DispatchExecutionValidationError>);

    expect(deliverRuntimeTransportDispatch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_target_profile_identity_unavailable]",
      expect.objectContaining({
        reasonCode: "dispatch.target_profile_identity.lookup_failed",
        upstreamCode: "auth.profile_lookup_failed",
        source: "dispatch_execution_preflight",
        targetProfileId: TEST_TARGET_PROFILE_ID,
      })
    );
  });

  it("uses explicit message snapshots before auth rpc when they already contain the target name and mention label", async () => {
    const authRpc = createAvailableAuthRpc("project-1");

    const result = await deliverDispatchMessageToDaemon({
      attemptId: "attempt-profile-identity-2",
      db: new PostgresDatabase({
        connectionString:
          "postgresql://127.0.0.1:1/unexpected_test_database_access",
      }),
      env: {
        OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
        OPENMELD_AUTH_WORKER: authRpc,
        OPENMELD_POSTGRESQL: {
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        },
      } as never,
      message: createDispatchMessage({
        targetProfileNameSnapshot: "Snapshot Codex",
        targetProfileMentionLabel: "snapshot-codex",
      }),
      targetOwnerUserId: "user-1",
    });

    expect(authRpc.resolveProfileById).toHaveBeenCalledOnce();
    expect(result.profileHandle).toBe("snapshot-codex");
    expect(result.targetProfileName).toBe("Snapshot Codex");
    expect(result.targetProfileMentionLabel).toBe("snapshot-codex");
    expect(deliverRuntimeTransportDispatch).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.buildRuntimeTransportDeliverDispatchRequest
    ).toHaveBeenCalledWith(
      expect.objectContaining({ defaultProjectId: "project-1" })
    );
  });

  it("adds Organization protection only for a Local Service that declares prompt support", async () => {
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: true,
      daemonSessionId: "daemon-session-protection-1",
      deviceId: "device-1",
      lane: "dev-local",
      serviceVersion: "999.0.0",
      connectionGeneration: 1,
      leaseEpoch: 1,
      lastHeartbeatMs: 1,
      capabilities: {
        ...LIVE_CODEX_CAPABILITIES,
        informationProtectionPrompt: true,
      },
      executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
    });
    vi.mocked(
      informationProtectionRepo.readOrganizationInformationProtectionPolicyForSpace
    ).mockResolvedValueOnce({
      organizationId: "org-1",
      protectedInformation: "Private renewal pricing.",
      updatedAtMs: 1,
      updatedByUserId: "user-admin",
    });

    await deliverDispatchMessageToDaemon({
      attemptId: "attempt-profile-identity-protection-1",
      db: new PostgresDatabase({
        connectionString:
          "postgresql://127.0.0.1:1/unexpected_test_database_access",
      }),
      env: {
        OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
        OPENMELD_AUTH_WORKER: createAvailableAuthRpc(),
        OPENMELD_POSTGRESQL: {
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        },
      } as never,
      message: createDispatchMessage({
        dispatchId: "dispatch-profile-identity-protection-1",
        targetProfileNameSnapshot: "Snapshot Codex",
        targetProfileMentionLabel: "snapshot-codex",
      }),
      targetOwnerUserId: "user-1",
    });

    expect(
      informationProtectionRepo.readOrganizationInformationProtectionPolicyForSpace
    ).toHaveBeenCalledWith({
      db: expect.anything(),
      spaceId: createDispatchMessage().spaceId,
    });
    expect(
      runtimeCoordinatorClient.buildRuntimeTransportDeliverDispatchRequest
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationProtectedInformation: "Private renewal pricing.",
      })
    );
  });

  it("keeps delivery compatible with an older Local Service", async () => {
    await deliverDispatchMessageToDaemon({
      attemptId: "attempt-profile-identity-legacy-service-1",
      db: new PostgresDatabase({
        connectionString:
          "postgresql://127.0.0.1:1/unexpected_test_database_access",
      }),
      env: {
        OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
        OPENMELD_AUTH_WORKER: createAvailableAuthRpc(),
        OPENMELD_POSTGRESQL: {
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        },
      } as never,
      message: createDispatchMessage({
        dispatchId: "dispatch-profile-identity-legacy-service-1",
        targetProfileNameSnapshot: "Snapshot Codex",
        targetProfileMentionLabel: "snapshot-codex",
      }),
      targetOwnerUserId: "user-1",
    });

    expect(
      informationProtectionRepo.readOrganizationInformationProtectionPolicyForSpace
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.buildRuntimeTransportDeliverDispatchRequest
    ).toHaveBeenCalledWith(
      expect.objectContaining({ organizationProtectedInformation: null })
    );
  });

  it("keeps delivery available when the optional Organization protection read fails", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: true,
      daemonSessionId: "daemon-session-protection-fallback-1",
      deviceId: "device-1",
      lane: "dev-local",
      serviceVersion: "999.0.0",
      connectionGeneration: 1,
      leaseEpoch: 1,
      lastHeartbeatMs: 1,
      capabilities: {
        ...LIVE_CODEX_CAPABILITIES,
        informationProtectionPrompt: true,
      },
      executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
    });
    vi.mocked(
      informationProtectionRepo.readOrganizationInformationProtectionPolicyForSpace
    ).mockRejectedValueOnce(new Error("policy store unavailable"));

    await expect(
      deliverDispatchMessageToDaemon({
        attemptId: "attempt-profile-identity-protection-fallback-1",
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        env: {
          OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
          OPENMELD_AUTH_WORKER: createAvailableAuthRpc(),
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://127.0.0.1:1/unexpected_test_database_access",
          },
        } as never,
        message: createDispatchMessage({
          dispatchId: "dispatch-profile-identity-protection-fallback-1",
          targetProfileNameSnapshot: "Snapshot Codex",
          targetProfileMentionLabel: "snapshot-codex",
        }),
        targetOwnerUserId: "user-1",
      })
    ).resolves.toBeDefined();

    expect(
      runtimeCoordinatorClient.buildRuntimeTransportDeliverDispatchRequest
    ).toHaveBeenCalledWith(
      expect.objectContaining({ organizationProtectedInformation: null })
    );
    expect(deliverRuntimeTransportDispatch).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_execution.information_protection_policy_unavailable]",
      expect.objectContaining({
        dispatchId: "dispatch-profile-identity-protection-fallback-1",
        error: "policy store unavailable",
      })
    );
  });

  it("keeps delivery available and reports a missing Space Organization projection", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: true,
      daemonSessionId: "daemon-session-protection-scope-fallback-1",
      deviceId: "device-1",
      lane: "dev-local",
      serviceVersion: "999.0.0",
      connectionGeneration: 1,
      leaseEpoch: 1,
      lastHeartbeatMs: 1,
      capabilities: {
        ...LIVE_CODEX_CAPABILITIES,
        informationProtectionPrompt: true,
      },
      executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
    });
    vi.mocked(
      informationProtectionRepo.readOrganizationInformationProtectionPolicyForSpace
    ).mockResolvedValueOnce(null);

    await expect(
      deliverDispatchMessageToDaemon({
        attemptId: "attempt-profile-identity-protection-scope-fallback-1",
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        env: {
          OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
          OPENMELD_AUTH_WORKER: createAvailableAuthRpc(),
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://127.0.0.1:1/unexpected_test_database_access",
          },
        } as never,
        message: createDispatchMessage({
          dispatchId: "dispatch-profile-identity-protection-scope-fallback-1",
          targetProfileNameSnapshot: "Snapshot Codex",
          targetProfileMentionLabel: "snapshot-codex",
        }),
        targetOwnerUserId: "user-1",
      })
    ).resolves.toBeDefined();

    expect(deliverRuntimeTransportDispatch).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_execution.information_protection_scope_unavailable]",
      expect.objectContaining({
        dispatchId: "dispatch-profile-identity-protection-scope-fallback-1",
        event:
          "core.openMeldDaemon.dispatch_execution.information_protection_scope_unavailable",
      })
    );
  });

  it("records durable execution ownership before sending the daemon deliver frame", async () => {
    const callOrder: string[] = [];
    recordDispatchAttemptExecutionOwnershipMock.mockImplementationOnce(() => {
      callOrder.push("record_ownership");
      return Promise.resolve();
    });
    vi.mocked(deliverRuntimeTransportDispatch).mockImplementationOnce(() => {
      callOrder.push("deliver");
      return Promise.resolve({
        accepted: true,
        status: "delivered",
      });
    });

    await deliverDispatchMessageToDaemon({
      attemptId: "attempt-profile-identity-ownership-1",
      db: new PostgresDatabase({
        connectionString:
          "postgresql://127.0.0.1:1/unexpected_test_database_access",
      }),
      env: {
        OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
        OPENMELD_AUTH_WORKER: createAvailableAuthRpc(),
        OPENMELD_POSTGRESQL: {
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        },
      } as never,
      message: createDispatchMessage({
        dispatchId: "dispatch-profile-identity-ownership-1",
        targetProfileNameSnapshot: "Snapshot Codex",
        targetProfileMentionLabel: "snapshot-codex",
      }),
      targetOwnerUserId: "user-1",
    });

    expect(recordDispatchAttemptExecutionOwnershipMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "attempt-profile-identity-ownership-1",
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        dispatchId: "dispatch-profile-identity-ownership-1",
        leaseEpoch: 1,
        targetProfileId: TEST_TARGET_PROFILE_ID,
        taskId: "task-profile-identity-1",
      })
    );
    expect(callOrder).toEqual(["record_ownership", "deliver"]);
  });

  it("does not send the daemon deliver frame when durable execution ownership cannot be recorded", async () => {
    recordDispatchAttemptExecutionOwnershipMock.mockRejectedValueOnce(
      new Error("postgresql unavailable")
    );

    await expect(
      deliverDispatchMessageToDaemon({
        attemptId: "attempt-profile-identity-ownership-failed-1",
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        env: {
          OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
          OPENMELD_AUTH_WORKER: createAvailableAuthRpc(),
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://127.0.0.1:1/unexpected_test_database_access",
          },
        } as never,
        message: createDispatchMessage({
          dispatchId: "dispatch-profile-identity-ownership-failed-1",
          targetProfileNameSnapshot: "Snapshot Codex",
          targetProfileMentionLabel: "snapshot-codex",
        }),
        targetOwnerUserId: "user-1",
      })
    ).rejects.toThrow("postgresql unavailable");

    expect(deliverRuntimeTransportDispatch).not.toHaveBeenCalled();
  });

  it("blocks daemon delivery when the online route is for a different runtime lane than the Core primary binding", async () => {
    vi.mocked(readRuntimeRegistryRecordByRuntimeId).mockResolvedValueOnce({
      record: {
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-1",
        },
        runtimeLookupInput: {
          deviceId: "device-1",
          lane: "canary",
          owner: {
            id: "user-1",
            kind: "owner_account",
          },
        },
      },
      status: "found",
    });

    await expect(
      deliverDispatchMessageToDaemon({
        attemptId: "attempt-profile-identity-lane-mismatch-1",
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        env: {
          OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
          OPENMELD_AUTH_WORKER: createAvailableAuthRpc(),
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://127.0.0.1:1/unexpected_test_database_access",
          },
        } as never,
        message: createDispatchMessage({
          dispatchId: "dispatch-profile-identity-lane-mismatch-1",
          targetProfileNameSnapshot: "Snapshot Codex",
          targetProfileMentionLabel: "snapshot-codex",
        }),
        targetOwnerUserId: "user-1",
      })
    ).rejects.toMatchObject({
      code: "local_service.identity_mismatch",
      name: "DispatchExecutionValidationError",
    } satisfies Partial<DispatchExecutionValidationError>);

    expect(deliverRuntimeTransportDispatch).not.toHaveBeenCalled();
  });

  it("blocks reconnect delivery when the primary Binding no longer owns the accepted Wake", async () => {
    await expect(
      deliverDispatchMessageToDaemon({
        acceptedDispatchSnapshot: {
          controllerSnapshot: {
            agentControllerRef: "builtin:codex",
            bindingId: "binding-accepted-a",
            configurationRevision: 7,
            targetBindingEnabled: true,
            targetBindingState: "bound",
          },
          openMeldServiceRuntimeId: "runtime-accepted-a",
          payloadFingerprint: `sha256:${"a".repeat(64)}`,
          runtimeKind: "openmeld_service",
        },
        attemptId: "attempt-profile-identity-reconnect-drift-1",
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        env: {
          OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
          OPENMELD_AUTH_WORKER: createAvailableAuthRpc(),
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://127.0.0.1:1/unexpected_test_database_access",
          },
        } as never,
        message: createDispatchMessage({
          dispatchId: "dispatch-profile-identity-reconnect-drift-1",
          targetProfileNameSnapshot: "Snapshot Codex",
          targetProfileMentionLabel: "snapshot-codex",
        }),
        targetOwnerUserId: "user-1",
      })
    ).rejects.toMatchObject({
      code: "local_service.identity_mismatch",
      name: "DispatchExecutionValidationError",
    } satisfies Partial<DispatchExecutionValidationError>);

    expect(deliverRuntimeTransportDispatch).not.toHaveBeenCalled();
    expect(recordDispatchAttemptExecutionOwnershipMock).not.toHaveBeenCalled();
  });

  it("blocks daemon delivery when the online route is missing execution contract evidence", async () => {
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: true,
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      serviceVersion: "999.0.0",
      connectionGeneration: 1,
      leaseEpoch: 1,
      lastHeartbeatMs: 1,
      capabilities: LIVE_CODEX_CAPABILITIES,
      executionCompatibility: MISSING_CONTRACT_SERVICE,
    });

    await expect(
      deliverDispatchMessageToDaemon({
        attemptId: "attempt-profile-identity-missing-contract-1",
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        env: {
          OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
          OPENMELD_AUTH_WORKER: createAvailableAuthRpc(),
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://127.0.0.1:1/unexpected_test_database_access",
          },
        } as never,
        message: createDispatchMessage({
          dispatchId: "dispatch-profile-identity-missing-contract-1",
          targetProfileNameSnapshot: "Snapshot Codex",
          targetProfileMentionLabel: "snapshot-codex",
        }),
        targetOwnerUserId: "user-1",
      })
    ).rejects.toMatchObject({
      code: "service.update_required",
      name: "DispatchExecutionValidationError",
      waitReasonCode: "daemon.runtime_contract.missing",
    } satisfies Partial<DispatchExecutionValidationError>);

    expect(deliverRuntimeTransportDispatch).not.toHaveBeenCalled();
  });

  it("blocks daemon delivery when the online route has an incompatible execution contract", async () => {
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: true,
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      serviceVersion: "999.0.0",
      connectionGeneration: 1,
      leaseEpoch: 1,
      lastHeartbeatMs: 1,
      capabilities: LIVE_CODEX_CAPABILITIES,
      executionCompatibility: MISMATCH_CONTRACT_SERVICE,
    });

    await expect(
      deliverDispatchMessageToDaemon({
        attemptId: "attempt-profile-identity-service-update-1",
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        env: {
          OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
          OPENMELD_AUTH_WORKER: createAvailableAuthRpc(),
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://127.0.0.1:1/unexpected_test_database_access",
          },
        } as never,
        message: createDispatchMessage({
          dispatchId: "dispatch-profile-identity-service-update-1",
          targetProfileNameSnapshot: "Snapshot Codex",
          targetProfileMentionLabel: "snapshot-codex",
        }),
        targetOwnerUserId: "user-1",
      })
    ).rejects.toMatchObject({
      code: "service.update_required",
      name: "DispatchExecutionValidationError",
      waitReasonCode: "daemon.runtime_contract.mismatch",
    } satisfies Partial<DispatchExecutionValidationError>);

    expect(deliverRuntimeTransportDispatch).not.toHaveBeenCalled();
  });

  it("blocks daemon delivery when a required Service update lacks version evidence", async () => {
    useRequiredServiceUpdatePolicy();

    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: true,
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      connectionGeneration: 1,
      leaseEpoch: 1,
      lastHeartbeatMs: 1,
      capabilities: LIVE_CODEX_CAPABILITIES,
      executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
    });

    await expect(
      deliverDispatchMessageToDaemon({
        attemptId: "attempt-profile-identity-missing-service-version-1",
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        env: {
          OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
          OPENMELD_AUTH_WORKER: createAvailableAuthRpc(),
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://127.0.0.1:1/unexpected_test_database_access",
          },
        } as never,
        message: createDispatchMessage({
          dispatchId: "dispatch-profile-identity-missing-service-version-1",
          targetProfileNameSnapshot: "Snapshot Codex",
          targetProfileMentionLabel: "snapshot-codex",
        }),
        targetOwnerUserId: "user-1",
      })
    ).rejects.toMatchObject({
      code: "service.update_required",
      name: "DispatchExecutionValidationError",
      waitReasonCode: "service.version_not_reported",
    } satisfies Partial<DispatchExecutionValidationError>);

    expect(deliverRuntimeTransportDispatch).not.toHaveBeenCalled();
  });

  it("passes route heartbeat local component evidence into the Service update gate", async () => {
    const projectionSpy = useRequiredServiceUpdatePolicy();
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: true,
      daemonSessionId: "daemon-session-components-1",
      deviceId: "device-1",
      lane: "dev-local",
      serviceVersion: "999.0.0",
      connectionGeneration: 1,
      leaseEpoch: 1,
      lastHeartbeatMs: 1,
      capabilities: {
        ...LIVE_CODEX_CAPABILITIES,
        localComponents: MATCHING_LOCAL_COMPONENTS_STATUS,
      },
      executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
    });

    await deliverDispatchMessageToDaemon({
      attemptId: "attempt-profile-identity-route-components-1",
      db: new PostgresDatabase({
        connectionString:
          "postgresql://127.0.0.1:1/unexpected_test_database_access",
      }),
      env: {
        OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
        OPENMELD_AUTH_WORKER: createAvailableAuthRpc(),
        OPENMELD_POSTGRESQL: {
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        },
      } as never,
      message: createDispatchMessage({
        dispatchId: "dispatch-profile-identity-route-components-1",
        targetProfileNameSnapshot: "Snapshot Codex",
        targetProfileMentionLabel: "snapshot-codex",
      }),
      targetOwnerUserId: "user-1",
    });

    expect(projectionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        localComponentsStatus: MATCHING_LOCAL_COMPONENTS_STATUS,
      })
    );
    expect(deliverRuntimeTransportDispatch).toHaveBeenCalledTimes(1);
  });

  it("blocks daemon delivery when the route is offline because the bound same-lane service needs an update", async () => {
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: true,
      sessions: [
        {
          capabilities: LIVE_CODEX_CAPABILITIES,
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          deviceId: "device-1",
          executionCompatibility: MISMATCH_CONTRACT_SERVICE,
          lane: "dev-local",
          lastHeartbeatMs: 1,
          serviceVersion: "999.0.0",
        },
      ],
    });

    await expect(
      deliverDispatchMessageToDaemon({
        attemptId: "attempt-profile-identity-offline-service-update-1",
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        env: {
          OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
          OPENMELD_AUTH_WORKER: createAvailableAuthRpc(),
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://127.0.0.1:1/unexpected_test_database_access",
          },
        } as never,
        message: createDispatchMessage({
          dispatchId: "dispatch-profile-identity-offline-service-update-1",
          targetProfileNameSnapshot: "Snapshot Codex",
          targetProfileMentionLabel: "snapshot-codex",
        }),
        targetOwnerUserId: "user-1",
      })
    ).rejects.toMatchObject({
      code: "service.update_required",
      name: "DispatchExecutionValidationError",
      waitReasonCode: "daemon.runtime_contract.mismatch",
    } satisfies Partial<DispatchExecutionValidationError>);

    expect(deliverRuntimeTransportDispatch).not.toHaveBeenCalled();
  });

  it("passes owner-service heartbeat local component evidence into the offline route update gate", async () => {
    const projectionSpy = useRequiredServiceUpdatePolicy();
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: true,
      sessions: [
        {
          capabilities: {
            ...LIVE_CODEX_CAPABILITIES,
            localComponents: MATCHING_LOCAL_COMPONENTS_STATUS,
          },
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-components-2",
          deviceId: "device-1",
          executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
          lane: "dev-local",
          lastHeartbeatMs: 1,
          serviceVersion: "999.0.0",
        },
      ],
    });

    await expect(
      deliverDispatchMessageToDaemon({
        attemptId: "attempt-profile-identity-offline-components-1",
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        env: {
          OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
          OPENMELD_AUTH_WORKER: createAvailableAuthRpc(),
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://127.0.0.1:1/unexpected_test_database_access",
          },
        } as never,
        message: createDispatchMessage({
          dispatchId: "dispatch-profile-identity-offline-components-1",
          targetProfileNameSnapshot: "Snapshot Codex",
          targetProfileMentionLabel: "snapshot-codex",
        }),
        targetOwnerUserId: "user-1",
      })
    ).rejects.toMatchObject({
      code: "daemon.profile.offline",
      name: "DispatchExecutionValidationError",
    } satisfies Partial<DispatchExecutionValidationError>);

    expect(projectionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        localComponentsStatus: MATCHING_LOCAL_COMPONENTS_STATUS,
      })
    );
    expect(deliverRuntimeTransportDispatch).not.toHaveBeenCalled();
  });
});
