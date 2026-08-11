import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createCliApiClientFoundationMock,
  createPrepareReadinessApiMock,
  getReadinessMock,
  readDaemonServiceContractMock,
  resolveAgentProfilePrimaryAgentControllerReportMock,
} = vi.hoisted(() => ({
  createCliApiClientFoundationMock: vi.fn(),
  createPrepareReadinessApiMock: vi.fn(),
  getReadinessMock: vi.fn(),
  readDaemonServiceContractMock: vi.fn(),
  resolveAgentProfilePrimaryAgentControllerReportMock: vi.fn(),
}));

vi.mock("@openmeld/api-client", () => ({
  createPrepareReadinessApi: createPrepareReadinessApiMock,
}));

vi.mock("../src/config/daemon-service-contract", () => ({
  readDaemonServiceContract: readDaemonServiceContractMock,
}));

vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: createCliApiClientFoundationMock,
}));

vi.mock("../src/system/agent-profile-primary-binding", () => ({
  resolveAgentProfilePrimaryAgentControllerReport:
    resolveAgentProfilePrimaryAgentControllerReportMock,
}));

const AGENT_PROFILE = {
  openMeldProfileId: "agt-codex",
  profileName: "Codex",
  profileHandle: "codex",
  profileKind: "agent",
  ownerUserId: "user-1",
  source: "cli_test",
  status: "active",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-04-17T00:00:00.000Z",
  updatedAt: "2026-04-17T00:00:00.000Z",
} as const;

describe("Prepare readiness API evidence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolveAgentProfilePrimaryAgentControllerReportMock.mockResolvedValue({
      bindingState: "enabled_primary",
      capabilityId: "codex",
      capabilityKind: "builtin",
      agentControllerRef: "builtin:codex",
      localAgentId: "codex",
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      routable: true,
    });
  });

  it("reads execution target readiness for the current service contract and profile capability", async () => {
    readDaemonServiceContractMock.mockResolvedValue({
      deviceId: "device-1",
      gatewayUrl: "https://gateway.openmeld.test",
      heartbeatMs: 30_000,
      lane: "dev-local",
    });
    createCliApiClientFoundationMock.mockReturnValue({ foundation: true });
    createPrepareReadinessApiMock.mockReturnValue({
      getReadiness: getReadinessMock,
    });
    getReadinessMock.mockResolvedValue({
      agentControllerReportsRead: true,
      nonRunnableCapabilities: [],
      projection: {
        projectionStatus: "ready",
        reasonCodes: [],
      },
      runnableCapabilities: [
        {
          agentControllerRef: "builtin:codex",
          expiresAtMs: 5000,
          observedAtMs: 1000,
          reasonCodes: ["runtime.agent_controller_report.ready"],
          status: "ready",
        },
      ],
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
      status: "ready",
      summary: {
        displayState: "ready",
        ready: true,
        reasonCodes: [],
      },
    });
    const { resolvePrepareReadinessApiEvidence } = await import(
      "../src/system/prepare-readiness-api-evidence"
    );

    const evidence = await resolvePrepareReadinessApiEvidence({
      profile: AGENT_PROFILE,
    });

    expect(createCliApiClientFoundationMock).toHaveBeenCalledWith(
      "https://gateway.openmeld.test"
    );
    expect(getReadinessMock).toHaveBeenCalledWith({
      agentControllerRefs: ["builtin:codex"],
      deviceId: "device-1",
      lane: "dev-local",
    });
    expect(evidence).toMatchObject({
      nonRunnableCapabilityCount: 0,
      runnableCapabilityCount: 1,
      openMeldServiceRuntimeId: "runtime_opaque_1",
      source: "prepare_readiness_api",
      status: "ready",
    });
  });

  it("keeps failed API reads explicit and never reports fallback ready", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Keep test output focused on the behavior assertion.
    });
    readDaemonServiceContractMock.mockResolvedValue({
      deviceId: "device-1",
      gatewayUrl: "https://gateway.openmeld.test",
      heartbeatMs: 30_000,
      lane: "dev-local",
    });
    createCliApiClientFoundationMock.mockReturnValue({ foundation: true });
    createPrepareReadinessApiMock.mockReturnValue({
      getReadiness: getReadinessMock,
    });
    getReadinessMock.mockRejectedValue(new Error("gateway unavailable"));
    const { resolvePrepareReadinessApiEvidence } = await import(
      "../src/system/prepare-readiness-api-evidence"
    );

    try {
      const evidence = await resolvePrepareReadinessApiEvidence({
        profile: AGENT_PROFILE,
      });

      expect(evidence).toMatchObject({
        reason: "read_failed",
        reasonCodes: ["prepare_readiness.read_failed"],
        source: "prepare_readiness_api",
        status: "unavailable",
      });
      expect(evidence.status).not.toBe("ready");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("keeps invalid controller refs explicit and does not read the API", async () => {
    resolveAgentProfilePrimaryAgentControllerReportMock.mockResolvedValueOnce(
      null
    );
    const { resolvePrepareReadinessApiEvidence } = await import(
      "../src/system/prepare-readiness-api-evidence"
    );

    const evidence = await resolvePrepareReadinessApiEvidence({
      profile: {
        ...AGENT_PROFILE,
      },
    });

    expect(evidence).toMatchObject({
      reason: "agent_controller_ref_unavailable",
      reasonCodes: ["prepare_readiness.agent_controller_ref_unavailable"],
      source: "prepare_readiness_api",
      status: "unavailable",
    });
    expect(evidence.status).not.toBe("ready");
    expect(createPrepareReadinessApiMock).not.toHaveBeenCalled();
    expect(getReadinessMock).not.toHaveBeenCalled();
  });

  it("does not read the API when the service contract heartbeat is invalid", async () => {
    readDaemonServiceContractMock.mockResolvedValue({
      deviceId: "device-1",
      gatewayUrl: "https://gateway.openmeld.test",
      heartbeatMs: Number.NaN,
      lane: "dev-local",
    });
    const { resolvePrepareReadinessApiEvidence } = await import(
      "../src/system/prepare-readiness-api-evidence"
    );

    const evidence = await resolvePrepareReadinessApiEvidence({
      profile: AGENT_PROFILE,
    });

    expect(evidence).toMatchObject({
      reason: "service_contract_unavailable",
      reasonCodes: ["prepare_readiness.service_contract_unavailable"],
      source: "prepare_readiness_api",
      status: "unavailable",
    });
    expect(createPrepareReadinessApiMock).not.toHaveBeenCalled();
    expect(getReadinessMock).not.toHaveBeenCalled();
  });
});
