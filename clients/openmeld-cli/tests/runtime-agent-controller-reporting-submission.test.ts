import { OpenMeldApiClientHttpError } from "@openmeld/api-client";
import { submitRuntimeProviderConversationProofsResponseSchema } from "@openmeld/schemas";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createCliApiClientFoundationMock,
  createRuntimeReportingApiMock,
  getAuthSessionStateMock,
  readDaemonServiceContractMock,
  resolveAgentProfilePrimaryAgentControllerReportMock,
  submitAgentControllerReportsMock,
  submitProviderConversationProofsMock,
  submitRegistrationMock,
} = vi.hoisted(() => ({
  createCliApiClientFoundationMock: vi.fn(),
  createRuntimeReportingApiMock: vi.fn(),
  getAuthSessionStateMock: vi.fn(),
  readDaemonServiceContractMock: vi.fn(),
  resolveAgentProfilePrimaryAgentControllerReportMock: vi.fn(),
  submitAgentControllerReportsMock: vi.fn(),
  submitProviderConversationProofsMock: vi.fn(),
  submitRegistrationMock: vi.fn(),
}));

vi.mock("@openmeld/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openmeld/api-client")>();
  return {
    ...actual,
    createRuntimeReportingApi: createRuntimeReportingApiMock,
  };
});

vi.mock("../src/config/daemon-service-contract", () => ({
  readDaemonServiceContract: readDaemonServiceContractMock,
}));

vi.mock("../src/config/auth-session", () => ({
  getAuthSessionState: getAuthSessionStateMock,
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

const PROVIDER_CONVERSATION_PROOF_ACCEPTED_RESPONSE =
  submitRuntimeProviderConversationProofsResponseSchema.parse({
    proofs: [
      {
        agentProfileId: "agt-codex",
        bindingId: "binding-codex",
        outcome: "created",
        status: "accepted",
      },
    ],
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority",
      value: "runtime_opaque_1",
    },
    status: "accepted",
  });

describe("Runtime Agent Controller reporting submission", () => {
  const CODEX_AGENT_CONTROLLER_INTERFACE = {
    agentControllerRef: "builtin:codex",
    auth: {
      email: "felix@example.com",
      label: "Felix's ChatGPT account",
      status: "authenticated",
      type: "chatgpt",
    },
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
      argsPrefix: ["app-server"],
      commandPath: "/usr/local/bin/codex",
      installChoiceCount: 1,
      status: "ready",
    },
    message: "Local probe diagnostic detail",
    models: [{ id: "gpt-5.5", displayName: "GPT-5.5" }],
    nativeInterface: "codex-app-server",
    schemaVersion: 1,
    skills: [
      {
        description: "Reads private local files",
        displayName: "Private local skill",
        id: "private-local-skill",
      },
    ],
    status: "ready",
    version: "0.1.0",
    versionAdvisory: {
      checkedAt: "2026-06-28T00:00:00.000Z",
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      message: "Update from a private local install path",
      status: "behind_latest",
      updateCommand: "npm install -g @openai/codex@latest",
    },
  } satisfies AgentControllerInterfaceSnapshot;
  const CODEX_AGENT_CONTROLLER_INTERFACE_CLOUD_PROJECTION = {
    auth: {
      email: "felix@example.com",
      label: "Felix's ChatGPT account",
      status: "authenticated",
    },
    agentControllerRef: "builtin:codex",
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
      commandPath: null,
      installChoiceCount: 1,
      status: "ready",
    },
    message: null,
    models: [],
    nativeInterface: "codex-app-server",
    schemaVersion: 1,
    skills: [],
    status: "ready",
    version: "0.1.0",
    versionAdvisory: {
      checkedAt: "2026-06-28T00:00:00.000Z",
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      message: null,
      status: "behind_latest",
      updateCommand: "npm install -g @openai/codex@latest",
    },
  } satisfies AgentControllerInterfaceSnapshot;

  beforeEach(() => {
    vi.resetAllMocks();
    readDaemonServiceContractMock.mockResolvedValue({
      deviceId: "device-1",
      gatewayUrl: "https://gateway.openmeld.test",
      heartbeatMs: 30_000,
      lane: "dev-local",
    });
    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: {
        v: 1,
        accessToken: "token-1",
        authBaseUrl: "https://auth.openmeld.test",
        clientId: "openmeld-cli-test",
        createdAt: "2026-04-17T00:00:00.000Z",
        tokenType: "Bearer",
      },
    });
    createCliApiClientFoundationMock.mockReturnValue({ foundation: true });
    resolveAgentProfilePrimaryAgentControllerReportMock.mockResolvedValue({
      bindingState: "enabled_primary",
      capabilityId: "codex",
      capabilityKind: "builtin",
      agentControllerRef: "builtin:codex",
      localAgentId: "codex",
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      routable: true,
    });
    createRuntimeReportingApiMock.mockReturnValue({
      submitAgentControllerReports: submitAgentControllerReportsMock,
      submitProviderConversationProofs: submitProviderConversationProofsMock,
      submitRegistration: submitRegistrationMock,
    });
    submitRegistrationMock.mockResolvedValue({
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
      status: "created",
    });
    submitAgentControllerReportsMock.mockResolvedValue({
      reports: [
        {
          agentControllerRef: "builtin:codex",
          outcome: "created",
          status: "accepted",
        },
      ],
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
      status: "accepted",
    });
    submitProviderConversationProofsMock.mockResolvedValue(
      PROVIDER_CONVERSATION_PROOF_ACCEPTED_RESPONSE
    );
  });

  it("registers the current Runtime and submits a ready Runtime Agent Controller Report", async () => {
    const { submitProfileRuntimeAgentControllerReport } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    const result = await submitProfileRuntimeAgentControllerReport({
      localParticipationState: "ready",
      profile: AGENT_PROFILE,
      reasonCodes: [],
    });

    expect(submitRegistrationMock).toHaveBeenCalledWith({
      deviceId: "device-1",
      lane: "dev-local",
    });
    expect(submitAgentControllerReportsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device-1",
        lane: "dev-local",
        reports: [
          expect.objectContaining({
            agentControllerRef: "builtin:codex",
            status: "ready",
          }),
        ],
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
      })
    );
    expect(result).toMatchObject({
      agentControllerRef: "builtin:codex",
      reasonCodes: [],
      deviceId: "device-1",
      lane: "dev-local",
      registrationStatus: "created",
      openMeldServiceRuntimeId: "runtime_opaque_1",
      source: "runtime_reporting_api",
      status: "submitted",
    });
  });

  it("submits a ready Runtime Agent Controller Report from a selected local capability without Agent Profile truth", async () => {
    const { submitRuntimeAgentControllerReport } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    const result = await submitRuntimeAgentControllerReport({
      agentControllerRef: "builtin:codex",
      agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
      localParticipationState: "ready",
      reasonCodes: [],
    });

    expect(submitRegistrationMock).toHaveBeenCalledWith({
      deviceId: "device-1",
      lane: "dev-local",
    });
    expect(submitAgentControllerReportsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device-1",
        lane: "dev-local",
        reports: [
          expect.objectContaining({
            agentControllerRef: "builtin:codex",
            agentControllerInterface:
              CODEX_AGENT_CONTROLLER_INTERFACE_CLOUD_PROJECTION,
            status: "ready",
          }),
        ],
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
      })
    );
    expect(result).toMatchObject({
      agentControllerRef: "builtin:codex",
      agentControllerReportStatus: "accepted",
      deviceId: "device-1",
      lane: "dev-local",
      openMeldServiceRuntimeId: "runtime_opaque_1",
      source: "runtime_reporting_api",
      status: "submitted",
    });
  });

  it("retries without Agent Controller Interface evidence when an older Core rejects the new optional field", async () => {
    submitAgentControllerReportsMock.mockRejectedValueOnce(
      Object.assign(new Error('Unrecognized key: "agentControllerInterface"'), {
        code: "invalid_payload",
        status: 400,
      })
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Keep test output focused on the behavior assertion.
    });
    const { submitRuntimeAgentControllerReport } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    try {
      const result = await submitRuntimeAgentControllerReport({
        agentControllerRef: "builtin:codex",
        agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
        localParticipationState: "ready",
        reasonCodes: [],
      });

      expect(submitAgentControllerReportsMock).toHaveBeenCalledTimes(2);
      expect(
        submitAgentControllerReportsMock.mock.calls[0]?.[0]?.reports?.[0]
      ).toMatchObject({
        agentControllerRef: "builtin:codex",
        agentControllerInterface:
          CODEX_AGENT_CONTROLLER_INTERFACE_CLOUD_PROJECTION,
      });
      expect(
        submitAgentControllerReportsMock.mock.calls[1]?.[0]?.reports?.[0]
      ).toMatchObject({
        agentControllerRef: "builtin:codex",
        status: "ready",
      });
      expect(
        submitAgentControllerReportsMock.mock.calls[1]?.[0]?.reports?.[0]
      ).not.toHaveProperty("agentControllerInterface");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[openmeld.runtime_reporting.agent_controller_interface_downgraded]"
        )
      );
      const downgradeLogLine = String(warnSpy.mock.calls[0]?.[0]);
      expect(downgradeLogLine).toContain(
        '"event":"cli.runtime_reporting.agent_controller_interface_downgraded"'
      );
      expect(downgradeLogLine).toContain('"reportCount":1');
      expect(result).toMatchObject({
        agentControllerRef: "builtin:codex",
        agentControllerReportStatus: "accepted",
        source: "runtime_reporting_api",
        status: "submitted",
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("retries without usage limits when an older Core rejects only the nested capacity field", async () => {
    submitAgentControllerReportsMock.mockRejectedValueOnce(
      Object.assign(new Error('Unrecognized key: "usageLimits"'), {
        code: "invalid_payload",
        status: 400,
      })
    );
    const { submitRuntimeAgentControllerReport } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    await submitRuntimeAgentControllerReport({
      agentControllerRef: "builtin:codex",
      agentControllerInterface: {
        ...CODEX_AGENT_CONTROLLER_INTERFACE,
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
      },
      localParticipationState: "ready",
      reasonCodes: [],
    });

    expect(submitAgentControllerReportsMock).toHaveBeenCalledTimes(2);
    expect(
      submitAgentControllerReportsMock.mock.calls[0]?.[0]?.reports?.[0]
        ?.agentControllerInterface?.usageLimits
    ).toHaveLength(1);
    expect(
      submitAgentControllerReportsMock.mock.calls[1]?.[0]?.reports?.[0]
        ?.agentControllerInterface
    ).toMatchObject({
      agentControllerRef: "builtin:codex",
      status: "ready",
    });
    expect(
      submitAgentControllerReportsMock.mock.calls[1]?.[0]?.reports?.[0]
        ?.agentControllerInterface
    ).not.toHaveProperty("usageLimits");
  });

  it("submits selected Runtime Agent Controller Reports in one write after one Runtime registration", async () => {
    submitAgentControllerReportsMock.mockResolvedValueOnce({
      reports: [
        {
          agentControllerRef: "builtin:claude",
          outcome: "created",
          status: "accepted",
        },
        {
          agentControllerRef: "builtin:codex",
          outcome: "created",
          status: "accepted",
        },
      ],
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
      status: "accepted",
    });
    const { submitRuntimeAgentControllerReports } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    const result = await submitRuntimeAgentControllerReports({
      reports: [
        {
          agentControllerRef: "builtin:claude",
          localParticipationState: "ready",
          reasonCodes: [],
        },
        {
          agentControllerRef: "builtin:codex",
          localParticipationState: "ready",
          reasonCodes: [],
        },
      ],
    });

    expect(submitRegistrationMock).toHaveBeenCalledTimes(1);
    expect(submitAgentControllerReportsMock).toHaveBeenCalledTimes(1);
    expect(submitAgentControllerReportsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reports: [
          expect.objectContaining({ agentControllerRef: "builtin:claude" }),
          expect.objectContaining({ agentControllerRef: "builtin:codex" }),
        ],
      })
    );
    expect(result).toEqual([
      expect.objectContaining({
        agentControllerRef: "builtin:claude",
        openMeldServiceRuntimeId: "runtime_opaque_1",
        status: "submitted",
      }),
      expect.objectContaining({
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
        status: "submitted",
      }),
    ]);
  });

  it("keeps selected Agent Controller reports fresh long enough for a human Web Start handoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T18:00:00.000Z"));
    const { submitRuntimeAgentControllerReport } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    try {
      await submitRuntimeAgentControllerReport({
        agentControllerRef: "builtin:codex",
        localParticipationState: "ready",
        reasonCodes: [],
      });

      const submittedReport =
        submitAgentControllerReportsMock.mock.calls[0]?.[0]?.reports?.[0];
      expect(submittedReport).toMatchObject({
        agentControllerRef: "builtin:codex",
        observedAtMs: Date.parse("2026-05-05T18:00:00.000Z"),
        status: "ready",
      });
      expect(
        Number(submittedReport?.expiresAtMs) -
          Number(submittedReport?.observedAtMs)
      ).toBeGreaterThanOrEqual(10 * 60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps Gateway failures explicit and never reports fallback ready", async () => {
    submitRegistrationMock.mockRejectedValue(new Error("gateway unavailable"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Keep test output focused on the behavior assertion.
    });
    const { submitProfileRuntimeAgentControllerReport } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    try {
      const result = await submitProfileRuntimeAgentControllerReport({
        localParticipationState: "ready",
        profile: AGENT_PROFILE,
        reasonCodes: [],
      });

      expect(result).toMatchObject({
        reason: "write_failed",
        reasonCodes: ["runtime.reporting.write_failed"],
        source: "runtime_reporting_api",
        status: "failed",
      });
      expect(result.status).not.toBe("submitted");
      expect(submitAgentControllerReportsMock).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("classifies a real API-client 401 and exposes one authentication recovery attempt", async () => {
    const authenticationError = new OpenMeldApiClientHttpError({
      code: "auth.unauthenticated",
      message: "authentication required",
      rawBody: JSON.stringify({
        error: {
          code: "auth.unauthenticated",
          message: "authentication required",
        },
      }),
      requestId: "req-reporting-auth-1",
      status: 401,
    });
    submitRegistrationMock.mockRejectedValue(authenticationError);
    const onAttempt = vi.fn(async () => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Keep test output focused on the behavior assertion.
    });
    const { submitRuntimeAgentControllerReports } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    try {
      const result = await submitRuntimeAgentControllerReports({
        onAttempt,
        reports: [
          {
            agentControllerRef: "builtin:codex",
            localParticipationState: "ready",
            reasonCodes: [],
          },
        ],
      });

      expect(result).toEqual([
        expect.objectContaining({
          reason: "write_failed",
          reasonCodes: ["runtime.reporting.authentication_required"],
          status: "failed",
        }),
      ]);
      expect(onAttempt).toHaveBeenCalledTimes(1);
      expect(onAttempt).toHaveBeenCalledWith({
        authenticationRejected: true,
        family: "runtime_agent_controller",
        message: "OpenMeld rejected the local authentication session.",
        reasonCode: "runtime.reporting.authentication_required",
        requiresCarrierHandshake: false,
        status: "failed",
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[openmeld.runtime_reporting.write_failed]")
      );
      const writeFailureLogLine = String(warnSpy.mock.calls[0]?.[0]);
      const timestamp = writeFailureLogLine.slice(
        0,
        writeFailureLogLine.indexOf(" ")
      );
      expect(Date.parse(timestamp)).not.toBeNaN();
      expect(writeFailureLogLine).toContain(
        '"error":"OpenMeld rejected the local authentication session."'
      );
      expect(writeFailureLogLine).toContain(
        '"event":"cli.runtime_reporting.write_failed"'
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("requests a carrier handshake when local authentication expires before reporting", async () => {
    getAuthSessionStateMock.mockResolvedValue({
      reasonCode: "session_expired",
      state: "expired",
      session: {
        v: 1,
        accessToken: "expired-token",
        authBaseUrl: "https://auth.openmeld.test",
        clientId: "openmeld-cli-test",
        createdAt: "2026-04-17T00:00:00.000Z",
        expiresAt: "2026-07-10T00:00:00.000Z",
        tokenType: "Bearer",
      },
    });
    const onAttempt = vi.fn(async () => undefined);
    const { submitRuntimeAgentControllerReports } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    await submitRuntimeAgentControllerReports({
      onAttempt,
      reports: [
        {
          agentControllerRef: "builtin:codex",
          localParticipationState: "ready",
          reasonCodes: [],
        },
      ],
    });

    expect(onAttempt).toHaveBeenCalledWith({
      authenticationRejected: false,
      family: "runtime_agent_controller",
      message: "Local authentication is expired.",
      reasonCode: "runtime.reporting.auth_expired",
      requiresCarrierHandshake: true,
      status: "failed",
    });
    expect(submitRegistrationMock).not.toHaveBeenCalled();
  });

  it("does not expose an arbitrary HTTP response body in reporting diagnostics", async () => {
    const responseSecret = "upstream-secret-that-must-not-be-persisted";
    submitRegistrationMock.mockRejectedValue(
      new OpenMeldApiClientHttpError({
        code: "gateway.invalid_response",
        message: `unexpected response: ${responseSecret}`,
        rawBody: JSON.stringify({ secret: responseSecret }),
        requestId: "req-reporting-upstream-1",
        status: 502,
      })
    );
    const onAttempt = vi.fn(async () => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Keep test output focused on the redaction assertion.
    });
    const { submitRuntimeAgentControllerReports } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    try {
      await submitRuntimeAgentControllerReports({
        onAttempt,
        reports: [
          {
            agentControllerRef: "builtin:codex",
            localParticipationState: "ready",
            reasonCodes: [],
          },
        ],
      });

      expect(onAttempt).toHaveBeenCalledWith({
        authenticationRejected: false,
        family: "runtime_agent_controller",
        message: "OpenMeld reporting request failed with HTTP 502.",
        reasonCode: "runtime.reporting.write_failed",
        requiresCarrierHandshake: false,
        status: "failed",
      });
      const logLine = String(warnSpy.mock.calls[0]?.[0]);
      expect(logLine).toContain(
        '"error":"OpenMeld reporting request failed with HTTP 502."'
      );
      expect(logLine).not.toContain(responseSecret);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("exposes a successful Provider Conversation Proof reporting attempt", async () => {
    const onAttempt = vi.fn(async () => undefined);
    const { submitRuntimeProviderConversationProofs } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    const result = await submitRuntimeProviderConversationProofs({
      onAttempt,
      proofs: [
        {
          agentControllerConversationId: "thread-codex",
          agentControllerRef: "builtin:codex",
          agentProfileId: "agt-codex",
          bindingId: "binding-codex",
          expiresAtMs: Date.parse("2026-07-10T09:10:00.000Z"),
          intrusive: false,
          method: "codex_app_server_thread_resume",
          observedAtMs: Date.parse("2026-07-10T09:00:00.000Z"),
          provider: "codex",
          status: "passed",
          transportMode: "codex-app-server",
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        agentProfileId: "agt-codex",
        bindingId: "binding-codex",
        providerConversationProofStatus: "accepted",
        status: "submitted",
      }),
    ]);
    expect(onAttempt).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledWith({
      authenticationRejected: false,
      family: "provider_conversation_proof",
      message: null,
      reasonCode: null,
      requiresCarrierHandshake: false,
      status: "succeeded",
    });
  });

  it("fails fast when local auth cannot be used for the service contract gateway", async () => {
    readDaemonServiceContractMock.mockResolvedValue({
      deviceId: "device-1",
      gatewayUrl: "https://gateway.openmeld.invalid",
      heartbeatMs: 30_000,
      lane: "canary",
    });
    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: {
        v: 1,
        accessToken: "local-token",
        authBaseUrl: "http://localhost:8788",
        clientId: "openmeld-cli-dev",
        createdAt: "2026-05-06T00:00:00.000Z",
        tokenType: "Bearer",
      },
    });
    const { submitProfileRuntimeAgentControllerReport } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    const result = await submitProfileRuntimeAgentControllerReport({
      localParticipationState: "ready",
      profile: AGENT_PROFILE,
      reasonCodes: [],
    });

    expect(result).toMatchObject({
      authBaseUrl: "http://localhost:8788",
      agentControllerRef: "builtin:codex",
      gatewayUrl: "https://gateway.openmeld.invalid",
      guidanceReason: "mismatch",
      reason: "auth_gateway_mismatch",
      reasonCodes: ["runtime.reporting.auth_gateway_mismatch"],
      source: "runtime_reporting_api",
      status: "failed",
    });
    expect(createRuntimeReportingApiMock).not.toHaveBeenCalled();
    expect(submitRegistrationMock).not.toHaveBeenCalled();
    expect(submitAgentControllerReportsMock).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("openMeldServiceRuntimeId");
  });

  it("does not submit when the service contract is missing", async () => {
    readDaemonServiceContractMock.mockResolvedValue(null);
    const { submitProfileRuntimeAgentControllerReport } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    const result = await submitProfileRuntimeAgentControllerReport({
      localParticipationState: "ready",
      profile: AGENT_PROFILE,
      reasonCodes: [],
    });

    expect(result).toMatchObject({
      reason: "service_contract_unavailable",
      reasonCodes: ["runtime.reporting.service_contract_unavailable"],
      source: "runtime_reporting_api",
      status: "unavailable",
    });
    expect(createRuntimeReportingApiMock).not.toHaveBeenCalled();
    expect(submitRegistrationMock).not.toHaveBeenCalled();
    expect(submitAgentControllerReportsMock).not.toHaveBeenCalled();
  });

  it("does not submit when the service contract heartbeat is invalid", async () => {
    readDaemonServiceContractMock.mockResolvedValue({
      deviceId: "device-1",
      gatewayUrl: "https://gateway.openmeld.test",
      heartbeatMs: Number.NaN,
      lane: "dev-local",
    });
    const { submitProfileRuntimeAgentControllerReport } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    const result = await submitProfileRuntimeAgentControllerReport({
      localParticipationState: "ready",
      profile: AGENT_PROFILE,
      reasonCodes: [],
    });

    expect(result).toMatchObject({
      reason: "service_contract_unavailable",
      reasonCodes: ["runtime.reporting.service_contract_unavailable"],
      source: "runtime_reporting_api",
      status: "unavailable",
    });
    expect(createRuntimeReportingApiMock).not.toHaveBeenCalled();
    expect(submitRegistrationMock).not.toHaveBeenCalled();
    expect(submitAgentControllerReportsMock).not.toHaveBeenCalled();
  });

  it("does not submit when the profile Agent Controller ref is invalid", async () => {
    resolveAgentProfilePrimaryAgentControllerReportMock.mockResolvedValueOnce(
      null
    );
    const { submitProfileRuntimeAgentControllerReport } = await import(
      "../src/local-service/reporting/runtime-agent-controller-reporting-submission"
    );

    const result = await submitProfileRuntimeAgentControllerReport({
      localParticipationState: "ready",
      profile: {
        ...AGENT_PROFILE,
      },
      reasonCodes: [],
    });

    expect(result).toMatchObject({
      reason: "agent_controller_ref_unavailable",
      reasonCodes: ["runtime.reporting.agent_controller_ref_unavailable"],
      source: "runtime_reporting_api",
      status: "unavailable",
    });
    expect(readDaemonServiceContractMock).not.toHaveBeenCalled();
    expect(createRuntimeReportingApiMock).not.toHaveBeenCalled();
    expect(submitRegistrationMock).not.toHaveBeenCalled();
    expect(submitAgentControllerReportsMock).not.toHaveBeenCalled();
  });
});
