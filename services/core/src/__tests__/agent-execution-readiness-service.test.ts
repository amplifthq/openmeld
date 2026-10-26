import {
  AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
  resolveAgentWakeAdmissionBlockReasonCode,
  resolveAgentWakeAvailability,
} from "@openmeld/agent-runtime";
import { PostgresDatabase } from "@openmeld/db/postgresql";
import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type {
  AgentControllerInterfaceSnapshot,
  AgentControllerUsageLimit,
  AuthRpcProfileFact,
  LocalComponentsStatus,
} from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectionPostgresBinding } from "../../test-support/postgresql-query.test-support";
import { createPublishedCliReleasesBucket } from "../../test-support/published-local-components-release";
import { createAgentExecutionReadinessReads } from "../agent-execution/application/agent-execution-readiness-reads";
import { resolveCoreAgentExecutionReadinessForProfile as resolveCoreAgentExecutionReadinessForProfileWithoutOrganizationFixture } from "../agent-execution/application/agent-execution-readiness-service";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as readinessImpactRepo from "../agent-execution/infrastructure/postgresql/agent-execution-readiness-impact-repo";
import { readFreshAgentExecutionReadinessImpactForBinding } from "../agent-execution/infrastructure/postgresql/agent-execution-readiness-impact-repo";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as providerAccessEvidenceRepo from "../agent-execution/infrastructure/postgresql/provider-access-evidence-repo";
import { readFreshProviderAccessEvidenceForBinding } from "../agent-execution/infrastructure/postgresql/provider-access-evidence-repo";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as providerConversationProofRepo from "../agent-execution/infrastructure/postgresql/provider-conversation-proof-repo";
import { readFreshProviderConversationProofForBinding } from "../agent-execution/infrastructure/postgresql/provider-conversation-proof-repo";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as localRuntimeExpectedRoutesService from "../agent-profile-binding/application/local-runtime-expected-routes-service";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as agentProfileBindingRepo from "../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import {
  readPrimaryAgentProfileBindingRecord,
  readPrimaryAgentProfileBindingRecordByControllerConversation,
} from "../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import { resolveCurrentAgentModelAvailability } from "../config/agent-model-availability";
// biome-ignore lint/performance/noNamespaceImport: Spy on the reviewed catalog, not execution policy.
import * as modelCatalogSource from "../config/model-catalog";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as daemonTransportClient from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import {
  lookupRuntimeTransportOwnerService,
  lookupRuntimeTransportRoute,
} from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import type { CoreBindings } from "../lib/bindings";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as localComponentsUpdateProjection from "../local-components/update-projection";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as runtimeAgentControllerReportRepo from "../runtime-registry/infrastructure/postgresql/runtime-agent-controller-report-repo";
import { readCurrentRuntimeAgentControllerReports } from "../runtime-registry/infrastructure/postgresql/runtime-agent-controller-report-repo";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as runtimeRegistryRepo from "../runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import {
  listOwnedDeviceExecutionTargetRecords,
  readRuntimeRegistryRecord,
  readRuntimeRegistryRecordByRuntimeId,
} from "../runtime-registry/infrastructure/postgresql/runtime-registry-repo";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as currentDeviceDerivationRepo from "../start/infrastructure/postgresql/current-device-derivation-repo";
import { resolveCurrentDeviceFromBindings } from "../start/infrastructure/postgresql/current-device-derivation-repo";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as ownedDeviceRegistryRepo from "../start/infrastructure/postgresql/owned-device-registry-repo";
import { listOwnedDeviceRegistryRecords } from "../start/infrastructure/postgresql/owned-device-registry-repo";
import { REQUIRED_SERVICE_UPDATE_RELEASE_MANIFEST } from "./local-components-release-manifest-fixture";

const GENERATED_AT = "2026-05-13T00:00:00.000Z";
const GENERATED_AT_MS = Date.parse(GENERATED_AT);
const TEST_ORGANIZATION_ID = "org-readiness-test";
const COMPATIBLE_SERVICE = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  reasonCode: "daemon.runtime_contract.compatible",
  status: "compatible",
} as const;
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
const resolveLocalComponentUpdateProjection =
  localComponentsUpdateProjection.resolveLocalComponentUpdateProjection;
const MISSING_CONTRACT_SERVICE = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: null,
  reasonCode: "daemon.runtime_contract.missing",
  status: "update_required",
} as const;
let currentExpectedWorkingFolderProfileId: string | null = null;

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

describe("Core Agent Execution Readiness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    currentExpectedWorkingFolderProfileId = null;
    // vi.mock module factories do not reach the worker-entry module graph in
    // vitest-pool-workers (src/index.ts already loaded these repos in the same
    // isolate), so per-test spies on the shared module namespaces are the only
    // mocking mechanism that actually intercepts the readiness pipeline.
    vi.spyOn(
      agentProfileBindingRepo,
      "readPrimaryAgentProfileBindingRecord"
    ).mockImplementation(() => undefined as never);
    vi.spyOn(
      daemonTransportClient,
      "lookupRuntimeTransportOwnerService"
    ).mockImplementation(() => undefined as never);
    vi.spyOn(
      daemonTransportClient,
      "lookupRuntimeTransportRoute"
    ).mockImplementation(() => undefined as never);
    vi.spyOn(
      runtimeAgentControllerReportRepo,
      "readCurrentRuntimeAgentControllerReports"
    ).mockImplementation(() => undefined as never);
    vi.spyOn(
      runtimeRegistryRepo,
      "readRuntimeRegistryRecord"
    ).mockImplementation(() => undefined as never);
    vi.spyOn(
      runtimeRegistryRepo,
      "readRuntimeRegistryRecordByRuntimeId"
    ).mockImplementation(() => undefined as never);
    vi.spyOn(
      ownedDeviceRegistryRepo,
      "readOwnedDeviceRegistryRecord"
    ).mockImplementation(() => undefined as never);
    vi.spyOn(
      currentDeviceDerivationRepo,
      "resolveCurrentDeviceFromBindings"
    ).mockResolvedValue({
      availability: "missing",
    });
    vi.spyOn(
      providerAccessEvidenceRepo,
      "readFreshProviderAccessEvidenceForBinding"
    ).mockResolvedValue(null);
    vi.spyOn(
      providerConversationProofRepo,
      "readFreshProviderConversationProofForBinding"
    ).mockResolvedValue(null);
    vi.spyOn(
      agentProfileBindingRepo,
      "readPrimaryAgentProfileBindingRecordByControllerConversation"
    ).mockResolvedValue(null);
    vi.spyOn(
      readinessImpactRepo,
      "readFreshAgentExecutionReadinessImpactForBinding"
    ).mockResolvedValue(null);
    vi.spyOn(
      localRuntimeExpectedRoutesService,
      "readLocalRuntimeExpectedRoutes"
    ).mockImplementation(() => undefined as never);
    vi.spyOn(
      ownedDeviceRegistryRepo,
      "listOwnedDeviceRegistryRecords"
    ).mockResolvedValue([]);
    vi.spyOn(
      runtimeRegistryRepo,
      "listOwnedDeviceExecutionTargetRecords"
    ).mockResolvedValue([]);
  });

  it("reports profile identity lookup failure as profile evidence, not missing Binding setup", async () => {
    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockRejectedValue(new Error("auth down")),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_lookup_failed",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "unknown",
      facts: {
        profile: {
          active: false,
          reasonCodes: ["agent_profile.identity_lookup_failed"],
          source: "unavailable",
        },
        binding: {
          reasonCodes: ["agent_profile_binding.profile_owner_unavailable"],
          routable: false,
          source: "unavailable",
        },
      },
      primaryAction: "check_status",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
      "agent_profile_binding.missing"
    );
  });

  it("blocks readiness with current profile identity when the profile is not active", async () => {
    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: {
            ownerUserId: "owner-1",
            profileHandle: "agent",
            profileId: "agt_inactive",
            profileKind: "agent",
            profileName: "Inactive Agent",
            status: "disabled",
          },
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_inactive",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "blocked",
      facts: {
        binding: {
          reasonCodes: [],
          routable: false,
          source: "not_checked",
        },
        profile: {
          active: false,
          reasonCodes: ["agent_profile.inactive"],
          source: "profile_identity",
        },
      },
      primaryAction: "check_status",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
      "agent_profile_binding.missing"
    );
  });

  it.each([
    { fact: null, reason: "agent_profile.not_found" },
    { fact: { status: "disabled" }, reason: "agent_profile.inactive" },
    { fact: { profileKind: "human" }, reason: "agent_profile.not_agent" },
    {
      fact: { profileId: "agt_someone_else" },
      reason: "agent_profile.identity_lookup_failed",
    },
  ] as const)("keeps $reason protection when reusing Auth facts from this request", async ({
    fact,
    reason,
  }) => {
    const profileId = "agt_shared_fact";
    const profile: AuthRpcProfileFact | null =
      fact === null
        ? null
        : {
            profileId,
            profileKind: "agent",
            profileName: "Shared Fact Agent",
            profileHandle: "shared-fact-agent",
            ownerUserId: "owner-1",
            status: "active",
            defaultProjectId: null,
            ...fact,
          };
    const resolveProfileById = vi.fn();
    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({ resolveProfileById }),
      generatedAt: GENERATED_AT,
      profileId,
      reads: createAgentExecutionReadinessReads({
        profileFacts: new Map([[profileId, profile]]),
      }),
    });
    expect(readiness.agentExecutionReadiness.facts.profile).toMatchObject({
      active: false,
      reasonCodes: [reason],
    });
    expect(readiness.agentExecutionReadiness.facts.binding.routable).toBe(
      false
    );
    expect(resolveProfileById).not.toHaveBeenCalled();
  });

  it("blocks route recovery when the bound same-lane service is missing the execution contract", async () => {
    mockReadyBindingAndRuntime("agt_missing_contract");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: true,
      sessions: [
        {
          capabilities: {},
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          deviceId: "device-1",
          executionCompatibility: MISSING_CONTRACT_SERVICE,
          lane: "dev-local",
          lastHeartbeatMs: GENERATED_AT_MS,
          serviceVersion: "999.0.0",
        },
      ],
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: {
            ownerUserId: "owner-1",
            profileHandle: "agent",
            profileId: "agt_missing_contract",
            profileKind: "agent",
            profileName: "Missing Contract Agent",
            status: "active",
          },
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_missing_contract",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "blocked",
      facts: {
        localService: {
          reachable: true,
          refreshable: false,
          source: "runtime_transport",
        },
        service: {
          executionCompatible: false,
          observedEpoch: null,
          reasonCodes: [
            "service.update_required",
            "daemon.runtime_contract.missing",
          ],
          source: "runtime_transport",
        },
      },
      primaryAction: "update_service",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).toContain(
      "service.update_required"
    );
    expect(readiness.agentExecutionReadiness.reasonCodes).toContain(
      "daemon.runtime_contract.missing"
    );
  });

  it("keeps route-not-registered self-healing only when the same-lane service is execution compatible", async () => {
    mockReadyBindingAndRuntime("agt_check_status");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: true,
      sessions: [
        {
          capabilities: {},
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          deviceId: "device-1",
          executionCompatibility: COMPATIBLE_SERVICE,
          lane: "dev-local",
          lastHeartbeatMs: GENERATED_AT_MS,
          serviceVersion: "999.0.0",
        },
      ],
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: {
            ownerUserId: "owner-1",
            profileHandle: "agent",
            profileId: "agt_check_status",
            profileKind: "agent",
            profileName: "Check Status Agent",
            status: "active",
          },
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_check_status",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      facts: {
        localService: {
          reachable: true,
          refreshable: true,
          reasonCodes: ["local_service.refresh_in_progress"],
        },
        service: {
          executionCompatible: true,
          reasonCodes: [],
        },
      },
      primaryAction: "check_status",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).toContain(
      "route.not_registered"
    );
    expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
      "service.update_required"
    );
  });

  it("keeps transient route compatibility gaps out of hard service-disconnected guidance", async () => {
    mockReadyBindingAndRuntime("agt_transient_route_gap");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
      executionCompatibility: COMPATIBLE_SERVICE,
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.session.not_found",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: {
            ownerUserId: "owner-1",
            profileHandle: "agent",
            profileId: "agt_transient_route_gap",
            profileKind: "agent",
            profileName: "Transient Route Gap Agent",
            status: "active",
          },
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_transient_route_gap",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "not_ready",
      facts: {
        localService: {
          reachable: true,
          refreshable: true,
          reasonCodes: ["local_service.refresh_in_progress"],
          source: "runtime_transport",
        },
        route: {
          online: false,
          reasonCodes: [
            "agent_execution.route_offline",
            "route.not_registered",
          ],
        },
        service: {
          executionCompatible: true,
          reasonCodes: [],
        },
      },
      primaryAction: "check_status",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
      "local_service.not_connected_for_account"
    );
  });

  it("blocks ready route presentation when a required Service update lacks version evidence", async () => {
    useRequiredServiceUpdatePolicy();

    mockReadyBindingAndRuntime("agt_missing_service_version");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      capabilities: {},
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      executionCompatibility: COMPATIBLE_SERVICE,
      lane: "dev-local",
      lastHeartbeatMs: GENERATED_AT_MS,
      leaseEpoch: 1,
      online: true,
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_missing_service_version",
            profileName: "Missing Service Version Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_missing_service_version",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "blocked",
      facts: {
        localService: {
          reachable: true,
          refreshable: false,
          source: "runtime_transport",
        },
        service: {
          executionCompatible: false,
          reasonCodes: [
            "service.update_required",
            "service.version_not_reported",
            "service.release_target_unavailable",
          ],
          source: "runtime_transport",
        },
      },
      primaryAction: "update_service",
    });
    expect(readiness.wakeRouteStatus).toEqual({
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      lastHeartbeatMs: GENERATED_AT_MS,
      leaseEpoch: 1,
      status: "ready",
    });
  });

  it("passes route heartbeat local component evidence into readiness Service update projection", async () => {
    const projectionSpy = useRequiredServiceUpdatePolicy();

    mockReadyBindingAndRuntime("agt_route_components");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      capabilities: {
        localComponents: MATCHING_LOCAL_COMPONENTS_STATUS,
      },
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-components-1",
      deviceId: "device-1",
      executionCompatibility: COMPATIBLE_SERVICE,
      lane: "dev-local",
      lastHeartbeatMs: GENERATED_AT_MS,
      leaseEpoch: 1,
      online: true,
      serviceVersion: "999.0.0",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_route_components",
            profileName: "Route Components Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_route_components",
    });

    expect(projectionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        localComponentsStatus: MATCHING_LOCAL_COMPONENTS_STATUS,
      })
    );
    expect(readiness.agentExecutionReadiness.facts.service).toMatchObject({
      executionCompatible: true,
      reasonCodes: [],
      source: "runtime_transport",
    });
    expect(readiness.agentExecutionReadiness.primaryAction).not.toBe(
      "update_service"
    );
  });

  it("uses fresh controller reports as route-refresh evidence when the owner service lookup is offline", async () => {
    mockReadyBindingAndRuntime("agt_fresh_route_refresh");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.session.not_found",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: {
            ownerUserId: "owner-1",
            profileHandle: "agent",
            profileId: "agt_fresh_route_refresh",
            profileKind: "agent",
            profileName: "Fresh Route Refresh Agent",
            status: "active",
          },
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_fresh_route_refresh",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "not_ready",
      facts: {
        localService: {
          reachable: true,
          refreshable: true,
          reasonCodes: ["local_service.refresh_in_progress"],
          source: "runtime_transport",
        },
      },
      primaryAction: "check_status",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
      "local_service.not_connected_for_account"
    );
    expect(lookupRuntimeTransportOwnerService).toHaveBeenCalledOnce();
  });

  it("does not keep pending-first-report Checking from another device on the same owner", async () => {
    mockReadyBindingAndRuntime("agt_pending_wrong_device");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
      ownerService: {
        capabilities: {},
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-other-device",
        deviceId: "device-2",
        executionCompatibility: COMPATIBLE_SERVICE,
        lane: "dev-local",
        lastHeartbeatMs: GENERATED_AT_MS,
        serviceVersion: "999.0.0",
      },
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: true,
      sessions: [
        {
          capabilities: {},
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-other-device",
          deviceId: "device-2",
          executionCompatibility: COMPATIBLE_SERVICE,
          lane: "dev-local",
          lastHeartbeatMs: GENERATED_AT_MS,
          serviceVersion: "999.0.0",
        },
      ],
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_pending_wrong_device",
            profileName: "Pending Wrong Device Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_pending_wrong_device",
    });

    expect(readiness.agentWakeRouteRegistration).toMatchObject({
      deviceId: "device-2",
      reasonCode: "wake_route.registration_pending_first_report",
      status: "pending",
    });
    expect(readiness.agentExecutionReadiness.facts.localService).toMatchObject({
      reachable: false,
      refreshable: false,
      reasonCodes: ["local_service.identity_mismatch"],
      source: "runtime_transport",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
      "local_service.refresh_in_progress"
    );
  });

  it("collapses an online:false route to terminal offline once the lease is reaped", async () => {
    // The owner service was stopped: its Runtime Transport lease has aged past the
    // freshness TTL and been reaped, so the route lookup is online:false with
    // no lastHeartbeatMs and no wake-route report. Fresh controller reports
    // still mark the local service refreshable, which is exactly the prod
    // repro where the badge regressed from Offline back to a permanent
    // "Checking". ServiceRuntime liveness (the reaped lease) is the single
    // source of truth, so the registration must be a terminal offline verdict.
    mockReadyBindingAndRuntime("agt_route_lease_reaped");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.session.not_found",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_route_lease_reaped",
            profileName: "Route Lease Reaped Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_route_lease_reaped",
    });

    expect(readiness.agentExecutionReadiness.facts.localService).toMatchObject({
      reachable: true,
      refreshable: true,
    });
    expect(readiness.agentWakeRouteRegistration).toMatchObject({
      reasonCode: "wake_route.registration_expired",
      status: "expired",
    });
    expect(
      resolveAgentWakeAvailability({
        agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
        readiness: readiness.agentExecutionReadiness,
        wakeRouteStatus: readiness.wakeRouteStatus,
      })
    ).toMatchObject({
      badgeLabel: "Offline",
      category: "offline",
      phase: "offline",
      reasonCode: "agent_execution.route_offline",
      status: "offline_for_wake",
    });
  });

  it("collapses a reaped lease to offline even when the report omits the profile", async () => {
    // Same reaped-lease liveness verdict, but the surviving wake-route report
    // simply does not cover this profile. That is still stable service-offline
    // evidence (no lastHeartbeatMs), not an in-flight registration.
    mockReadyBindingAndRuntime("agt_route_report_omits");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
      localWakeRouteReport: {
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        includedProfileIds: ["agt_other_profile"],
        lane: "dev-local",
        reportedAtMs: GENERATED_AT_MS,
        skippedProfiles: [],
      },
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.session.not_found",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_route_report_omits",
            profileName: "Route Report Omits Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_route_report_omits",
    });

    expect(readiness.agentWakeRouteRegistration).toMatchObject({
      reasonCode: "wake_route.registration_expired",
      status: "expired",
    });
  });

  it("surfaces daemon route skip reports as explicit unavailable evidence", async () => {
    mockReadyBindingAndRuntime("agt_route_skipped");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
      localWakeRouteReport: {
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        includedProfileIds: [],
        lane: "dev-local",
        reportedAtMs: GENERATED_AT_MS,
        skippedProfiles: [
          {
            profileId: "agt_route_skipped",
            profileName: "Skipped Agent",
            skipReason: "controller.registry.disabled",
          },
        ],
      },
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.session.not_found",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_route_skipped",
            profileName: "Route Skipped Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_route_skipped",
    });

    expect(readiness.agentWakeRouteRegistration).toMatchObject({
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      reasonCode: "controller.registry.disabled",
      reportedAtMs: GENERATED_AT_MS,
      status: "skipped",
    });
    expect(
      resolveAgentWakeAvailability({
        agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
        readiness: readiness.agentExecutionReadiness,
        wakeRouteStatus: readiness.wakeRouteStatus,
      })
    ).toMatchObject({
      category: "unavailable",
      phase: "connect_local_agent",
      reasonCode: "controller.registry.disabled",
      status: "unavailable_for_wake",
    });
  });

  it("keeps a report-covered profile on Checking while the lease is still fresh", async () => {
    // The wake-route report STILL covers this profile (its id is in
    // includedProfileIds) but the route lookup is offline with a live lease
    // (lastHeartbeatMs present = socket mid-replacement, e.g. a Cloudflare 1006
    // blip). This must stay transient pending/Checking, not flip to a terminal
    // Offline -- the production Available<->Offline flap was exactly this
    // report-covered + fresh-lease case, which the report-presence check used
    // to collapse straight to Offline.
    mockReadyBindingAndRuntime("agt_route_report_covers_fresh");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
      lastHeartbeatMs: GENERATED_AT_MS,
      localWakeRouteReport: {
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        includedProfileIds: ["agt_route_report_covers_fresh"],
        lane: "dev-local",
        reportedAtMs: GENERATED_AT_MS,
        skippedProfiles: [],
      },
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.session.not_found",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_route_report_covers_fresh",
            profileName: "Route Report Covers Fresh Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_route_report_covers_fresh",
    });

    expect(readiness.agentWakeRouteRegistration).toMatchObject({
      reasonCode: "wake_route.registration_pending",
      status: "pending",
    });
    expect(readiness.wakeRouteStatus).toMatchObject({
      status: "checking",
    });
  });

  it("collapses a report-covered profile to Offline once the lease is reaped", async () => {
    // Report still covers the profile but there is no lastHeartbeatMs = the
    // lease was reaped past the TTL = stable service-offline. This must settle
    // on a terminal Offline (the bounded-transient contract), not linger on
    // Checking.
    mockReadyBindingAndRuntime("agt_route_report_covers_reaped");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
      localWakeRouteReport: {
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        includedProfileIds: ["agt_route_report_covers_reaped"],
        lane: "dev-local",
        reportedAtMs: GENERATED_AT_MS,
        skippedProfiles: [],
      },
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.session.not_found",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_route_report_covers_reaped",
            profileName: "Route Report Covers Reaped Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_route_report_covers_reaped",
    });

    expect(readiness.agentWakeRouteRegistration).toMatchObject({
      reasonCode: "wake_route.registration_expired",
      status: "expired",
    });
  });

  it("keeps a fresh-lease offline lookup as a transient pending registration", async () => {
    mockReadyBindingAndRuntime("agt_route_delivery_reconnecting");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
      lastHeartbeatMs: GENERATED_AT_MS,
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.session.not_found",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_route_delivery_reconnecting",
            profileName: "Route Delivery Reconnecting Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_route_delivery_reconnecting",
    });

    expect(readiness.agentExecutionReadiness.facts.localService).toMatchObject({
      reachable: true,
      refreshable: true,
    });
    expect(readiness.agentWakeRouteRegistration).toMatchObject({
      reasonCode: "wake_route.registration_pending",
      status: "pending",
    });
    expect(
      resolveAgentWakeAvailability({
        agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
        readiness: readiness.agentExecutionReadiness,
        wakeRouteStatus: readiness.wakeRouteStatus,
      })
    ).toMatchObject({
      badgeLabel: "Reconnecting",
      category: "checking",
      label: "Reconnecting Computer",
      phase: "checking_route",
      reasonCode: "local_service.reconnecting",
      status: "checking_connection",
    });
  });

  it("keeps a new profile on Checking when the owner service is fresh but no route lease has reported yet", async () => {
    mockReadyBindingAndRuntime("agt_route_pending_first_report");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.pending_first_report",
      ownerService: {
        capabilities: {},
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        executionCompatibility: COMPATIBLE_SERVICE,
        lane: "dev-local",
        lastHeartbeatMs: GENERATED_AT_MS,
        serviceVersion: "999.0.0",
      },
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: true,
      sessions: [
        {
          capabilities: {},
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          deviceId: "device-1",
          executionCompatibility: COMPATIBLE_SERVICE,
          lane: "dev-local",
          lastHeartbeatMs: GENERATED_AT_MS,
          serviceVersion: "999.0.0",
        },
      ],
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_route_pending_first_report",
            profileName: "Pending First Report Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_route_pending_first_report",
    });

    expect(readiness.agentExecutionReadiness.facts.localService).toMatchObject({
      reachable: true,
      refreshable: true,
    });
    expect(readiness.agentWakeRouteRegistration).toMatchObject({
      reasonCode: "wake_route.registration_pending_first_report",
      status: "pending",
    });
    expect(readiness.wakeRouteStatus).toMatchObject({
      status: "checking",
    });
    expect(
      resolveAgentWakeAvailability({
        agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
        readiness: readiness.agentExecutionReadiness,
        wakeRouteStatus: readiness.wakeRouteStatus,
      })
    ).toMatchObject({
      category: "checking",
      phase: "checking_route",
      reasonCode: "wake_route.registration_pending_first_report",
      status: "checking_connection",
    });
  });

  it("keeps a fresh lease with a mid-replacement socket on Checking, not Offline", async () => {
    mockReadyBindingAndRuntime("agt_route_lease_fresh_no_delivery");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
      lastHeartbeatMs: GENERATED_AT_MS,
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.session.not_found",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_route_lease_fresh_no_delivery",
            profileName: "Route Lease Fresh No Delivery Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_route_lease_fresh_no_delivery",
    });

    expect(readiness.agentWakeRouteRegistration).toMatchObject({
      reasonCode: "wake_route.registration_pending",
      status: "pending",
    });
    expect(readiness.wakeRouteStatus).toMatchObject({
      status: "checking",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).toContain(
      "local_service.reconnecting"
    );
    expect(
      resolveAgentWakeAvailability({
        agentControllerRef: readiness.agentControllerRef,
        agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
        readiness: readiness.agentExecutionReadiness,
        wakeRouteStatus: readiness.wakeRouteStatus,
      })
    ).toMatchObject({
      badgeLabel: "Reconnecting",
      category: "checking",
      label: "Reconnecting Computer",
      phase: "checking_route",
      reasonCode: "local_service.reconnecting",
      status: "checking_connection",
      summary: "Computer is reconnecting.",
    });
  });

  it("projects an unauthenticated Codex report as unavailable with sign-in guidance", async () => {
    const profileId = "agt_codex_sign_in_warning";
    mockReadyBindingAndRuntime(profileId);
    vi.mocked(readCurrentRuntimeAgentControllerReports).mockResolvedValueOnce([
      {
        agentControllerRef: "builtin:codex",
        expiresAtMs: GENERATED_AT_MS + 60_000,
        observedAtMs: GENERATED_AT_MS,
        reasonCodes: [
          "provider_account.access_required",
          "controller.auth.unauthenticated",
        ],
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-1",
        },
        status: "unavailable",
      },
    ]);
    mockOnlineRoute("device-1");

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId,
            profileName: "Codex Sign-in Warning Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId,
    });

    expect(readiness.agentExecutionReadiness.facts.runtime).toMatchObject({
      ready: false,
      reasonCodes: expect.arrayContaining([
        "provider_account.access_required",
        "controller.auth.unauthenticated",
      ]),
      source: "prepare_readiness",
    });
    expect(
      resolveAgentWakeAvailability({
        agentControllerRef: readiness.agentControllerRef,
        agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
        readiness: readiness.agentExecutionReadiness,
        wakeRouteStatus: readiness.wakeRouteStatus,
      })
    ).toMatchObject({
      action: "none",
      badgeLabel: "Sign-in needed",
      category: "unavailable",
      phase: "provider_sign_in_needed",
      reasonCode: "controller.auth.unauthenticated",
      status: "unavailable_for_wake",
      summary:
        "Run codex login in a terminal on this computer to sign in to Codex.",
    });
  });

  it("fails closed on a missing current working-folder report without pretending the Computer is offline or needs setup", async () => {
    const profileId = "agt_working_folder_report_missing";
    mockReadyBindingAndRuntime(profileId);
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      capabilities: {},
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      executionCompatibility: COMPATIBLE_SERVICE,
      lane: "dev-local",
      lastHeartbeatMs: GENERATED_AT_MS,
      leaseEpoch: 1,
      online: true,
      serviceVersion: "999.0.0",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId,
            profileName: "Missing Working Folder Report Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId,
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "not_ready",
      facts: {
        localService: { reachable: true },
        runtime: {
          ready: false,
          reasonCodes: expect.arrayContaining([
            "working_folder.current_report_missing",
          ]),
        },
      },
      primaryAction: "check_status",
    });
    expect(readiness.agentExecutionReadiness.primaryAction).not.toBe(
      "connect_service"
    );
    expect(readiness.agentExecutionReadiness.primaryAction).not.toBe(
      "run_prepare"
    );
    expect(
      resolveAgentWakeAvailability({
        agentControllerRef: readiness.agentControllerRef,
        agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
        readiness: readiness.agentExecutionReadiness,
        wakeRouteStatus: readiness.wakeRouteStatus,
      })
    ).toMatchObject({
      category: "checking",
      reasonCode: "working_folder.current_report_missing",
    });
    expect(
      resolveAgentWakeAdmissionBlockReasonCode(
        readiness.agentExecutionReadiness
      )
    ).toBe("working_folder.current_report_missing");
  });

  it("requires an OpenMeld update when an online legacy Service cannot report current working-folder truth", async () => {
    const profileId = "agt_legacy_working_folder_contract";
    mockReadyBindingAndRuntime(profileId);
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      capabilities: {},
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      executionCompatibility: COMPATIBLE_SERVICE,
      lane: "dev-local",
      lastHeartbeatMs: GENERATED_AT_MS,
      leaseEpoch: 1,
      localWakeRouteReport: {
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        includedProfileIds: [profileId],
        lane: "dev-local",
        reportedAtMs: GENERATED_AT_MS,
        skippedProfiles: [],
      },
      online: true,
      serviceVersion: "998.0.0",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId,
            profileName: "Legacy Working Folder Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId,
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "not_ready",
      primaryAction: "update_service",
      facts: {
        localService: { reachable: true },
        runtime: {
          ready: false,
          reasonCodes: expect.arrayContaining([
            "working_folder.legacy_contract",
            "service.update_required",
          ]),
        },
      },
    });
    expect(
      resolveAgentWakeAvailability({
        agentControllerRef: readiness.agentControllerRef,
        agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
        readiness: readiness.agentExecutionReadiness,
        wakeRouteStatus: readiness.wakeRouteStatus,
      })
    ).toMatchObject({
      category: "unavailable",
      phase: "service_update_required",
      reasonCode: "service.update_required",
    });
    expect(
      resolveAgentWakeAdmissionBlockReasonCode(
        readiness.agentExecutionReadiness
      )
    ).toBe("service.update_required");
  });

  it("keeps a ready target wakeable when an unrelated working-folder observation is stale", async () => {
    const profileId = "agt_independent_working_folder";
    mockReadyBindingAndRuntime(profileId);
    const route = mockOnlineRoute("device-1");
    const observation = route.localWakeRouteReport.workingFolderObservations[0];
    if (!observation) {
      throw new Error("Expected a target working-folder observation");
    }
    route.localWakeRouteReport.workingFolderObservations.push({
      ...observation,
      profileId: "agt_unrelated",
      bindingId: "binding-unrelated",
      observedAtMs: GENERATED_AT_MS - 100_000,
    });
    const resolveProfileById = vi.fn().mockResolvedValue({
      ok: true,
      profile: createActiveAgentProfile({
        profileId,
        profileName: "Independent Agent",
      }),
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({ resolveProfileById }),
      generatedAt: GENERATED_AT,
      profileId,
    });

    expect(
      resolveAgentWakeAdmissionBlockReasonCode(
        readiness.agentExecutionReadiness
      )
    ).toBeNull();
    expect(
      localRuntimeExpectedRoutesService.readLocalRuntimeExpectedRoutes
    ).not.toHaveBeenCalled();
    expect(resolveProfileById).toHaveBeenCalledTimes(1);
  });

  it("requires a fresh target report after its Core Binding revision changes", async () => {
    const profileId = "agt_changed_binding";
    mockReadyBindingAndRuntime(profileId);
    mockOnlineRoute("device-1");
    const binding = await readPrimaryAgentProfileBindingRecord({
      agentProfileId: profileId,
      db: new PostgresDatabase({
        connectionString:
          "postgresql://127.0.0.1:1/unexpected_test_database_access",
      }),
      owner: { kind: "owner_account", id: "owner-1" },
    });
    if (!binding) {
      throw new Error("Expected the target Binding fixture");
    }
    vi.mocked(readPrimaryAgentProfileBindingRecord).mockResolvedValue({
      ...binding,
      configurationRevision: 2,
    });
    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId,
            profileName: "Changed Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId,
    });
    expect(
      resolveAgentWakeAdmissionBlockReasonCode(
        readiness.agentExecutionReadiness
      )
    ).toBe("working_folder.observation_identity_mismatch");
  });

  it("uses the target's current Auth Default Project and reads it again on the next request", async () => {
    const profileId = "agt_changed_project";
    mockReadyBindingAndRuntime(profileId);
    const profile = createActiveAgentProfile({
      profileId,
      profileName: "Project Agent",
    });
    const resolveProfileById = vi.fn().mockResolvedValue({
      ok: true,
      profile: { ...profile, defaultProjectId: "project-new" },
    });
    const input = {
      env: createCoreEnv({ resolveProfileById }),
      generatedAt: GENERATED_AT,
      profileId,
    };
    mockOnlineRoute("device-1");
    const changed = await resolveCoreAgentExecutionReadinessForProfile(input);
    expect(
      resolveAgentWakeAdmissionBlockReasonCode(changed.agentExecutionReadiness)
    ).toBe("working_folder.observation_identity_mismatch");

    resolveProfileById.mockResolvedValue({ ok: true, profile });
    mockOnlineRoute("device-1");
    const restored = await resolveCoreAgentExecutionReadinessForProfile(input);
    expect(
      resolveAgentWakeAdmissionBlockReasonCode(restored.agentExecutionReadiness)
    ).toBeNull();
    expect(resolveProfileById).toHaveBeenCalledTimes(2);
  });

  it("does not accept another Profile's identity from a target lookup", async () => {
    const profileId = "agt_identity_target";
    mockReadyBindingAndRuntime(profileId);
    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_other",
            profileName: "Other Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId,
    });
    expect(readiness.agentExecutionReadiness.facts.profile).toMatchObject({
      active: false,
      reasonCodes: ["agent_profile.identity_lookup_failed"],
    });
    expect(
      resolveAgentWakeAdmissionBlockReasonCode(
        readiness.agentExecutionReadiness
      )
    ).not.toBeNull();
  });

  it("uses a fresh current working-folder failure instead of reconstructing readiness from older evidence", async () => {
    const profileId = "agt_current_workspace_missing";
    mockReadyBindingAndRuntime(profileId);
    mockOnlineRoute("device-1");
    vi.mocked(lookupRuntimeTransportRoute)
      .mockReset()
      .mockResolvedValueOnce({
        capabilities: {},
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        executionCompatibility: COMPATIBLE_SERVICE,
        lane: "dev-local",
        lastHeartbeatMs: GENERATED_AT_MS,
        leaseEpoch: 1,
        localWakeRouteReport: {
          daemonSessionId: "daemon-session-1",
          deviceId: "device-1",
          expectedRoutesContractVersion: "v4",
          includedProfileIds: [profileId],
          lane: "dev-local",
          reportedAtMs: GENERATED_AT_MS,
          skippedProfiles: [],
          workingFolderObservations: [
            {
              bindingId: "binding-1",
              configurationRevision: 1,
              defaultProjectId: null,
              localProjectBindingGeneration: null,
              observedAtMs: GENERATED_AT_MS,
              profileId,
              reasonCode: "profile.workspace.missing",
              source: "profile_workspace",
              status: "missing",
            },
          ],
        },
        online: true,
        serviceVersion: "999.0.0",
      });
    vi.mocked(
      readFreshAgentExecutionReadinessImpactForBinding
    ).mockResolvedValueOnce({
      expiresAtMs: GENERATED_AT_MS + 60_000,
      impactKind: "local_execution",
      observedAtMs: GENERATED_AT_MS - 1000,
      reasonCode: "workspace.invalid",
      source: "wake_failure",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId,
            profileName: "Current Workspace Missing Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId,
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "not_ready",
      facts: {
        runtime: {
          ready: false,
          reasonCodes: expect.arrayContaining(["profile.workspace.missing"]),
        },
      },
      primaryAction: "run_prepare",
    });
    expect(
      readiness.agentExecutionReadiness.facts.runtime.reasonCodes
    ).not.toContain("workspace.invalid");
    expect(
      readiness.agentExecutionReadiness.facts.readinessImpact
    ).toMatchObject({
      impactKind: "local_execution",
      source: "wake_failure",
    });
    expect(
      resolveAgentWakeAvailability({
        agentControllerRef: readiness.agentControllerRef,
        agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
        readiness: readiness.agentExecutionReadiness,
        wakeRouteStatus: readiness.wakeRouteStatus,
      })
    ).toMatchObject({
      category: "unavailable",
      reasonCode: "profile.workspace.missing",
    });
    expect(
      resolveAgentWakeAdmissionBlockReasonCode(
        readiness.agentExecutionReadiness
      )
    ).toBe("profile.workspace.missing");
  });

  it("keeps stale owner-service disconnects as service-disconnected guidance", async () => {
    mockReadyBindingAndRuntime("agt_stale_service_disconnect");
    vi.mocked(readCurrentRuntimeAgentControllerReports).mockResolvedValueOnce([
      {
        agentControllerRef: "builtin:codex",
        expiresAtMs: GENERATED_AT_MS - 1,
        observedAtMs: GENERATED_AT_MS - 120_000,
        reasonCodes: ["runtime.ready"],
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-1",
        },
        status: "ready",
      },
    ]);
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
    });
    vi.mocked(lookupRuntimeTransportOwnerService).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.session.not_found",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: {
            ownerUserId: "owner-1",
            profileHandle: "agent",
            profileId: "agt_stale_service_disconnect",
            profileKind: "agent",
            profileName: "Stale Service Disconnect Agent",
            status: "active",
          },
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_stale_service_disconnect",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "not_ready",
      facts: {
        localService: {
          reachable: false,
          refreshable: false,
          reasonCodes: ["local_service.not_connected_for_account"],
          source: "runtime_transport",
        },
      },
      primaryAction: "connect_service",
    });
  });

  it("uses the Core connected computer projection for the runtime display name", async () => {
    mockReadyBindingAndRuntime("agt_connected_display");
    mockOnlineRoute("device-1");
    vi.mocked(resolveCurrentDeviceFromBindings).mockResolvedValueOnce({
      availability: "resolved",
      deviceId: "device-1",
      runtimeLane: "dev-local",
    });
    vi.mocked(listOwnedDeviceRegistryRecords).mockResolvedValueOnce([
      createOwnedDeviceRecord({
        connectedComputerId: "computer_felix_macbook",
        deviceId: "device-1",
        observedDisplayName: "Felix's MacBook Pro",
      }),
    ]);
    vi.mocked(listOwnedDeviceExecutionTargetRecords).mockResolvedValueOnce([
      createExecutionTargetRecord({
        deviceId: "device-1",
        openMeldServiceRuntimeId: "runtime-1",
      }),
    ]);

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_connected_display",
            profileName: "Connected Display Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_connected_display",
    });

    expect(readiness.runtimeDeviceDisplayName).toBe("Felix's MacBook Pro");
    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "ready",
      facts: {
        binding: {
          routable: true,
        },
      },
    });
  });

  it("skips owner-wide computer inventory when runtime display enrichment is not requested", async () => {
    mockReadyBindingAndRuntime("agt_without_runtime_display");
    mockOnlineRoute("device-1");

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_without_runtime_display",
            profileName: "Wake Admission Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      includeRuntimeDeviceDisplayName: false,
      profileId: "agt_without_runtime_display",
    });

    expect(readiness.runtimeDeviceDisplayName).toBeNull();
    expect(listOwnedDeviceRegistryRecords).not.toHaveBeenCalled();
    expect(listOwnedDeviceExecutionTargetRecords).not.toHaveBeenCalled();
  });

  it.each([
    ["announced", "chatgpt", false],
    ["withdrawn", "chatgpt", true],
    ["withdrawn", "apiKey", false],
    ["withdrawn", undefined, false],
  ] as const)("uses reviewed %s scope for %s at canonical Wake admission", async (status, authType, blocked) => {
    const catalog = modelCatalogSource.readAuthoredModelCatalog();
    const model = catalog.agentControllers.codex?.models.find(
      (entry) => entry.id === "gpt-5.4"
    );
    if (!model) {
      throw new Error("Fixture needs GPT-5.4");
    }
    model.retirement = {
      status,
      date: { value: "2000-01-01", kind: "on" },
      scope: { controllerRef: "builtin:codex", authType: "chatgpt" },
      sourceUrl: "https://example.com/official-notice",
      verifiedAt: GENERATED_AT,
    };
    vi.spyOn(modelCatalogSource, "readAuthoredModelCatalog").mockReturnValue(
      catalog
    );
    mockReadyBindingAndRuntime(
      "agt_retirement",
      "builtin:codex",
      "existing-thread",
      model.id
    );
    mockOnlineRoute("device-1");
    const report = createRuntimeReportWithUsage(
      createUsageLimit({ status: "available", usedPercent: 42 })
    );
    vi.mocked(readCurrentRuntimeAgentControllerReports).mockResolvedValueOnce([
      {
        ...report,
        agentControllerInterface: {
          ...report.agentControllerInterface,
          auth: {
            status: "authenticated",
            ...(authType ? { type: authType } : {}),
          },
        },
      },
    ]);
    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_retirement",
            profileName: "Research",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_retirement",
    });
    const reason = resolveAgentWakeAdmissionBlockReasonCode(
      readiness.agentExecutionReadiness
    );
    if (blocked) {
      expect(reason).toBe("model.retired");
      expect(
        resolveAgentWakeAvailability({
          agentControllerRef: readiness.agentControllerRef,
          agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
          readiness: readiness.agentExecutionReadiness,
          wakeRouteStatus: readiness.wakeRouteStatus,
        })
      ).toMatchObject({
        status: "unavailable_for_wake",
        reasonCode: "model.retired",
      });
    } else {
      expect(reason).toBeNull();
      expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
        "model.retired"
      );
    }
  });

  it("does not apply withdrawal using stale or another runtime's account evidence", () => {
    const catalog = modelCatalogSource.readAuthoredModelCatalog();
    const model = catalog.agentControllers.codex?.models.find(
      (entry) => entry.id === "gpt-5.4"
    );
    if (!model) {
      throw new Error("Fixture needs GPT-5.4");
    }
    model.retirement = {
      status: "withdrawn",
      date: null,
      scope: { controllerRef: "builtin:codex", authType: "chatgpt" },
      sourceUrl: "https://example.com/official-notice",
      verifiedAt: GENERATED_AT,
    };
    const report = createRuntimeReportWithUsage(
      createUsageLimit({ status: "available", usedPercent: 42 })
    );
    const currentReport = {
      ...report,
      agentControllerInterface: {
        ...report.agentControllerInterface,
        auth: { status: "authenticated" as const, type: "chatgpt" },
      },
    };
    const input = {
      catalog,
      currentReport,
      modelId: model.id,
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime-1",
      nowMs: GENERATED_AT_MS,
    };
    expect(resolveCurrentAgentModelAvailability(input)).toMatchObject({
      available: false,
      reasonCode: "model.retired",
    });
    expect(
      resolveCurrentAgentModelAvailability({
        ...input,
        openMeldServiceRuntimeId: "other-runtime",
      })
    ).toEqual({ available: true });
    expect(
      resolveCurrentAgentModelAvailability({
        ...input,
        nowMs: report.expiresAtMs,
      })
    ).toEqual({ available: true });
    expect(
      resolveCurrentAgentModelAvailability({ ...input, modelId: null })
    ).toEqual({ available: true });
  });

  it.each([
    true,
    false,
    null,
  ] as const)("uses Codex account capacity (%s) while retaining an exhausted window", async (blocksNewWork) => {
    mockReadyBindingAndRuntime("agt_usage_exhausted", "builtin:codex");
    mockOnlineRoute("device-1");
    vi.mocked(readCurrentRuntimeAgentControllerReports).mockResolvedValueOnce([
      createRuntimeReportWithUsage(
        createUsageLimit({ status: "exhausted", usedPercent: 100 }),
        "builtin:codex",
        { blocksNewWork, observedAt: GENERATED_AT }
      ),
    ]);

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_usage_exhausted",
            profileName: "Usage Exhausted Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_usage_exhausted",
    });

    if (blocksNewWork !== true) {
      expect(readiness.agentExecutionReadiness).toMatchObject({
        displayState: "ready",
        primaryAction: "none",
      });
      expect(
        resolveAgentWakeAdmissionBlockReasonCode(
          readiness.agentExecutionReadiness
        )
      ).toBeNull();
      return;
    }

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "not_ready",
      facts: {
        providerAccount: {
          provider: null,
        },
      },
      primaryAction: "check_status",
      reasonCodes: expect.arrayContaining(["usage_exhausted"]),
    });
    expect(
      resolveAgentWakeAvailability({
        agentControllerRef: readiness.agentControllerRef,
        agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
        readiness: readiness.agentExecutionReadiness,
        wakeRouteStatus: readiness.wakeRouteStatus,
      })
    ).toMatchObject({
      action: "check_status",
      category: "unavailable",
      label: "Usage Limit reached",
      phase: "provider_blocked",
      reasonCode: "usage_exhausted",
      status: "unavailable_for_wake",
    });
  });

  it("admits an otherwise ready target when its auxiliary Usage read is unavailable", async () => {
    mockReadyBindingAndRuntime("agt_usage_checking", "builtin:codex");
    mockOnlineRoute("device-1");
    vi.mocked(readCurrentRuntimeAgentControllerReports).mockResolvedValueOnce([
      createRuntimeReportWithUsage(
        createUsageLimit({ status: "unavailable", usedPercent: null })
      ),
    ]);

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_usage_checking",
            profileName: "Usage Checking Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_usage_checking",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "ready",
      primaryAction: "none",
    });
    expect(
      resolveAgentWakeAvailability({
        agentControllerRef: readiness.agentControllerRef,
        agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
        readiness: readiness.agentExecutionReadiness,
        wakeRouteStatus: readiness.wakeRouteStatus,
      })
    ).toMatchObject({
      status: "available_for_wake",
    });
    expect(
      resolveAgentWakeAdmissionBlockReasonCode(
        readiness.agentExecutionReadiness
      )
    ).toBeNull();
  });

  it("waits for a connected Service that temporarily closes admission without claiming the Agent is available", async () => {
    const profileId = "agt_host_admission_paused";
    mockReadyBindingAndRuntime(profileId);
    const route = mockOnlineRoute("device-1");
    vi.mocked(lookupRuntimeTransportRoute).mockReset();
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      ...route,
      acceptingDispatches: false,
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId,
            profileName: "Temporarily Paused Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId,
    });

    expect(readiness.agentExecutionReadiness.displayState).not.toBe("ready");
    expect(
      resolveAgentWakeAdmissionBlockReasonCode(
        readiness.agentExecutionReadiness
      )
    ).toBe("local_service.not_accepting_wakes");
    expect(
      resolveAgentWakeAvailability({
        agentControllerRef: readiness.agentControllerRef,
        agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
        readiness: readiness.agentExecutionReadiness,
        wakeRouteStatus: readiness.wakeRouteStatus,
      })
    ).toMatchObject({
      category: "checking",
      reasonCode: "local_service.not_accepting_wakes",
      status: "checking_connection",
    });
  });

  it("still blocks when the Controller readiness report itself has expired", async () => {
    const profileId = "agt_usage_expired";
    mockReadyBindingAndRuntime(profileId, "builtin:codex");
    mockOnlineRoute("device-1");
    vi.mocked(readCurrentRuntimeAgentControllerReports).mockResolvedValueOnce([
      {
        ...createRuntimeReportWithUsage(
          createUsageLimit({ status: "available", usedPercent: 15 })
        ),
        expiresAtMs: GENERATED_AT_MS - 1,
      },
    ]);

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId,
            profileName: "Expired Usage Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId,
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "not_ready",
      primaryAction: "check_status",
      reasonCodes: expect.arrayContaining([
        "runtime.agent_controller_report_stale",
      ]),
    });
    expect(
      resolveAgentWakeAvailability({
        agentControllerRef: readiness.agentControllerRef,
        agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
        readiness: readiness.agentExecutionReadiness,
        wakeRouteStatus: readiness.wakeRouteStatus,
      })
    ).toMatchObject({
      category: "checking",
      status: "checking_connection",
    });
    expect(
      resolveAgentWakeAdmissionBlockReasonCode(
        readiness.agentExecutionReadiness
      )
    ).toBe("agent_execution.readiness_unconfirmed");
  });

  it("keeps explicitly unsupported Usage out of Wakeability", async () => {
    mockReadyBindingAndRuntime("agt_usage_unsupported", "builtin:cursor");
    mockOnlineRoute("device-1");
    vi.mocked(readCurrentRuntimeAgentControllerReports).mockResolvedValueOnce([
      createRuntimeReportWithUsage(
        createUsageLimit({ status: "unsupported", usedPercent: null }),
        "builtin:cursor"
      ),
    ]);

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_usage_unsupported",
            profileName: "Usage Unsupported Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_usage_unsupported",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "ready",
      primaryAction: "none",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
      "usage_checking"
    );
  });

  it("checks only the provider selected by an OpenCode binding", async () => {
    const model = modelCatalogSource
      .readAuthoredModelCatalog()
      .agentControllers.opencode?.models.find(
        (entry) => entry.id.startsWith("opencode-go/") && !entry.unavailable
      );
    if (!model) {
      throw new Error("Fixture requires a cataloged OpenCode Go model");
    }
    mockReadyBindingAndRuntime(
      "agt_opencode_provider_usage",
      "builtin:opencode",
      undefined,
      model.id
    );
    mockOnlineRoute("device-1");
    const selectedProviderLimit = {
      ...createUsageLimit({ status: "available", usedPercent: 43 }),
      key: "opencode-go:rolling",
      provider: { displayName: "OpenCode Go", id: "opencode-go" },
    };
    const baseReport = createRuntimeReportWithUsage(
      selectedProviderLimit,
      "builtin:opencode"
    );
    vi.mocked(readCurrentRuntimeAgentControllerReports).mockResolvedValueOnce([
      {
        ...baseReport,
        agentControllerInterface: {
          ...baseReport.agentControllerInterface,
          usageLimits: [
            selectedProviderLimit,
            {
              ...createUsageLimit({ status: "exhausted", usedPercent: 100 }),
              key: "openai:provider",
              provider: { displayName: "OpenAI", id: "openai" },
            },
          ],
        },
      },
    ]);

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_opencode_provider_usage",
            profileName: "OpenCode Provider Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_opencode_provider_usage",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "ready",
      primaryAction: "none",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
      "usage_exhausted"
    );
  });

  it.each([
    true,
    false,
  ])("preserves a proven Codex refusal as diagnostic evidence with current sign-in (%s)", async (signedIn) => {
    mockReadyBindingAndRuntime("agt_provider_access", "builtin:codex");
    vi.mocked(readCurrentRuntimeAgentControllerReports).mockResolvedValueOnce(
      signedIn
        ? [
            createRuntimeReportWithUsage(
              createUsageLimit({ status: "exhausted", usedPercent: 100 }),
              "builtin:codex",
              { blocksNewWork: false, observedAt: GENERATED_AT }
            ),
          ]
        : [
            {
              agentControllerRef: "builtin:codex",
              expiresAtMs: GENERATED_AT_MS + 60_000,
              observedAtMs: GENERATED_AT_MS,
              reasonCodes: [
                "provider_account.access_required",
                "controller.auth.unauthenticated",
              ],
              openMeldServiceRuntimeId: {
                source: "runtime_registry_authority",
                value: "runtime-1",
              },
              status: "unavailable",
            },
          ]
    );
    mockOnlineRoute("device-1");
    vi.mocked(readFreshProviderAccessEvidenceForBinding).mockResolvedValueOnce({
      expiresAtMs: GENERATED_AT_MS + 60 * 60 * 1000,
      observedAtMs: GENERATED_AT_MS,
      provider: "codex",
      reasonCode: "usage_exhausted",
      source: "wake_failure",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_provider_access",
            profileName: "Provider Access Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_provider_access",
    });

    expect(readFreshProviderAccessEvidenceForBinding).toHaveBeenCalledWith({
      agentProfileId: "agt_provider_access",
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
      db: expect.anything(),
      nowMs: GENERATED_AT_MS,
      openMeldServiceRuntimeId: "runtime-1",
    });
    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: signedIn ? "ready" : "not_ready",
      facts: {
        providerAccount: {
          blocked: true,
          provider: "codex",
          reasonCodes: ["usage_exhausted"],
          source: "wake_failure",
        },
      },
      primaryAction: signedIn ? "none" : "run_prepare",
    });
    expect(
      resolveAgentWakeAvailability({
        agentControllerRef: readiness.agentControllerRef,
        agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
        readiness: readiness.agentExecutionReadiness,
        wakeRouteStatus: readiness.wakeRouteStatus,
      })
    ).toMatchObject(
      signedIn
        ? {
            status: "available_for_wake",
          }
        : {
            action: "none",
            badgeLabel: "Sign-in needed",
            category: "unavailable",
            phase: "provider_sign_in_needed",
            reasonCode: "controller.auth.unauthenticated",
            status: "unavailable_for_wake",
            summary:
              "Run codex login in a terminal on this computer to sign in to Codex.",
          }
    );
  });

  it("keeps historical execution impact diagnostic without deciding current Wakeability", async () => {
    mockReadyBindingAndRuntime("agt_readiness_impact", "builtin:codex");
    mockOnlineRoute("device-1");
    vi.mocked(
      readFreshAgentExecutionReadinessImpactForBinding
    ).mockResolvedValueOnce({
      expiresAtMs: GENERATED_AT_MS + 30 * 60 * 1000,
      impactKind: "local_execution",
      observedAtMs: GENERATED_AT_MS,
      reasonCode: "controller.client.upgrade_required",
      source: "wake_failure",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_readiness_impact",
            profileName: "Readiness Impact Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_readiness_impact",
    });

    expect(
      readFreshAgentExecutionReadinessImpactForBinding
    ).toHaveBeenCalledWith({
      agentProfileId: "agt_readiness_impact",
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
      db: expect.anything(),
      nowMs: GENERATED_AT_MS,
      openMeldServiceRuntimeId: "runtime-1",
    });
    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "ready",
      facts: {
        readinessImpact: {
          blocked: true,
          impactKind: "local_execution",
          reasonCodes: ["controller.client.upgrade_required"],
          source: "wake_failure",
        },
      },
      primaryAction: "none",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
      "controller.client.upgrade_required"
    );
  });

  it("keeps failed Codex App Server conversation proof diagnostic without blocking readiness", async () => {
    mockReadyBindingAndRuntime(
      "agt_provider_conversation_failed",
      "builtin:codex",
      "thread-ctx-1"
    );
    mockOnlineRoute("device-1");
    vi.mocked(
      readFreshProviderConversationProofForBinding
    ).mockResolvedValueOnce({
      agentProfileId: "agt_provider_conversation_failed",
      agentControllerConversationId: "thread-ctx-1",
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime-1",
      },
      bindingId: "binding-1",
      errorCode: "process.timeout",
      errorMessage: "codex app-server did not complete within 30000ms",
      errorType: "timeout",
      expiresAtMs: GENERATED_AT_MS + 10 * 60_000,
      intrusive: false,
      method: "codex_app_server_thread_resume",
      observedAtMs: GENERATED_AT_MS,
      provider: "codex",
      status: "failed",
      transportMode: "codex-app-server",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_provider_conversation_failed",
            profileName: "Provider Conversation Failed Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_provider_conversation_failed",
    });

    expect(readFreshProviderConversationProofForBinding).toHaveBeenCalledWith({
      agentProfileId: "agt_provider_conversation_failed",
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
      agentControllerConversationId: "thread-ctx-1",
      db: expect.anything(),
      methods: [
        "codex_app_server_thread_read",
        "codex_app_server_thread_resume",
      ],
      nowMs: GENERATED_AT_MS,
      provider: "codex",
      openMeldServiceRuntimeId: "runtime-1",
    });
    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "ready",
      facts: {
        providerConversation: {
          errorCode: "process.timeout",
          ready: false,
          reasonCodes: [
            "provider_conversation.proof_failed",
            "process.timeout",
          ],
          source: "runtime_reporting",
          status: "failed",
        },
      },
      primaryAction: "none",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
      "provider_conversation.proof_failed"
    );
  });

  it("surfaces historical duplicate controller conversations as Binding conflicts", async () => {
    mockReadyBindingAndRuntime(
      "agt_controller_conversation_conflict",
      "builtin:codex",
      "thread-ctx-1"
    );
    vi.mocked(
      readPrimaryAgentProfileBindingRecordByControllerConversation
    ).mockResolvedValueOnce({
      agentProfileId: "agt_conflicting_profile",
      bindingId: "binding-conflict",
      bindingState: "enabled_primary",
      agentControllerConversationId: "thread-ctx-1",
      agentControllerRef: "builtin:codex",
      createdAtMs: 1,
      createdByProfileId: null,
      configurationRevision: 1,
      disabledAtMs: null,
      owner: {
        id: "owner-1",
        kind: "owner_account",
      },
      reasonCode: null,
      openMeldServiceRuntimeId: "runtime-1",
      updatedAtMs: 1,
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_controller_conversation_conflict",
            profileName: "Controller Conversation Conflict Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_controller_conversation_conflict",
    });

    expect(
      readPrimaryAgentProfileBindingRecordByControllerConversation
    ).toHaveBeenCalledWith({
      agentControllerConversationId: "thread-ctx-1",
      agentControllerRef: "builtin:codex",
      db: expect.anything(),
      excludeAgentProfileId: "agt_controller_conversation_conflict",
      owner: {
        id: "owner-1",
        kind: "owner_account",
      },
    });
    expect(readiness.agentExecutionReadiness).toMatchObject({
      facts: {
        binding: {
          reasonCodes: [
            "agent_profile_binding.controller_conversation_conflict",
          ],
          routable: false,
          source: "unavailable",
        },
      },
      primaryAction: "check_status",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).toContain(
      "agent_profile_binding.controller_conversation_conflict"
    );
    expect(lookupRuntimeTransportRoute).not.toHaveBeenCalled();
  });

  it("ignores duplicate controller conversation rows for Agent Profiles that no longer exist", async () => {
    mockReadyBindingAndRuntime(
      "agt_controller_conversation_current",
      "builtin:codex",
      "thread-ctx-1"
    );
    mockOnlineRoute("device-1");
    vi.mocked(
      readPrimaryAgentProfileBindingRecordByControllerConversation
    ).mockResolvedValueOnce({
      agentProfileId: "agt_deleted_conflicting_profile",
      bindingId: "binding-conflict",
      bindingState: "enabled_primary",
      agentControllerConversationId: "thread-ctx-1",
      agentControllerRef: "builtin:codex",
      createdAtMs: 1,
      createdByProfileId: null,
      configurationRevision: 1,
      disabledAtMs: null,
      owner: {
        id: "owner-1",
        kind: "owner_account",
      },
      reasonCode: null,
      openMeldServiceRuntimeId: "runtime-1",
      updatedAtMs: 1,
    });
    const resolveProfileById = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        profile: createActiveAgentProfile({
          profileId: "agt_controller_conversation_current",
          profileName: "Current Agent",
        }),
      })
      .mockResolvedValueOnce({
        code: "profile.not_found",
        ok: false,
      });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById,
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_controller_conversation_current",
    });

    expect(resolveProfileById).toHaveBeenCalledWith({
      openMeldProfileId: "agt_deleted_conflicting_profile",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
      "agent_profile_binding.controller_conversation_conflict"
    );
    expect(readiness.agentExecutionReadiness.facts.binding).toMatchObject({
      routable: true,
      source: "binding_truth",
    });
  });

  it("does not upgrade unconnected legacy device display metadata into Agent readiness display truth", async () => {
    mockReadyBindingAndRuntime("agt_legacy_display");
    mockOnlineRoute("device-1");
    vi.mocked(resolveCurrentDeviceFromBindings).mockResolvedValueOnce({
      availability: "resolved",
      deviceId: "device-1",
      runtimeLane: "dev-local",
    });
    vi.mocked(listOwnedDeviceRegistryRecords).mockResolvedValueOnce([
      createOwnedDeviceRecord({
        connectedComputerId: null,
        deviceId: "device-1",
        observedDisplayName: "Felix's MacBook Pro",
      }),
    ]);
    vi.mocked(listOwnedDeviceExecutionTargetRecords).mockResolvedValueOnce([
      createExecutionTargetRecord({
        deviceId: "device-1",
        openMeldServiceRuntimeId: "runtime-1",
      }),
    ]);

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_legacy_display",
            profileName: "Legacy Display Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_legacy_display",
    });

    expect(readiness.runtimeDeviceDisplayName).toBeNull();
    expect(readiness.routeDeviceId).toBe("device-1");
  });

  it("keeps connected computer placeholder names out of Agent readiness display truth", async () => {
    mockReadyBindingAndRuntime("agt_placeholder_display");
    mockOnlineRoute("device-1");
    vi.mocked(resolveCurrentDeviceFromBindings).mockResolvedValueOnce({
      availability: "resolved",
      deviceId: "device-1",
      runtimeLane: "dev-local",
    });
    vi.mocked(listOwnedDeviceRegistryRecords).mockResolvedValueOnce([
      createOwnedDeviceRecord({
        connectedComputerId: "computer_without_name",
        deviceId: "device-1",
        observedDisplayName: null,
        userDisplayName: null,
      }),
    ]);
    vi.mocked(listOwnedDeviceExecutionTargetRecords).mockResolvedValueOnce([
      createExecutionTargetRecord({
        deviceId: "device-1",
        openMeldServiceRuntimeId: "runtime-1",
      }),
    ]);

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: createActiveAgentProfile({
            profileId: "agt_placeholder_display",
            profileName: "Placeholder Display Agent",
          }),
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_placeholder_display",
    });

    expect(readiness.runtimeDeviceDisplayName).toBeNull();
  });

  it("plans reconnect when the profile is still bound to a different runtime than the current computer", async () => {
    mockReadyBindingAndRuntime("agt_old_runtime");
    vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.profile.offline",
    });

    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createCoreEnv({
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: {
            ownerUserId: "owner-1",
            profileHandle: "agent",
            profileId: "agt_old_runtime",
            profileKind: "agent",
            profileName: "Old Runtime Agent",
            status: "active",
          },
        }),
      }),
      generatedAt: GENERATED_AT,
      profileId: "agt_old_runtime",
      targetRuntime: {
        deviceId: "device-2",
        lane: "dev-local",
        ownerUserId: "owner-1",
        openMeldServiceRuntimeId: "runtime-2",
        source: "current_local_runtime",
      },
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "not_ready",
      facts: {
        localService: {
          reachable: false,
          reasonCodes: ["local_service.identity_mismatch"],
          source: "runtime_transport",
        },
      },
      primaryAction: "reconnect_binding",
    });
    expect(readiness.agentExecutionReadiness.primaryAction).not.toBe(
      "run_prepare"
    );
    expect(lookupRuntimeTransportOwnerService).not.toHaveBeenCalled();
  });
});

function createCoreEnv(input: {
  resolveProfileById: NonNullable<
    NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]>["resolveProfileById"]
  >;
}): CoreBindings {
  return {
    OPENMELD_AUTH_WORKER: {
      resolveProfileById: input.resolveProfileById,
    },
    OPENMELD_POSTGRESQL: createAgentProfileOrganizationBinding(),
    OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
    OPENMELD_SPACES: {} as DurableObjectNamespace,
  } as unknown as CoreBindings;
}

function resolveCoreAgentExecutionReadinessForProfile(
  input: Parameters<
    typeof resolveCoreAgentExecutionReadinessForProfileWithoutOrganizationFixture
  >[0]
) {
  return resolveCoreAgentExecutionReadinessForProfileWithoutOrganizationFixture(
    {
      activeOrganizationId: TEST_ORGANIZATION_ID,
      ...input,
    }
  );
}

function createAgentProfileOrganizationBinding() {
  return createProjectionPostgresBinding(({ text, values }) => {
    if (!text.includes('FROM "openmeld"."openmeld_profiles"')) {
      throw new Error(`Unexpected readiness test query: ${text}`);
    }
    // The native batched SELECT returns the selected profile_id with each row.
    return (values?.[0] as string[]).map((profileId) => ({
      profile_id: profileId,
      managed_role: null,
      organization_id: TEST_ORGANIZATION_ID,
      owner_user_id: "owner-1",
      profile_kind: "agent",
      profile_name: "Readiness Test Agent",
    }));
  });
}

function mockReadyBindingAndRuntime(
  agentProfileId: string,
  agentControllerRef = "builtin:codex",
  agentControllerConversationId?: string,
  modelId?: string
): void {
  currentExpectedWorkingFolderProfileId = agentProfileId;
  vi.mocked(readPrimaryAgentProfileBindingRecord).mockResolvedValue({
    agentProfileId,
    bindingId: "binding-1",
    bindingState: "enabled_primary",
    ...(agentControllerConversationId ? { agentControllerConversationId } : {}),
    agentControllerRef,
    createdAtMs: 1,
    createdByProfileId: null,
    configurationRevision: 1,
    disabledAtMs: null,
    owner: {
      id: "owner-1",
      kind: "owner_account",
    },
    reasonCode: null,
    openMeldServiceRuntimeId: "runtime-1",
    ...(modelId ? { modelId } : {}),
    updatedAtMs: 1,
  });
  vi.mocked(readRuntimeRegistryRecordByRuntimeId).mockResolvedValue({
    record: {
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime-1",
      },
      runtimeLookupInput: {
        deviceId: "device-1",
        lane: "dev-local",
        owner: {
          id: "owner-1",
          kind: "owner_account",
        },
      },
    },
    status: "found",
  });
  vi.mocked(readRuntimeRegistryRecord).mockResolvedValue({
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority",
      value: "runtime-1",
    },
    status: "found",
  });
  vi.mocked(readCurrentRuntimeAgentControllerReports).mockResolvedValue([
    agentControllerRef === "builtin:codex" ||
    agentControllerRef === "builtin:grok-build"
      ? createRuntimeReportWithUsage(
          createUsageLimit({ status: "available", usedPercent: 42 }),
          agentControllerRef
        )
      : {
          agentControllerRef,
          expiresAtMs: GENERATED_AT_MS + 60_000,
          observedAtMs: GENERATED_AT_MS,
          reasonCodes: [],
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          status: "ready",
        },
  ]);
}

function mockOnlineRoute(deviceId: string) {
  const profileId = currentExpectedWorkingFolderProfileId;
  if (!profileId) {
    throw new Error("mockOnlineRoute requires a current profile Binding");
  }
  const route = {
    capabilities: {},
    connectionGeneration: 1,
    daemonSessionId: "daemon-session-1",
    deviceId,
    executionCompatibility: COMPATIBLE_SERVICE,
    lane: "dev-local",
    lastHeartbeatMs: GENERATED_AT_MS,
    leaseEpoch: 1,
    localWakeRouteReport: {
      daemonSessionId: "daemon-session-1",
      deviceId,
      expectedRoutesContractVersion: "v4",
      includedProfileIds: [profileId],
      lane: "dev-local",
      reportedAtMs: GENERATED_AT_MS,
      skippedProfiles: [],
      workingFolderObservations: [
        {
          bindingId: "binding-1",
          configurationRevision: 1,
          defaultProjectId: null,
          localProjectBindingGeneration: null,
          observedAtMs: GENERATED_AT_MS,
          profileId,
          reasonCode: null,
          source: "profile_workspace",
          status: "ready",
        },
      ],
    },
    online: true,
    serviceVersion: "999.0.0",
  } satisfies NonNullable<
    Awaited<ReturnType<typeof lookupRuntimeTransportRoute>>
  >;
  vi.mocked(lookupRuntimeTransportRoute).mockResolvedValueOnce(route);
  return route;
}

function createActiveAgentProfile(input: {
  profileId: string;
  profileName: string;
}) {
  return {
    defaultProjectId: null,
    ownerUserId: "owner-1",
    profileHandle: "agent",
    profileId: input.profileId,
    profileKind: "agent" as const,
    profileName: input.profileName,
    status: "active" as const,
  };
}

function createUsageLimit(input: {
  status: AgentControllerUsageLimit["status"];
  usedPercent: number | null;
}): AgentControllerUsageLimit {
  return {
    key: "five_hour",
    label: "5-hour Usage Limit",
    observedAt: GENERATED_AT,
    resetsAt:
      input.status === "unavailable" || input.status === "unsupported"
        ? null
        : "2026-05-13T01:00:00.000Z",
    status: input.status,
    usedPercent: input.usedPercent,
  };
}

function createRuntimeReportWithUsage(
  usageLimit: AgentControllerUsageLimit,
  agentControllerRef = "builtin:codex",
  usageAdmission?: AgentControllerInterfaceSnapshot["usageAdmission"]
) {
  const agentControllerInterface = {
    agentControllerRef,
    auth: { status: "authenticated" },
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: true,
    },
    checkedAt: GENERATED_AT,
    controllerId: agentControllerRef.split(":")[1] ?? "controller",
    displayName: "Local Agent",
    launch: {
      argsPrefix: [],
      commandPath: "/usr/local/bin/local-agent",
      installChoiceCount: 1,
      status: "ready",
    },
    message: null,
    models: [],
    nativeInterface:
      agentControllerRef === "builtin:codex" ? "codex-app-server" : "acp",
    schemaVersion: 1,
    skills: [],
    status: "ready",
    ...(usageAdmission ? { usageAdmission } : {}),
    usageLimits: [usageLimit],
    usageLimitsSupportMatrixVersion:
      AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
    version: "1.0.0",
  } satisfies AgentControllerInterfaceSnapshot;
  return {
    agentControllerInterface,
    agentControllerRef,
    expiresAtMs: GENERATED_AT_MS + 60_000,
    observedAtMs: GENERATED_AT_MS,
    reasonCodes: [],
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority" as const,
      value: "runtime-1",
    },
    status: "ready" as const,
  };
}

function createOwnedDeviceRecord(input: {
  connectedComputerId: string | null;
  deviceId: string;
  observedDisplayName?: string | null;
  userDisplayName?: string | null;
}) {
  return {
    connectedComputerId: input.connectedComputerId,
    deviceId: input.deviceId,
    deviceType: "laptop" as const,
    firstSeenAtMs: GENERATED_AT_MS - 1000,
    lastObservedAtMs: GENERATED_AT_MS,
    observedDisplayName: input.observedDisplayName ?? null,
    osVersion: "15.0",
    ownerUserId: "owner-1",
    platformFamily: "macOS" as const,
    updatedAtMs: GENERATED_AT_MS,
    userDisplayName: input.userDisplayName ?? null,
  };
}

function createExecutionTargetRecord(input: {
  deviceId: string;
  openMeldServiceRuntimeId: string;
}) {
  return {
    agentControllerRef: "builtin:codex",
    capabilityEnabled: true,
    capabilityReasonCodes: [],
    capabilityStatus: "ready" as const,
    deviceId: input.deviceId,
    lastObservedAtMs: GENERATED_AT_MS,
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    runtimeLane: "dev-local" as const,
  };
}
