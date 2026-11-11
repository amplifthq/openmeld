import {
  createRuntimeReportingApi,
  type SubmitRuntimeAgentControllerReportsInput,
  toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
  AgentControllerInterfaceSnapshot,
  RuntimeProviderConversationProofMethod,
} from "@openmeld/schemas/types";
import { getAuthSessionState } from "../../config/auth-session";
import { readDaemonServiceContract } from "../../config/daemon-service-contract";
import type { OpenMeldProfile } from "../../config/openmeld-profiles-api";
import {
  canAttachAuthTokenToRequest,
  fingerprintRequestAuthorization,
} from "../../config/request-headers";
import { createCliApiClientFoundation } from "../../space/api-client-foundation";
import type { LocalParticipationState } from "../../system/action-participation-planner";
import { resolveAgentProfilePrimaryAgentControllerReport } from "../../system/agent-profile-primary-binding";
import { warnDaemonEvent } from "../core/logger";
import { projectAgentControllerInterfaceForCloud } from "./agent-controller-interface-cloud-projection";

export type RuntimeReportingAttempt = {
  credentialFingerprint?: string;
  authenticationRejected: boolean;
  family: "provider_conversation_proof" | "runtime_agent_controller";
  message: string | null;
  reasonCode: string | null;
  status: "failed" | "not_applicable" | "succeeded";
};

export type RuntimeReportingAttemptObserver = (
  attempt: RuntimeReportingAttempt
) => Promise<void> | void;

export type RuntimeAgentControllerReportSubmission = {
  source: "runtime_reporting_api";
  status: "failed" | "submitted" | "unavailable";
  agentControllerRef?: string;
  agentControllerReportStatus?: "accepted" | "partial" | "rejected";
  deviceId?: string;
  lane?: string;
  reason?:
    | "auth_gateway_mismatch"
    | "auth_unavailable"
    | "agent_controller_ref_unavailable"
    | "registration_rejected"
    | "report_rejected"
    | "service_contract_unavailable"
    | "write_failed";
  reasonCodes: string[];
  authBaseUrl?: string;
  registrationStatus?: "created" | "reused";
  gatewayUrl?: string;
  guidanceReason?: "mismatch";
  openMeldServiceRuntimeId?: string;
};

export type RuntimeProviderConversationProofSubmission = {
  source: "runtime_reporting_api";
  status: "failed" | "submitted" | "unavailable";
  agentProfileId?: string;
  bindingId?: string;
  providerConversationProofStatus?: "accepted" | "partial" | "rejected";
  deviceId?: string;
  lane?: string;
  reason?:
    | "auth_gateway_mismatch"
    | "auth_unavailable"
    | "proof_rejected"
    | "registration_rejected"
    | "service_contract_unavailable"
    | "write_failed";
  reasonCodes: string[];
  authBaseUrl?: string;
  registrationStatus?: "created" | "reused";
  gatewayUrl?: string;
  guidanceReason?: "mismatch";
  openMeldServiceRuntimeId?: string;
};

export type RuntimeAgentControllerReportInput = {
  agentControllerRef: string;
  agentControllerInterface?: AgentControllerInterfaceSnapshot;
  diagnosticProfileId?: string;
  enabled?: boolean;
  localParticipationState: LocalParticipationState;
  reasonCodes: readonly string[];
};

export type RuntimeProviderConversationProofInput = {
  agentProfileId: string;
  bindingId: string;
  agentControllerRef: string;
  agentControllerConversationId: string;
  transportMode: "codex-app-server";
  provider: "codex";
  method: RuntimeProviderConversationProofMethod;
  intrusive: false;
  observedAtMs: number;
  expiresAtMs: number;
  status: "failed" | "passed";
  errorCode?: string;
  errorMessage?: string;
  errorType?: string;
};

const MIN_REPORT_TTL_MS = 10 * 60_000;

export async function submitProfileRuntimeAgentControllerReport(input: {
  localParticipationState: LocalParticipationState;
  profile: OpenMeldProfile;
  reasonCodes: readonly string[];
}): Promise<RuntimeAgentControllerReportSubmission> {
  const agentControllerRef = await resolveProfileAgentControllerRef(
    input.profile
  );
  if (!agentControllerRef) {
    return unavailableSubmission({
      reason: "agent_controller_ref_unavailable",
      reasonCode: "runtime.reporting.agent_controller_ref_unavailable",
    });
  }

  return await submitRuntimeAgentControllerReport({
    agentControllerRef,
    diagnosticProfileId: input.profile.openMeldProfileId,
    localParticipationState: input.localParticipationState,
    reasonCodes: input.reasonCodes,
  });
}

export async function submitRuntimeAgentControllerReport(input: {
  agentControllerRef: string;
  agentControllerInterface?: AgentControllerInterfaceSnapshot;
  diagnosticProfileId?: string;
  localParticipationState: LocalParticipationState;
  reasonCodes: readonly string[];
}): Promise<RuntimeAgentControllerReportSubmission> {
  const [result] = await submitRuntimeAgentControllerReports({
    reports: [input],
  });
  if (!result) {
    throw new Error(
      "OpenMeld runtime reporting did not return a submission result."
    );
  }
  return result;
}

export async function submitRuntimeAgentControllerReports(input: {
  onAttempt?: RuntimeReportingAttemptObserver;
  reports: readonly RuntimeAgentControllerReportInput[];
}): Promise<RuntimeAgentControllerReportSubmission[]> {
  // OPENMELD_SERVICE_THIN_CORE: Runtime Agent Controller reporting evidence.
  // This reports local controller availability for the current local service
  // identity; it does not own Profile, Binding, Space, Wake, or final outcome
  // truth.
  if (input.reports.length === 0) {
    return [];
  }

  const serviceContract = await readDaemonServiceContract().catch(() => null);
  if (
    !(
      serviceContract?.deviceId &&
      serviceContract.gatewayUrl &&
      serviceContract.lane &&
      isFinitePositiveNumber(serviceContract.heartbeatMs)
    )
  ) {
    return await finishRuntimeAgentControllerReportingAttempt({
      failure: {
        authenticationRejected: false,
        message: "OpenMeld Service contract is unavailable.",
        reasonCode: "runtime.reporting.service_contract_unavailable",
      },
      onAttempt: input.onAttempt,
      submissions: unavailableSubmissions({
        reports: input.reports,
        reason: "service_contract_unavailable",
        reasonCode: "runtime.reporting.service_contract_unavailable",
      }),
    });
  }

  const authCompatibility = await resolveRuntimeReportingAuthCompatibility(
    serviceContract.gatewayUrl
  );
  if (authCompatibility.status === "unavailable") {
    const reasonCode = `runtime.reporting.${authCompatibility.reasonCode ?? `auth_${authCompatibility.authState}`}`;
    return await finishRuntimeAgentControllerReportingAttempt({
      failure: {
        authenticationRejected: false,
        message: `Local authentication is ${authCompatibility.authState}.`,
        reasonCode,
      },
      onAttempt: input.onAttempt,
      submissions: failedSubmissions({
        gatewayUrl: serviceContract.gatewayUrl,
        reports: input.reports,
        reason: "auth_unavailable",
        reasonCode,
      }),
    });
  }
  if (authCompatibility.status === "mismatch") {
    return await finishRuntimeAgentControllerReportingAttempt({
      failure: {
        authenticationRejected: false,
        message:
          "The local authentication session does not match the reporting Gateway.",
        reasonCode: "runtime.reporting.auth_gateway_mismatch",
      },
      onAttempt: input.onAttempt,
      submissions: failedSubmissions({
        authBaseUrl: authCompatibility.authBaseUrl,
        gatewayUrl: serviceContract.gatewayUrl,
        guidanceReason: "mismatch",
        reports: input.reports,
        reason: "auth_gateway_mismatch",
        reasonCode: "runtime.reporting.auth_gateway_mismatch",
      }),
    });
  }

  let credentialFingerprint: string | undefined;
  try {
    const api = createRuntimeReportingApi(
      createCliApiClientFoundation(serviceContract.gatewayUrl, {
        onAuthHeadersResolved: (headers) => {
          credentialFingerprint = headers.Authorization
            ? fingerprintRequestAuthorization(headers.Authorization)
            : undefined;
        },
      })
    );
    const registration = await api.submitRegistration({
      deviceId: serviceContract.deviceId,
      lane: serviceContract.lane,
    });
    if (
      !(
        registration.status !== "rejected" &&
        registration.openMeldServiceRuntimeId
      )
    ) {
      const reasonCode = `runtime.registration.${registration.reason ?? "rejected"}`;
      return await finishRuntimeAgentControllerReportingAttempt({
        failure: {
          authenticationRejected: false,
          message: `Runtime registration was rejected: ${registration.reason ?? "rejected"}.`,
          reasonCode,
        },
        onAttempt: input.onAttempt,
        submissions: failedSubmissions({
          reports: input.reports,
          reason: "registration_rejected",
          reasonCode,
        }),
      });
    }

    const observedAtMs = Date.now();
    const reportInput = buildRuntimeAgentControllerReportsInput({
      openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      deviceId: serviceContract.deviceId,
      heartbeatMs: serviceContract.heartbeatMs,
      includeAgentControllerInterface: true,
      lane: serviceContract.lane,
      observedAtMs,
      reports: input.reports,
    });
    const report = await submitAgentControllerReportsWithCompatibilityRetry({
      api,
      initialInput: reportInput,
      requestedReports: input.reports,
    });

    return await finishRuntimeAgentControllerReportingAttempt({
      onAttempt: input.onAttempt,
      submissions: resolveAgentControllerReportSubmissionResults({
        deviceId: serviceContract.deviceId,
        lane: serviceContract.lane,
        registrationStatus: registration.status,
        reports: input.reports,
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId.value,
        submission: report,
      }),
    });
  } catch (error) {
    const failure = resolveRuntimeReportingWriteFailure({
      credentialFingerprint,
      error,
      reasonCodePrefix: "runtime.reporting",
    });
    warnDaemonEvent("[openmeld.runtime_reporting.write_failed]", {
      error: failure.message,
      event: "cli.runtime_reporting.write_failed",
      profileIds: input.reports
        .map((report) => report.diagnosticProfileId)
        .filter((profileId): profileId is string => Boolean(profileId)),
      reportCount: input.reports.length,
    });
    return await finishRuntimeAgentControllerReportingAttempt({
      failure,
      onAttempt: input.onAttempt,
      submissions: failedSubmissions({
        reports: input.reports,
        reason: "write_failed",
        reasonCode: failure.reasonCode,
      }),
    });
  }
}

export async function submitRuntimeProviderConversationProofs(input: {
  onAttempt?: RuntimeReportingAttemptObserver;
  proofs: readonly RuntimeProviderConversationProofInput[];
}): Promise<RuntimeProviderConversationProofSubmission[]> {
  if (input.proofs.length === 0) {
    return [];
  }

  const serviceContract = await readDaemonServiceContract().catch(() => null);
  if (
    !(
      serviceContract?.deviceId &&
      serviceContract.gatewayUrl &&
      serviceContract.lane &&
      isFinitePositiveNumber(serviceContract.heartbeatMs)
    )
  ) {
    const reasonCode =
      "provider_conversation.runtime_reporting.service_contract_unavailable";
    return await finishProviderConversationProofReportingAttempt({
      failure: {
        authenticationRejected: false,
        message: "OpenMeld Service contract is unavailable.",
        reasonCode,
      },
      onAttempt: input.onAttempt,
      submissions: unavailableProviderConversationProofSubmissions({
        proofs: input.proofs,
        reason: "service_contract_unavailable",
        reasonCode,
      }),
    });
  }

  const authCompatibility = await resolveRuntimeReportingAuthCompatibility(
    serviceContract.gatewayUrl
  );
  if (authCompatibility.status === "unavailable") {
    const reasonCode = `provider_conversation.runtime_reporting.${authCompatibility.reasonCode ?? `auth_${authCompatibility.authState}`}`;
    return await finishProviderConversationProofReportingAttempt({
      failure: {
        authenticationRejected: false,
        message: `Local authentication is ${authCompatibility.authState}.`,
        reasonCode,
      },
      onAttempt: input.onAttempt,
      submissions: failedProviderConversationProofSubmissions({
        gatewayUrl: serviceContract.gatewayUrl,
        proofs: input.proofs,
        reason: "auth_unavailable",
        reasonCode,
      }),
    });
  }
  if (authCompatibility.status === "mismatch") {
    const reasonCode =
      "provider_conversation.runtime_reporting.auth_gateway_mismatch";
    return await finishProviderConversationProofReportingAttempt({
      failure: {
        authenticationRejected: false,
        message:
          "The local authentication session does not match the reporting Gateway.",
        reasonCode,
      },
      onAttempt: input.onAttempt,
      submissions: failedProviderConversationProofSubmissions({
        authBaseUrl: authCompatibility.authBaseUrl,
        gatewayUrl: serviceContract.gatewayUrl,
        guidanceReason: "mismatch",
        proofs: input.proofs,
        reason: "auth_gateway_mismatch",
        reasonCode,
      }),
    });
  }

  let credentialFingerprint: string | undefined;
  try {
    const api = createRuntimeReportingApi(
      createCliApiClientFoundation(serviceContract.gatewayUrl, {
        onAuthHeadersResolved: (headers) => {
          credentialFingerprint = headers.Authorization
            ? fingerprintRequestAuthorization(headers.Authorization)
            : undefined;
        },
      })
    );
    const registration = await api.submitRegistration({
      deviceId: serviceContract.deviceId,
      lane: serviceContract.lane,
    });
    if (
      !(
        registration.status !== "rejected" &&
        registration.openMeldServiceRuntimeId
      )
    ) {
      const reasonCode = `provider_conversation.runtime_registration.${
        registration.reason ?? "rejected"
      }`;
      return await finishProviderConversationProofReportingAttempt({
        failure: {
          authenticationRejected: false,
          message: `Runtime registration was rejected: ${registration.reason ?? "rejected"}.`,
          reasonCode,
        },
        onAttempt: input.onAttempt,
        submissions: failedProviderConversationProofSubmissions({
          proofs: input.proofs,
          reason: "registration_rejected",
          reasonCode,
        }),
      });
    }

    const submission = await api.submitProviderConversationProofs({
      deviceId: serviceContract.deviceId,
      lane: serviceContract.lane,
      proofs: input.proofs.map((proof) => ({
        ...proof,
      })),
      openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
    });

    return await finishProviderConversationProofReportingAttempt({
      onAttempt: input.onAttempt,
      submissions: resolveProviderConversationProofSubmissionResults({
        deviceId: serviceContract.deviceId,
        lane: serviceContract.lane,
        registrationStatus: registration.status,
        proofs: input.proofs,
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId.value,
        submission,
      }),
    });
  } catch (error) {
    const failure = resolveRuntimeReportingWriteFailure({
      credentialFingerprint,
      error,
      reasonCodePrefix: "provider_conversation.runtime_reporting",
    });
    warnDaemonEvent("[openmeld.provider_conversation_proof.write_failed]", {
      error: failure.message,
      event: "cli.provider_conversation_proof.write_failed",
      profileIds: input.proofs.map((proof) => proof.agentProfileId),
      proofCount: input.proofs.length,
    });
    return await finishProviderConversationProofReportingAttempt({
      failure,
      onAttempt: input.onAttempt,
      submissions: failedProviderConversationProofSubmissions({
        proofs: input.proofs,
        reason: "write_failed",
        reasonCode: failure.reasonCode,
      }),
    });
  }
}

type RuntimeReportingFailure = {
  credentialFingerprint?: string;
  authenticationRejected: boolean;
  message: string;
  reasonCode: string;
};

async function finishRuntimeAgentControllerReportingAttempt(input: {
  failure?: RuntimeReportingFailure;
  onAttempt?: RuntimeReportingAttemptObserver;
  submissions: RuntimeAgentControllerReportSubmission[];
}): Promise<RuntimeAgentControllerReportSubmission[]> {
  const failedSubmission = input.submissions.find(
    (submission) =>
      submission.status !== "submitted" ||
      submission.agentControllerReportStatus !== "accepted"
  );
  const failure =
    input.failure ??
    (failedSubmission
      ? buildSubmissionFailure({
          fallbackReasonCode: "runtime.reporting.failed",
          reasonCodes: failedSubmission.reasonCodes,
        })
      : null);
  await notifyRuntimeReportingAttemptObserver(input.onAttempt, {
    ...(failure?.credentialFingerprint
      ? { credentialFingerprint: failure.credentialFingerprint }
      : {}),
    authenticationRejected: failure?.authenticationRejected ?? false,
    family: "runtime_agent_controller",
    message: failure?.message ?? null,
    reasonCode: failure?.reasonCode ?? null,
    status: failure ? "failed" : "succeeded",
  });
  return input.submissions;
}

async function finishProviderConversationProofReportingAttempt(input: {
  failure?: RuntimeReportingFailure;
  onAttempt?: RuntimeReportingAttemptObserver;
  submissions: RuntimeProviderConversationProofSubmission[];
}): Promise<RuntimeProviderConversationProofSubmission[]> {
  const failedSubmission = input.submissions.find(
    (submission) =>
      submission.status !== "submitted" ||
      submission.providerConversationProofStatus !== "accepted"
  );
  const failure =
    input.failure ??
    (failedSubmission
      ? buildSubmissionFailure({
          fallbackReasonCode: "provider_conversation.runtime_reporting.failed",
          reasonCodes: failedSubmission.reasonCodes,
        })
      : null);
  await notifyRuntimeReportingAttemptObserver(input.onAttempt, {
    ...(failure?.credentialFingerprint
      ? { credentialFingerprint: failure.credentialFingerprint }
      : {}),
    authenticationRejected: failure?.authenticationRejected ?? false,
    family: "provider_conversation_proof",
    message: failure?.message ?? null,
    reasonCode: failure?.reasonCode ?? null,
    status: failure ? "failed" : "succeeded",
  });
  return input.submissions;
}

function buildSubmissionFailure(input: {
  fallbackReasonCode: string;
  reasonCodes: readonly string[];
}): RuntimeReportingFailure {
  const reasonCode = input.reasonCodes[0] ?? input.fallbackReasonCode;
  return {
    authenticationRejected: false,
    message: `Runtime reporting failed: ${reasonCode}.`,
    reasonCode,
  };
}

function resolveRuntimeReportingWriteFailure(input: {
  credentialFingerprint?: string;
  error: unknown;
  reasonCodePrefix: string;
}): RuntimeReportingFailure {
  const failure = toStructuredApiClientFailure(input.error);
  const authenticationRejected =
    failure.status === 401 ||
    (failure.status === null && failure.code === "auth.unauthenticated");
  return {
    ...(authenticationRejected && input.credentialFingerprint
      ? { credentialFingerprint: input.credentialFingerprint }
      : {}),
    authenticationRejected,
    message: resolveSafeRuntimeReportingFailureMessage({
      authenticationRejected,
      message: failure.message,
      status: failure.status,
    }),
    reasonCode: `${input.reasonCodePrefix}.${
      authenticationRejected ? "authentication_required" : "write_failed"
    }`,
  };
}

function resolveSafeRuntimeReportingFailureMessage(input: {
  authenticationRejected: boolean;
  message: string;
  status: number | null;
}): string {
  if (input.authenticationRejected) {
    return "OpenMeld rejected the local authentication session.";
  }
  if (input.status !== null) {
    return `OpenMeld reporting request failed with HTTP ${String(input.status)}.`;
  }
  const normalizedMessage = input.message.toLowerCase();
  if (
    normalizedMessage.includes("timed out") ||
    normalizedMessage.includes("timeout")
  ) {
    return "OpenMeld reporting request timed out.";
  }
  if (
    normalizedMessage.includes("certificate") ||
    normalizedMessage.includes("tls")
  ) {
    return "OpenMeld reporting request failed TLS verification.";
  }
  return "OpenMeld reporting request failed.";
}

export async function notifyRuntimeReportingAttemptObserver(
  observer: RuntimeReportingAttemptObserver | undefined,
  attempt: RuntimeReportingAttempt
): Promise<void> {
  if (!observer) {
    return;
  }
  try {
    await observer(attempt);
  } catch (error) {
    warnDaemonEvent("[openmeld.runtime_reporting.attempt_observer_failed]", {
      authenticationRejected: attempt.authenticationRejected,
      error: toErrorMessage(error),
      event: "cli.runtime_reporting.attempt_observer_failed",
      family: attempt.family,
      reasonCode: attempt.reasonCode,
      status: attempt.status,
    });
  }
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function resolveProfileAgentControllerRef(
  profile: OpenMeldProfile
): Promise<string | null> {
  const capability = await resolveAgentProfilePrimaryAgentControllerReport({
    profile,
  }).catch(() => null);
  return capability?.agentControllerRef ?? null;
}

function resolveReportStatus(input: {
  enabled?: boolean;
  localParticipationState: LocalParticipationState;
}): "disabled" | "ready" | "unavailable" | "unknown" {
  if (input.enabled === false) {
    return "disabled";
  }
  if (input.localParticipationState === "ready") {
    return "ready";
  }
  if (input.localParticipationState === "membership_only") {
    return "unknown";
  }
  return "unavailable";
}

function resolveReportReasonCodes(input: {
  enabled?: boolean;
  localParticipationState: LocalParticipationState;
  reasonCodes: readonly string[];
}): string[] {
  if (input.reasonCodes.length > 0) {
    return Array.from(new Set(input.reasonCodes));
  }
  return [
    `runtime.agent_controller_report.${resolveReportStatus({
      enabled: input.enabled,
      localParticipationState: input.localParticipationState,
    })}`,
  ];
}

function buildRuntimeAgentControllerReportsInput(input: {
  openMeldServiceRuntimeId: SubmitRuntimeAgentControllerReportsInput["openMeldServiceRuntimeId"];
  deviceId: string;
  heartbeatMs: number;
  includeAgentControllerInterface: boolean;
  lane: string;
  observedAtMs: number;
  reports: readonly RuntimeAgentControllerReportInput[];
}): SubmitRuntimeAgentControllerReportsInput {
  return {
    deviceId: input.deviceId,
    lane: input.lane,
    reports: input.reports.map((runtimeReport) => ({
      agentControllerRef: runtimeReport.agentControllerRef,
      ...(input.includeAgentControllerInterface &&
      runtimeReport.agentControllerInterface
        ? {
            agentControllerInterface: projectAgentControllerInterfaceForCloud(
              runtimeReport.agentControllerInterface
            ),
          }
        : {}),
      expiresAtMs:
        input.observedAtMs + Math.max(input.heartbeatMs * 3, MIN_REPORT_TTL_MS),
      observedAtMs: input.observedAtMs,
      reasonCodes: resolveReportReasonCodes({
        enabled: runtimeReport.enabled,
        localParticipationState: runtimeReport.localParticipationState,
        reasonCodes: runtimeReport.reasonCodes,
      }),
      status: resolveReportStatus({
        enabled: runtimeReport.enabled,
        localParticipationState: runtimeReport.localParticipationState,
      }),
    })),
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
  };
}

async function submitAgentControllerReportsWithCompatibilityRetry(input: {
  api: ReturnType<typeof createRuntimeReportingApi>;
  initialInput: SubmitRuntimeAgentControllerReportsInput;
  requestedReports: readonly RuntimeAgentControllerReportInput[];
}): Promise<RuntimeAgentControllerReportsSubmission> {
  try {
    return await input.api.submitAgentControllerReports(input.initialInput);
  } catch (error) {
    let retryInput = input.initialInput;
    let compatibilityError = error;
    if (
      shouldRetryWithoutUsageLimits({
        error,
        submittedReports: input.initialInput.reports,
      })
    ) {
      warnDaemonEvent("[openmeld.runtime_reporting.usage_limits_downgraded]", {
        error: toErrorMessage(error),
        event: "cli.runtime_reporting.usage_limits_downgraded",
        reportCount: input.requestedReports.length,
      });
      retryInput = omitUsageLimitsFromReports(input.initialInput);
      try {
        return await input.api.submitAgentControllerReports(retryInput);
      } catch (retryError) {
        compatibilityError = retryError;
      }
    }
    if (
      !shouldRetryWithoutAgentControllerInterface({
        error: compatibilityError,
        requestedReports: input.requestedReports,
      })
    ) {
      throw compatibilityError;
    }

    warnDaemonEvent(
      "[openmeld.runtime_reporting.agent_controller_interface_downgraded]",
      {
        error: toErrorMessage(compatibilityError),
        event: "cli.runtime_reporting.agent_controller_interface_downgraded",
        profileIds: input.requestedReports
          .map((report) => report.diagnosticProfileId)
          .filter((profileId): profileId is string => Boolean(profileId)),
        reportCount: input.requestedReports.length,
      }
    );

    return await input.api.submitAgentControllerReports({
      ...retryInput,
      reports: retryInput.reports.map(
        ({ agentControllerInterface: _agentControllerInterface, ...report }) =>
          report
      ),
    });
  }
}

function omitUsageLimitsFromReports(
  input: SubmitRuntimeAgentControllerReportsInput
): SubmitRuntimeAgentControllerReportsInput {
  return {
    ...input,
    reports: input.reports.map((report) => {
      if (
        !(
          report.agentControllerInterface?.usageAdmission ||
          report.agentControllerInterface?.usageLimits ||
          report.agentControllerInterface?.usageLimitsSupportMatrixVersion
        )
      ) {
        return report;
      }
      const {
        usageAdmission: _usageAdmission,
        usageLimits: _usageLimits,
        usageLimitsSupportMatrixVersion: _usageLimitsSupportMatrixVersion,
        ...agentControllerInterface
      } = report.agentControllerInterface;
      return { ...report, agentControllerInterface };
    }),
  };
}

function shouldRetryWithoutUsageLimits(input: {
  error: unknown;
  submittedReports: SubmitRuntimeAgentControllerReportsInput["reports"];
}): boolean {
  if (
    !input.submittedReports.some(
      (report) =>
        report.agentControllerInterface?.usageAdmission ||
        report.agentControllerInterface?.usageLimits ||
        report.agentControllerInterface?.usageLimitsSupportMatrixVersion
    )
  ) {
    return false;
  }
  const failure = toStructuredApiClientFailure(input.error);
  if (failure.status !== 400) {
    return false;
  }
  const diagnosticText = collectCompatibilityDiagnosticText(failure);
  if (
    diagnosticText.includes("usagelimits") ||
    diagnosticText.includes("usageadmission")
  ) {
    return true;
  }
  return (
    diagnosticText.includes("provider") &&
    input.submittedReports.some((report) =>
      report.agentControllerInterface?.usageLimits?.some(
        (limit) => limit.provider
      )
    )
  );
}

function shouldRetryWithoutAgentControllerInterface(input: {
  error: unknown;
  requestedReports: readonly RuntimeAgentControllerReportInput[];
}): boolean {
  if (
    !input.requestedReports.some((report) => report.agentControllerInterface)
  ) {
    return false;
  }

  const failure = toStructuredApiClientFailure(input.error);
  if (failure.status !== 400) {
    return false;
  }

  return collectCompatibilityDiagnosticText(failure).includes(
    "agentcontrollerinterface"
  );
}

function collectCompatibilityDiagnosticText(
  failure: ReturnType<typeof toStructuredApiClientFailure>
): string {
  return [
    failure.message,
    failure.schemaIssueMessage,
    failure.schemaIssuePath,
    failure.upstreamCode,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

type RuntimeAgentControllerReportsSubmission = {
  reason?: string;
  reports: readonly {
    agentControllerRef: string;
    reason?: string;
    status: "accepted" | "rejected";
  }[];
  status: "accepted" | "partial" | "rejected";
};

function resolveAgentControllerReportSubmissionResults(input: {
  deviceId: string;
  lane: string;
  registrationStatus: "created" | "reused";
  reports: readonly RuntimeAgentControllerReportInput[];
  openMeldServiceRuntimeId: string;
  submission: RuntimeAgentControllerReportsSubmission;
}): RuntimeAgentControllerReportSubmission[] {
  const submittedReportByAgentControllerRef = new Map(
    input.submission.reports.map((report) => [
      report.agentControllerRef,
      report,
    ])
  );

  return input.reports.map((requestedReport) => {
    const submittedReport = submittedReportByAgentControllerRef.get(
      requestedReport.agentControllerRef
    );
    if (
      input.submission.status === "rejected" ||
      !submittedReport ||
      submittedReport.status === "rejected"
    ) {
      return failedSubmission({
        agentControllerRef: requestedReport.agentControllerRef,
        reason: "report_rejected",
        reasonCode: resolveRejectedReportReasonCode({
          report: submittedReport,
          submission: input.submission,
        }),
        openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
      });
    }

    return {
      agentControllerRef: requestedReport.agentControllerRef,
      agentControllerReportStatus: submittedReport.status,
      deviceId: input.deviceId,
      lane: input.lane,
      reasonCodes: [],
      registrationStatus: input.registrationStatus,
      openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
      source: "runtime_reporting_api",
      status: "submitted",
    };
  });
}

function resolveRejectedReportReasonCode(input: {
  report:
    | {
        reason?: string;
        status: "accepted" | "rejected";
      }
    | undefined;
  submission: {
    reason?: string;
    status: "accepted" | "partial" | "rejected";
  };
}): string {
  if (!input.report) {
    return `runtime.agent_controller_report.${
      input.submission.reason ?? "result_missing"
    }`;
  }
  return `runtime.agent_controller_report.${
    input.report.reason ?? input.submission.reason ?? "rejected"
  }`;
}

type RuntimeProviderConversationProofsSubmission = {
  reason?: string;
  proofs: readonly {
    agentProfileId: string;
    bindingId: string;
    reason?: string;
    status: "accepted" | "rejected";
  }[];
  status: "accepted" | "partial" | "rejected";
};

function resolveProviderConversationProofSubmissionResults(input: {
  deviceId: string;
  lane: string;
  registrationStatus: "created" | "reused";
  proofs: readonly RuntimeProviderConversationProofInput[];
  openMeldServiceRuntimeId: string;
  submission: RuntimeProviderConversationProofsSubmission;
}): RuntimeProviderConversationProofSubmission[] {
  const submittedProofByIdentity = new Map(
    input.submission.proofs.map((proof) => [
      buildProviderConversationProofSubmissionKey(proof),
      proof,
    ])
  );

  return input.proofs.map((requestedProof) => {
    const submittedProof = submittedProofByIdentity.get(
      buildProviderConversationProofSubmissionKey(requestedProof)
    );
    if (
      input.submission.status === "rejected" ||
      !submittedProof ||
      submittedProof.status === "rejected"
    ) {
      return failedProviderConversationProofSubmission({
        agentProfileId: requestedProof.agentProfileId,
        bindingId: requestedProof.bindingId,
        reason: "proof_rejected",
        reasonCode: resolveRejectedProviderConversationProofReasonCode({
          proof: submittedProof,
          submission: input.submission,
        }),
        openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
      });
    }

    return {
      agentProfileId: requestedProof.agentProfileId,
      bindingId: requestedProof.bindingId,
      providerConversationProofStatus: submittedProof.status,
      deviceId: input.deviceId,
      lane: input.lane,
      reasonCodes: [],
      registrationStatus: input.registrationStatus,
      openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
      source: "runtime_reporting_api",
      status: "submitted",
    };
  });
}

function resolveRejectedProviderConversationProofReasonCode(input: {
  proof:
    | {
        reason?: string;
        status: "accepted" | "rejected";
      }
    | undefined;
  submission: {
    reason?: string;
    status: "accepted" | "partial" | "rejected";
  };
}): string {
  if (!input.proof) {
    return `provider_conversation.proof.${
      input.submission.reason ?? "result_missing"
    }`;
  }
  return `provider_conversation.proof.${
    input.proof.reason ?? input.submission.reason ?? "rejected"
  }`;
}

function buildProviderConversationProofSubmissionKey(input: {
  agentProfileId: string;
  bindingId: string;
}): string {
  return `${input.agentProfileId}:${input.bindingId}`;
}

function unavailableSubmissions(input: {
  reports: readonly RuntimeAgentControllerReportInput[];
  reason: Extract<
    RuntimeAgentControllerReportSubmission["reason"],
    "service_contract_unavailable"
  >;
  reasonCode: string;
}): RuntimeAgentControllerReportSubmission[] {
  return input.reports.map((report) =>
    unavailableSubmission({
      agentControllerRef: report.agentControllerRef,
      reason: input.reason,
      reasonCode: input.reasonCode,
    })
  );
}

function failedSubmissions(input: {
  authBaseUrl?: string;
  gatewayUrl?: string;
  guidanceReason?: "mismatch";
  reports: readonly RuntimeAgentControllerReportInput[];
  reason: Extract<
    RuntimeAgentControllerReportSubmission["reason"],
    | "auth_gateway_mismatch"
    | "auth_unavailable"
    | "registration_rejected"
    | "report_rejected"
    | "write_failed"
  >;
  reasonCode: string;
  openMeldServiceRuntimeId?: string;
}): RuntimeAgentControllerReportSubmission[] {
  return input.reports.map((report) =>
    failedSubmission({
      agentControllerRef: report.agentControllerRef,
      ...(input.authBaseUrl ? { authBaseUrl: input.authBaseUrl } : {}),
      ...(input.gatewayUrl ? { gatewayUrl: input.gatewayUrl } : {}),
      ...(input.guidanceReason ? { guidanceReason: input.guidanceReason } : {}),
      reason: input.reason,
      reasonCode: input.reasonCode,
      ...(input.openMeldServiceRuntimeId
        ? { openMeldServiceRuntimeId: input.openMeldServiceRuntimeId }
        : {}),
    })
  );
}

function unavailableProviderConversationProofSubmissions(input: {
  proofs: readonly RuntimeProviderConversationProofInput[];
  reason: Extract<
    RuntimeProviderConversationProofSubmission["reason"],
    "service_contract_unavailable"
  >;
  reasonCode: string;
}): RuntimeProviderConversationProofSubmission[] {
  return input.proofs.map((proof) =>
    unavailableProviderConversationProofSubmission({
      agentProfileId: proof.agentProfileId,
      bindingId: proof.bindingId,
      reason: input.reason,
      reasonCode: input.reasonCode,
    })
  );
}

function failedProviderConversationProofSubmissions(input: {
  authBaseUrl?: string;
  gatewayUrl?: string;
  guidanceReason?: "mismatch";
  proofs: readonly RuntimeProviderConversationProofInput[];
  reason: Extract<
    RuntimeProviderConversationProofSubmission["reason"],
    | "auth_gateway_mismatch"
    | "auth_unavailable"
    | "proof_rejected"
    | "registration_rejected"
    | "write_failed"
  >;
  reasonCode: string;
  openMeldServiceRuntimeId?: string;
}): RuntimeProviderConversationProofSubmission[] {
  return input.proofs.map((proof) =>
    failedProviderConversationProofSubmission({
      agentProfileId: proof.agentProfileId,
      bindingId: proof.bindingId,
      ...(input.authBaseUrl ? { authBaseUrl: input.authBaseUrl } : {}),
      ...(input.gatewayUrl ? { gatewayUrl: input.gatewayUrl } : {}),
      ...(input.guidanceReason ? { guidanceReason: input.guidanceReason } : {}),
      reason: input.reason,
      reasonCode: input.reasonCode,
      ...(input.openMeldServiceRuntimeId
        ? { openMeldServiceRuntimeId: input.openMeldServiceRuntimeId }
        : {}),
    })
  );
}

async function resolveRuntimeReportingAuthCompatibility(
  gatewayUrl: string
): Promise<
  | {
      status: "compatible";
    }
  | {
      status: "mismatch";
      authBaseUrl: string;
    }
  | {
      status: "unavailable";
      authState: "error" | "expired" | "invalid" | "missing";
      reasonCode?: string;
    }
> {
  const authState = await getAuthSessionState({ refreshExpired: true }).catch(
    () => null
  );
  if (!authState) {
    return { authState: "error", status: "unavailable" };
  }
  if (!(authState.state === "valid" && authState.session)) {
    // A request sent without credentials is a guaranteed gateway 401 that
    // surfaces as a bare "authentication required" with no cause. Refuse to
    // submit instead, so the failure carries the local auth state.
    return {
      reasonCode: authState.reasonCode,
      authState:
        authState.state === "expired" || authState.state === "invalid"
          ? authState.state
          : "missing",
      status: "unavailable",
    };
  }
  if (canAttachAuthTokenToRequest(authState.session, gatewayUrl)) {
    return { status: "compatible" };
  }
  return {
    authBaseUrl: authState.session.authBaseUrl,
    status: "mismatch",
  };
}

function unavailableSubmission(input: {
  agentControllerRef?: string;
  reason: Extract<
    RuntimeAgentControllerReportSubmission["reason"],
    "agent_controller_ref_unavailable" | "service_contract_unavailable"
  >;
  reasonCode: string;
}): RuntimeAgentControllerReportSubmission {
  return {
    ...(input.agentControllerRef
      ? { agentControllerRef: input.agentControllerRef }
      : {}),
    reason: input.reason,
    reasonCodes: [input.reasonCode],
    source: "runtime_reporting_api",
    status: "unavailable",
  };
}

function failedSubmission(input: {
  authBaseUrl?: string;
  agentControllerRef?: string;
  gatewayUrl?: string;
  guidanceReason?: "mismatch";
  reason: Extract<
    RuntimeAgentControllerReportSubmission["reason"],
    | "auth_gateway_mismatch"
    | "auth_unavailable"
    | "registration_rejected"
    | "report_rejected"
    | "write_failed"
  >;
  reasonCode: string;
  openMeldServiceRuntimeId?: string;
}): RuntimeAgentControllerReportSubmission {
  return {
    ...(input.authBaseUrl ? { authBaseUrl: input.authBaseUrl } : {}),
    ...(input.agentControllerRef
      ? { agentControllerRef: input.agentControllerRef }
      : {}),
    ...(input.gatewayUrl ? { gatewayUrl: input.gatewayUrl } : {}),
    ...(input.guidanceReason ? { guidanceReason: input.guidanceReason } : {}),
    ...(input.openMeldServiceRuntimeId
      ? { openMeldServiceRuntimeId: input.openMeldServiceRuntimeId }
      : {}),
    reason: input.reason,
    reasonCodes: [input.reasonCode],
    source: "runtime_reporting_api",
    status: "failed",
  };
}

function unavailableProviderConversationProofSubmission(input: {
  agentProfileId: string;
  bindingId: string;
  reason: Extract<
    RuntimeProviderConversationProofSubmission["reason"],
    "service_contract_unavailable"
  >;
  reasonCode: string;
}): RuntimeProviderConversationProofSubmission {
  return {
    agentProfileId: input.agentProfileId,
    bindingId: input.bindingId,
    reason: input.reason,
    reasonCodes: [input.reasonCode],
    source: "runtime_reporting_api",
    status: "unavailable",
  };
}

function failedProviderConversationProofSubmission(input: {
  authBaseUrl?: string;
  agentProfileId: string;
  bindingId: string;
  gatewayUrl?: string;
  guidanceReason?: "mismatch";
  reason: Extract<
    RuntimeProviderConversationProofSubmission["reason"],
    | "auth_gateway_mismatch"
    | "auth_unavailable"
    | "proof_rejected"
    | "registration_rejected"
    | "write_failed"
  >;
  reasonCode: string;
  openMeldServiceRuntimeId?: string;
}): RuntimeProviderConversationProofSubmission {
  return {
    ...(input.authBaseUrl ? { authBaseUrl: input.authBaseUrl } : {}),
    agentProfileId: input.agentProfileId,
    bindingId: input.bindingId,
    ...(input.gatewayUrl ? { gatewayUrl: input.gatewayUrl } : {}),
    ...(input.guidanceReason ? { guidanceReason: input.guidanceReason } : {}),
    ...(input.openMeldServiceRuntimeId
      ? { openMeldServiceRuntimeId: input.openMeldServiceRuntimeId }
      : {}),
    reason: input.reason,
    reasonCodes: [input.reasonCode],
    source: "runtime_reporting_api",
    status: "failed",
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : "unknown error";
  }
  const message = String(error ?? "").trim();
  return message.length > 0 ? message : "unknown error";
}
