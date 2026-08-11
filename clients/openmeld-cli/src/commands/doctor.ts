import { cancel, isCancel, select } from "@clack/prompts";
import {
  type EvidenceSyncHealth,
  resolveEvidenceSyncHealth,
} from "@openmeld/agent-runtime";
import { createAgentProfileBindingApi } from "@openmeld/api-client";
import { OPENMELD_HEADER_PROFILE_ID } from "@openmeld/gateway-contract";
import type { GetAgentExecutionReadinessResponse } from "@openmeld/schemas/types";
import { assertProjectBindingProducerCompatible } from "../agent-activity/project-binding-producer-gate";
import { migrateProjectBindingStore } from "../agent-activity/project-bindings";
import { listAgentTargetStates } from "../agents/registry";
import {
  assessCliUpdate,
  type CliUpdateAssessment,
} from "../command-entry-checks/cli-update-assessment";
import {
  getCurrentCommandCheckState,
  isCurrentCommandCheckScopeActive,
} from "../command-entry-checks/current-command-check-state";
import { assessServerRequiredVersion } from "../command-entry-checks/server-required-version-assessment";
import { reconcileCliVersionView } from "../command-entry-checks/version-reconciliation";
import { getAuthSessionState } from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import { readDaemonServiceContract } from "../config/daemon-service-contract";
import {
  type OpenMeldEnvironmentTarget,
  resolveOpenMeldEnvironmentTarget,
} from "../config/openmeld-environment-target";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { buildRequestAuthHeaders } from "../config/request-headers";
import {
  isSelectedOpenMeldProfileRequiredError,
  requireOpenMeldProfile,
} from "../config/resolve-openmeld-profile";
import { resolveRuntimeReportingHealthDiagnostic } from "../local-service/diagnostics/runtime-reporting-health-diagnostic";
import { readCurrentDaemonRuntimeContext } from "../local-service/lifecycle/daemon-service-runtime";
import { syncDeviceRuntimeStateProjection } from "../local-service/reporting/device-runtime-state-sync";
import { readRuntimeReportingHealthState } from "../local-service/state/runtime-reporting-health-state";
import { formatDaemonRouteObservationLabel } from "../local-service/status/daemon-route-observation-presentation";
import { buildCliOnboardingPlanForProfile } from "../onboarding/cli-onboarding-plan";
import { emitSetupPlanAgentView } from "../onboarding/setup-plan-presenter";
import { shouldEmitAgentOverview } from "../runtime/agent-overview-output";
import { formatInlineOpenMeldCliCommands } from "../runtime/cli-entry-command";
import { resolveRuntimeContext } from "../runtime/context";
import { createDoctorFailedGuideError } from "../runtime/dual-view-guide-catalog";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { formatMessage } from "../runtime/messages";
import { createPresenter } from "../runtime/presenter/index";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import {
  type DaemonRouteObservation,
  resolveCurrentReplyReadinessSnapshot,
} from "../system/current-reply-readiness-snapshot";
import { resolveGatewayChainReadiness } from "../system/gateway-chain-readiness";
import { syncProfileWorkspaceState } from "../system/profile-workspace-state";
import { runAuthLogin } from "./auth";
import { emitTopLevelAgentOverview } from "./top-level-agent-overview";

const DOCTOR_TEXT_PREFIX_RE = /^(ok|fail|warn)\s+/i;
const EVIDENCE_SYNC_HEALTH_CHECK_LABEL = "evidence-sync-health";
const REPLY_ROUTE_CHECK_LABEL = "reply-route";
const RUNTIME_REPORTING_HEALTH_CHECK_LABEL = "runtime-reporting-health";
const PROJECT_BINDING_STORE_CHECK_LABEL = "project-binding-store";

export async function runDoctor(input: {
  profile?: string;
  baseUrl?: string;
  view?: string;
  repair?: boolean;
  agentOverviewHandled?: boolean;
}) {
  const runtime = await resolveRuntimeContext({
    view: input.view,
    profile: input.profile,
  });
  const presenter = createPresenter(runtime);
  if (
    shouldEmitAgentOverview({
      resolvedView: runtime.resolvedView,
      handled: input.agentOverviewHandled,
    })
  ) {
    emitTopLevelAgentOverview({
      presenter,
      command: "doctor",
    });
  }
  await runDoctorInternal({
    ...input,
    runtime,
    presenter,
    allowInteractiveRecovery: true,
  });
}

async function runDoctorInternal(input: {
  profile?: string;
  baseUrl?: string;
  view?: string;
  repair?: boolean;
  runtime?: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  presenter?: ReturnType<typeof createPresenter>;
  allowInteractiveRecovery: boolean;
}) {
  const runtime =
    input.runtime ??
    (await resolveRuntimeContext({
      view: input.view,
      profile: input.profile,
    }));
  const presenter = input.presenter ?? createPresenter(runtime);

  let hasFailure = false;
  const cliUpdateCheck = await runCliUpdateDoctorCheck({
    presenter,
    resolvedView: runtime.resolvedView,
  });
  if (cliUpdateCheck.hasFailure) {
    hasFailure = true;
  }
  const doctorProfileCheck = await runDoctorProfileCheck({
    presenter,
    resolvedView: runtime.resolvedView,
    profile: input.profile,
  });
  if (doctorProfileCheck.hasFailure) {
    hasFailure = true;
  }
  const openMeldProfile = doctorProfileCheck.openMeldProfile;
  emitDoctorSetupPlan({
    openMeldProfile,
    presenter,
    readOnly: input.repair !== true,
    resolvedView: runtime.resolvedView,
  });
  await runRuntimeReportingHealthCheck({
    presenter,
    resolvedView: runtime.resolvedView,
  });
  const projectBindingStoreHasFailure = await runProjectBindingStoreCheck({
    presenter,
    resolvedView: runtime.resolvedView,
  });
  if (projectBindingStoreHasFailure) {
    hasFailure = true;
  }

  const baseUrl = await runCheck("gateway-url", async () =>
    resolveBaseUrl(input.baseUrl)
  );
  emitCheckResult(presenter, baseUrl, {
    label: "gateway-url",
    resolvedView: runtime.resolvedView,
    okText: baseUrl.ok ? `ok gateway URL: ${baseUrl.value}` : undefined,
  });
  if (!baseUrl.ok) {
    hasFailure = true;
  }

  if (baseUrl.ok) {
    const gatewayHasFailure = await runGatewayChecks({
      baseUrl: baseUrl.value,
      profileCheck: doctorProfileCheck,
      presenter,
      resolvedView: runtime.resolvedView,
    });
    if (gatewayHasFailure) {
      hasFailure = true;
    }
  }
  const daemonRouteCheck = await runDaemonRouteCheck({
    baseUrlReady: baseUrl.ok,
    gatewayChecksHealthy: baseUrl.ok && !hasFailure,
    presenter,
    profileCheck: doctorProfileCheck,
    resolvedView: runtime.resolvedView,
  });
  if (daemonRouteCheck.hasFailure) {
    hasFailure = true;
  }

  if (baseUrl.ok) {
    await runEvidenceSyncHealthCheck({
      baseUrl: baseUrl.value,
      presenter,
      profileCheck: doctorProfileCheck,
      resolvedView: runtime.resolvedView,
    });
  }

  const runtimeProjectionCheck = await runRuntimeProjectionCheck({
    repair: input.repair,
    presenter,
    resolvedView: runtime.resolvedView,
  });
  const runtimeProjection = runtimeProjectionCheck.runtimeProjection;
  if (runtimeProjectionCheck.hasFailure) {
    hasFailure = true;
  }
  const profileWorkspaceCheck = await runProfileWorkspaceCheck({
    repair: input.repair,
    presenter,
    resolvedView: runtime.resolvedView,
  });
  if (profileWorkspaceCheck.hasFailure) {
    hasFailure = true;
  }

  if (hasFailure) {
    const recovered = await maybeRecoverAndRerunDoctor({
      runtime,
      allowInteractiveRecovery: input.allowInteractiveRecovery,
      presenter,
      runtimeProjection,
      openMeldProfile,
      rerunInput: input,
    });
    if (recovered) {
      return;
    }
    if (runtime.resolvedView === "agent") {
      throw createDoctorFailedGuideError();
    }
    throw new Error(
      formatMessage(runtime.resolvedView, "doctor.summary.failed")
    );
  }
}

async function runProjectBindingStoreCheck(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): Promise<boolean> {
  const check = await runCheck(PROJECT_BINDING_STORE_CHECK_LABEL, async () => {
    await assertProjectBindingProducerCompatible();
    return await migrateProjectBindingStore({});
  });
  let okText: string | undefined;
  if (check.ok) {
    okText =
      check.value === "migrated"
        ? "ok local Project connections migrated to the current format"
        : "ok local Project connection store";
  }
  emitCheckResult(input.presenter, check, {
    data: check.ok ? { migrationStatus: check.value } : undefined,
    label: PROJECT_BINDING_STORE_CHECK_LABEL,
    okText,
    resolvedView: input.resolvedView,
  });
  return !check.ok;
}

async function runRuntimeReportingHealthCheck(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): Promise<void> {
  const check = await runCheck(
    RUNTIME_REPORTING_HEALTH_CHECK_LABEL,
    async () => {
      const [runtimeContext, serviceContract] = await Promise.all([
        readCurrentDaemonRuntimeContext(),
        readDaemonServiceContract(),
      ]);
      const healthState = await readRuntimeReportingHealthState(
        {},
        serviceContract
          ? {
              contractGeneration: serviceContract.generation,
              deviceId: serviceContract.deviceId,
            }
          : undefined
      );
      return resolveRuntimeReportingHealthDiagnostic({
        effectiveRuntimeStatus: runtimeContext.effectiveRuntimeStatus,
        healthState,
        runtimeStartedAt: runtimeContext.runtimeStatus.startedAt,
      });
    }
  );
  if (!check.ok) {
    emitCheckWarning(input.presenter, {
      label: RUNTIME_REPORTING_HEALTH_CHECK_LABEL,
      message: check.message,
      resolvedView: input.resolvedView,
    });
    return;
  }
  if (check.value.kind === "warn") {
    emitCheckWarning(input.presenter, {
      data: check.value.facts,
      label: RUNTIME_REPORTING_HEALTH_CHECK_LABEL,
      message: check.value.message,
      resolvedView: input.resolvedView,
    });
    return;
  }
  if (check.value.kind === "info") {
    emitCheckInfo(input.presenter, {
      data: check.value.facts,
      label: RUNTIME_REPORTING_HEALTH_CHECK_LABEL,
      message: check.value.message,
      resolvedView: input.resolvedView,
    });
    return;
  }
  emitCheckResult(
    input.presenter,
    { ok: true, value: check.value },
    {
      label: RUNTIME_REPORTING_HEALTH_CHECK_LABEL,
      data: check.value.facts,
      okText: check.value.message,
      resolvedView: input.resolvedView,
    }
  );
}

function emitDoctorSetupPlan(input: {
  openMeldProfile: CheckResult<DoctorOpenMeldProfile>;
  presenter: ReturnType<typeof createPresenter>;
  readOnly: boolean;
  resolvedView: "human" | "agent";
}): void {
  if (
    input.resolvedView !== "agent" ||
    !input.readOnly ||
    !input.openMeldProfile.ok
  ) {
    return;
  }

  const { facts, plan } = buildCliOnboardingPlanForProfile({
    profile: input.openMeldProfile.value,
  });
  emitSetupPlanAgentView({
    facts,
    mode: "read_only",
    plan,
    presenter: input.presenter,
  });
}

async function runDoctorProfileCheck(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  profile?: string;
}): Promise<DoctorProfileCheckState> {
  const signInReady = await resolveDoctorSignInReady();
  if (!signInReady) {
    const message = formatInlineOpenMeldCliCommands(
      "sign in to check your OpenMeld profile and remote OpenMeld access."
    );
    emitCheckInfo(input.presenter, {
      label: "openmeld-profile",
      resolvedView: input.resolvedView,
      message,
    });
    return {
      kind: "sign_in_required",
      openMeldProfile: {
        ok: false,
        message,
      },
      hasFailure: false,
      signInReady: false,
    };
  }

  let openMeldProfile: CheckResult<DoctorOpenMeldProfile>;
  try {
    openMeldProfile = {
      ok: true,
      value: await requireOpenMeldProfile({
        openMeldProfileId: input.profile,
        persistSelection: false,
        allowDefaultFallback: false,
        authAction: "running doctor checks",
      }),
    };
  } catch (error) {
    if (isSelectedOpenMeldProfileRequiredError(error)) {
      const message = formatInlineOpenMeldCliCommands(
        "No OpenMeld profile is selected for this terminal yet. Profile-specific checks were skipped. Run `openmeld start` to choose one, or pass `--profile <id>`."
      );
      emitCheckInfo(input.presenter, {
        label: "openmeld-profile",
        resolvedView: input.resolvedView,
        message,
      });
      return {
        kind: "no_selected_profile",
        openMeldProfile: {
          ok: false,
          message,
        },
        hasFailure: false,
        signInReady: true,
      };
    }
    openMeldProfile = {
      ok: false,
      message: `openmeld-profile failed: ${toErrorMessage(error)}`,
    };
  }

  emitCheckResult(input.presenter, openMeldProfile, {
    label: "openmeld-profile",
    resolvedView: input.resolvedView,
    okText: openMeldProfile.ok
      ? `ok OpenMeld profile: ${openMeldProfile.value.profileName} (${openMeldProfile.value.profileKind}:${openMeldProfile.value.openMeldProfileId})`
      : undefined,
  });
  return {
    kind: "ready",
    openMeldProfile,
    hasFailure: !openMeldProfile.ok,
    signInReady: true,
  };
}

async function resolveDoctorSignInReady(): Promise<boolean> {
  const signInState = getCurrentCommandCheckState().signIn;
  if (isCurrentCommandCheckScopeActive() && signInState?.status === "valid") {
    return true;
  }
  const authState = await getAuthSessionState({
    validateRemote: false,
  }).catch(() => null);
  return authState?.state === "valid";
}

async function runRuntimeProjectionCheck(input: {
  repair?: boolean;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): Promise<{
  runtimeProjection: CheckResult<
    Awaited<ReturnType<typeof syncDeviceRuntimeStateProjection>>
  >;
  hasFailure: boolean;
}> {
  const runtimeProjection = await runCheck("local-agent-setup", async () =>
    syncDeviceRuntimeStateProjection({
      mode: input.repair ? "repair" : "check",
    })
  );

  if (!runtimeProjection.ok) {
    emitCheckResult(input.presenter, runtimeProjection, {
      label: "local-agent-setup",
      resolvedView: input.resolvedView,
    });
    return {
      runtimeProjection,
      hasFailure: true,
    };
  }

  const result = runtimeProjection.value;
  await emitRuntimeProjectionResult({
    presenter: input.presenter,
    result,
    resolvedView: input.resolvedView,
  });

  if (result.status !== "degraded") {
    return {
      runtimeProjection,
      hasFailure: false,
    };
  }

  const hasBlockingProjectionIssue =
    result.missingControllerIds.length > 0 ||
    (result.repairRequiredControllerIds?.length ?? 0) > 0;
  return {
    runtimeProjection,
    hasFailure: hasBlockingProjectionIssue,
  };
}

async function emitRuntimeProjectionResult(input: {
  presenter: ReturnType<typeof createPresenter>;
  result: Awaited<ReturnType<typeof syncDeviceRuntimeStateProjection>>;
  resolvedView: "human" | "agent";
}): Promise<void> {
  if (input.result.status === "degraded") {
    const hasMissingProjection = input.result.missingControllerIds.length > 0;
    const hasRepairRequired =
      (input.result.repairRequiredControllerIds?.length ?? 0) > 0;
    const enableSuggestion = await resolveEnableSuggestion({
      projectedControllerIds: input.result.projectedControllerIds,
      disabledControllerIds: input.result.disabledControllerIds,
    });
    if (hasMissingProjection) {
      emitCheckResult(
        input.presenter,
        {
          ok: false,
          message: formatInlineOpenMeldCliCommands(
            `Your OpenMeld setup needs repair: some required agent controllers are missing on this device. Run \`openmeld doctor --repair\` now.${
              enableSuggestion
                ? ` Then run \`${enableSuggestion}\` if you want those agent controllers turned on.`
                : ""
            }`
          ),
        },
        {
          label: "local-agent-setup",
          resolvedView: input.resolvedView,
        }
      );
    } else if (hasRepairRequired) {
      emitCheckResult(
        input.presenter,
        {
          ok: false,
          message: formatInlineOpenMeldCliCommands(
            "Your OpenMeld setup needs repair: some projected agent controllers on this device still cannot be started. Run `openmeld doctor --repair` now."
          ),
        },
        {
          label: "local-agent-setup",
          resolvedView: input.resolvedView,
        }
      );
    } else {
      emitCheckWarning(input.presenter, {
        label: "local-agent-setup",
        resolvedView: input.resolvedView,
        message: formatInlineOpenMeldCliCommands(
          `Your OpenMeld setup needs attention: some agent controllers are turned off on this device.${
            enableSuggestion
              ? ` Run \`${enableSuggestion}\` if you want automatic replies.`
              : " Run `openmeld agents enable --all` if you want automatic replies."
          }`
        ),
      });
    }
    emitRuntimeProjectionDetails({
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      result: input.result,
    });
    return;
  }

  if (input.result.status === "skipped") {
    emitCheckWarning(input.presenter, {
      label: "local-agent-setup",
      resolvedView: input.resolvedView,
      message:
        "Local OpenMeld setup could not be checked because sign-in is required.",
    });
    emitRuntimeProjectionDetails({
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      result: input.result,
    });
    return;
  }

  emitCheckResult(
    input.presenter,
    { ok: true, value: input.result },
    {
      label: "local-agent-setup",
      resolvedView: input.resolvedView,
      okText: "Your OpenMeld setup looks good.",
    }
  );
  if (input.result.repairedControllerIds.length > 0) {
    emitRuntimeProjectionDetails({
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      result: input.result,
    });
  }
}

async function runProfileWorkspaceCheck(input: {
  repair?: boolean;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): Promise<{
  hasFailure: boolean;
  profileWorkspace: Awaited<ReturnType<typeof syncProfileWorkspaceState>>;
}> {
  const profileWorkspace = await syncProfileWorkspaceState({
    mode: input.repair ? "repair" : "check",
  });

  await emitProfileWorkspaceResult({
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    result: profileWorkspace,
  });

  return {
    hasFailure: profileWorkspace.status === "degraded",
    profileWorkspace,
  };
}

async function runDaemonRouteCheck(input: {
  baseUrlReady: boolean;
  gatewayChecksHealthy: boolean;
  presenter: ReturnType<typeof createPresenter>;
  profileCheck: DoctorProfileCheckState;
  resolvedView: "human" | "agent";
}): Promise<{ hasFailure: boolean }> {
  if (!input.baseUrlReady) {
    emitCheckInfo(input.presenter, {
      label: REPLY_ROUTE_CHECK_LABEL,
      resolvedView: input.resolvedView,
      message:
        "Reply route checks were skipped because the gateway URL is not available yet.",
    });
    return { hasFailure: false };
  }

  if (!input.gatewayChecksHealthy) {
    emitCheckInfo(input.presenter, {
      label: REPLY_ROUTE_CHECK_LABEL,
      resolvedView: input.resolvedView,
      message:
        "Reply route checks were skipped because gateway connectivity is not healthy enough yet.",
    });
    return { hasFailure: false };
  }

  if (!input.profileCheck.openMeldProfile.ok) {
    emitCheckInfo(input.presenter, {
      label: REPLY_ROUTE_CHECK_LABEL,
      resolvedView: input.resolvedView,
      message: resolveDaemonRouteSkipMessage({
        kind: input.profileCheck.kind,
        openMeldProfileMessage: input.profileCheck.openMeldProfile.message,
      }),
    });
    return { hasFailure: false };
  }

  const openMeldProfile = input.profileCheck.openMeldProfile.value;

  if (openMeldProfile.profileKind !== "agent") {
    emitCheckInfo(input.presenter, {
      label: REPLY_ROUTE_CHECK_LABEL,
      resolvedView: input.resolvedView,
      message:
        "Reply route checks were skipped because reply route lookup only works for agent profiles.",
    });
    return { hasFailure: false };
  }

  const snapshot = await runCheck("reply route", async () =>
    resolveCurrentReplyReadinessSnapshot({
      checkGatewayChain: false,
      includeDaemonRouteObservation: true,
      openClawDiagnosticsMode: null,
      ownerUserId: openMeldProfile.ownerUserId,
      profile: openMeldProfile,
    })
  );
  if (!snapshot.ok) {
    emitCheckResult(input.presenter, snapshot, {
      label: REPLY_ROUTE_CHECK_LABEL,
      resolvedView: input.resolvedView,
    });
    return { hasFailure: true };
  }

  return emitDaemonRouteObservationResult({
    presenter: input.presenter,
    profileId: openMeldProfile.openMeldProfileId,
    resolvedView: input.resolvedView,
    observation: snapshot.value.daemonRouteObservation,
  });
}

async function runEvidenceSyncHealthCheck(input: {
  baseUrl: string;
  presenter: ReturnType<typeof createPresenter>;
  profileCheck: DoctorProfileCheckState;
  resolvedView: "human" | "agent";
}): Promise<void> {
  if (!input.profileCheck.openMeldProfile.ok) {
    emitCheckInfo(input.presenter, {
      label: EVIDENCE_SYNC_HEALTH_CHECK_LABEL,
      resolvedView: input.resolvedView,
      message:
        "Evidence sync health was skipped because no OpenMeld profile is selected.",
    });
    return;
  }

  const openMeldProfile = input.profileCheck.openMeldProfile.value;
  if (openMeldProfile.profileKind !== "agent") {
    emitCheckInfo(input.presenter, {
      label: EVIDENCE_SYNC_HEALTH_CHECK_LABEL,
      resolvedView: input.resolvedView,
      message:
        "Evidence sync health was skipped because this profile is not an agent profile.",
    });
    return;
  }

  const readiness = await runCheck("evidence sync health", async () =>
    fetchAgentExecutionReadinessForDoctor({
      openMeldProfile,
      baseUrl: input.baseUrl,
    })
  );
  if (!readiness.ok) {
    emitCheckWarning(input.presenter, {
      label: EVIDENCE_SYNC_HEALTH_CHECK_LABEL,
      resolvedView: input.resolvedView,
      message: `${readiness.message}. Public Wake availability is still owned by Core readiness surfaces.`,
    });
    return;
  }

  const health = resolveEvidenceSyncHealth({
    generatedAt: readiness.value.generatedAt,
    readiness: readiness.value.agentExecutionReadiness,
  });
  emitEvidenceSyncHealthResult({
    health,
    presenter: input.presenter,
    resolvedView: input.resolvedView,
  });
}

async function fetchAgentExecutionReadinessForDoctor(input: {
  openMeldProfile: DoctorOpenMeldProfile;
  baseUrl: string;
}): Promise<GetAgentExecutionReadinessResponse> {
  const api = createAgentProfileBindingApi(
    createCliApiClientFoundation(input.baseUrl)
  );
  return await api.getExecutionReadiness({
    agentProfileId: input.openMeldProfile.openMeldProfileId,
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile: input.openMeldProfile,
    }),
  });
}

function emitEvidenceSyncHealthResult(input: {
  health: EvidenceSyncHealth;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): void {
  const attentionChannels = input.health.channels.filter(
    (channel) => channel.status === "blocked" || channel.status === "degraded"
  );
  const text = `Evidence sync health: ${input.health.status}. ${input.health.summary}${
    attentionChannels.length > 0
      ? ` Channels needing attention: ${formatEvidenceSyncHealthChannels(attentionChannels)}.`
      : ""
  }`;
  input.presenter.line({
    code: "doctor.evidence_sync_health",
    text: withDoctorEmoji({
      kind: input.health.status === "healthy" ? "ok" : "info",
      resolvedView: input.resolvedView,
      text,
    }),
    data: {
      evidenceSyncHealth: input.health,
      label: EVIDENCE_SYNC_HEALTH_CHECK_LABEL,
    },
  });
}

function formatEvidenceSyncHealthChannels(
  channels: readonly EvidenceSyncHealth["channels"][number][]
): string {
  return channels
    .map((channel) =>
      channel.failureCode
        ? `${channel.label} (${channel.failureCode})`
        : channel.label
    )
    .join(", ");
}

function emitProfileWorkspaceResult(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  result: Awaited<ReturnType<typeof syncProfileWorkspaceState>>;
}): void {
  if (input.result.status === "skipped") {
    emitCheckInfo(input.presenter, {
      label: "profile-workspace",
      resolvedView: input.resolvedView,
      message: input.result.reason,
    });
    return;
  }

  if (input.result.status === "degraded") {
    const hasInvalid = input.result.invalidWorkspaceProfileIds.length > 0;
    const message = hasInvalid
      ? formatInlineOpenMeldCliCommands(
          "OpenMeld found agent profiles that should be able to reply from this device, but their local workspace files on this device are broken, so they cannot reply here yet. Run `openmeld doctor --repair` now."
        )
      : formatInlineOpenMeldCliCommands(
          "OpenMeld found agent profiles that should be able to reply from this device, but this device has not created their local workspace files yet, so they cannot reply here yet. Run `openmeld doctor --repair` now."
        );
    emitCheckResult(
      input.presenter,
      {
        ok: false,
        message,
      },
      {
        label: "profile-workspace",
        resolvedView: input.resolvedView,
      }
    );
    emitProfileWorkspaceDetails({
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      result: input.result,
    });
    return;
  }

  emitCheckResult(
    input.presenter,
    { ok: true, value: input.result },
    {
      label: "profile-workspace",
      resolvedView: input.resolvedView,
      okText:
        "Local workspace files for agent profiles on this device look good.",
    }
  );
  if (
    input.result.migratedProfileIds.length > 0 ||
    input.result.provisionedProfileIds.length > 0
  ) {
    emitProfileWorkspaceDetails({
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      result: input.result,
    });
  }
}

function emitProfileWorkspaceDetails(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  result: Awaited<ReturnType<typeof syncProfileWorkspaceState>>;
}): void {
  const details = buildProfileWorkspaceDetailMessages(input.result);
  if (details.length === 0) {
    return;
  }

  for (const message of details) {
    emitCheckInfo(input.presenter, {
      label: "profile-workspace",
      resolvedView: input.resolvedView,
      message,
    });
  }
}

function buildProfileWorkspaceDetailMessages(
  result: Awaited<ReturnType<typeof syncProfileWorkspaceState>>
): string[] {
  const details: string[] = [];
  if (result.projectedProfileIds.length > 0) {
    details.push(
      `Agent profiles that should be able to reply from this device: ${result.projectedProfileIds.join(", ")}`
    );
  }
  if (result.missingWorkspaceProfileIds.length > 0) {
    details.push(
      `This device is missing local workspace files (local-meta.json + workspace/) for: ${result.missingWorkspaceProfileIds.join(", ")}`
    );
  }
  if (result.invalidWorkspaceProfileIds.length > 0) {
    details.push(
      `This device has broken local workspace files for: ${result.invalidWorkspaceProfileIds.join(", ")}`
    );
  }
  if (result.migratedProfileIds.length > 0) {
    details.push(
      `Repair refreshed older local workspace config for: ${result.migratedProfileIds.join(", ")}`
    );
  }
  if (result.provisionedProfileIds.length > 0) {
    details.push(
      `Repair created local workspace files (local-meta.json + workspace/) for: ${result.provisionedProfileIds.join(", ")}`
    );
  }
  return details;
}

function emitDaemonRouteObservationResult(input: {
  presenter: ReturnType<typeof createPresenter>;
  profileId: string;
  resolvedView: "human" | "agent";
  observation: DaemonRouteObservation;
}): { hasFailure: boolean } {
  if (input.observation.status === "online") {
    emitCheckResult(
      input.presenter,
      {
        ok: true,
        value: input.observation,
      },
      {
        label: REPLY_ROUTE_CHECK_LABEL,
        resolvedView: input.resolvedView,
        okText:
          "ok reply route: OpenMeld server can currently deliver Wake requests to this profile.",
      }
    );
    return { hasFailure: false };
  }

  if (input.observation.status === "offline") {
    emitCheckResult(
      input.presenter,
      {
        ok: false,
        message: formatInlineOpenMeldCliCommands(
          `OpenMeld server can't currently deliver wakes to this profile. This does not always mean the local OpenMeld setup is broken. If you just started OpenMeld Service or just created this profile, wait a few seconds and run \`openmeld service status --profile ${input.profileId}\` again.`
        ),
      },
      {
        label: REPLY_ROUTE_CHECK_LABEL,
        resolvedView: input.resolvedView,
      }
    );
    emitCheckInfo(input.presenter, {
      label: REPLY_ROUTE_CHECK_LABEL,
      resolvedView: input.resolvedView,
      message: `Reply Route: ${formatDaemonRouteObservationLabel(input.observation)}`,
    });
    return { hasFailure: true };
  }

  if (input.observation.reasonCode === "server_unsupported") {
    emitCheckWarning(input.presenter, {
      label: REPLY_ROUTE_CHECK_LABEL,
      resolvedView: input.resolvedView,
      message:
        "Reply route status is unavailable on this OpenMeld server. This is a server capability gap, not a local setup failure.",
    });
    return { hasFailure: false };
  }

  if (input.observation.reasonCode === "lookup_failed") {
    emitCheckResult(
      input.presenter,
      {
        ok: false,
        message: formatInlineOpenMeldCliCommands(
          `OpenMeld could not confirm the current reply route for this profile. Run \`openmeld service status --profile ${input.profileId}\` again in a few seconds.`
        ),
      },
      {
        label: REPLY_ROUTE_CHECK_LABEL,
        resolvedView: input.resolvedView,
      }
    );
    emitCheckInfo(input.presenter, {
      label: REPLY_ROUTE_CHECK_LABEL,
      resolvedView: input.resolvedView,
      message: `Reply Route: ${formatDaemonRouteObservationLabel(input.observation)}`,
    });
    return { hasFailure: true };
  }

  emitCheckInfo(input.presenter, {
    label: REPLY_ROUTE_CHECK_LABEL,
    resolvedView: input.resolvedView,
    message: `Reply Route: ${formatDaemonRouteObservationLabel(input.observation)}`,
  });
  return { hasFailure: false };
}

async function resolveEnableSuggestion(input: {
  projectedControllerIds: string[];
  disabledControllerIds: string[];
}): Promise<string | null> {
  const states = await listAgentTargetStates().catch(() => []);
  const selectableBuiltinIds = new Set(
    states
      .filter(
        (state) =>
          state.targetKind === "builtin" &&
          state.lifecycleStatus !== "suspended" &&
          state.selectable
      )
      .map((state) => state.agentId)
  );
  if (selectableBuiltinIds.size === 0) {
    return null;
  }

  const preferredIds = [
    ...new Set([
      ...input.disabledControllerIds,
      ...input.projectedControllerIds,
    ]),
  ].filter((controllerId) => selectableBuiltinIds.has(controllerId));

  const selectedIds =
    preferredIds.length > 0
      ? preferredIds.slice(0, 3)
      : [...selectableBuiltinIds]
          .sort((left, right) => left.localeCompare(right))
          .slice(0, 3);

  if (selectedIds.length === 0) {
    return null;
  }

  return `openmeld agents enable --agent ${selectedIds.join(" ")}`;
}

async function maybeRecoverAndRerunDoctor(input: {
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  allowInteractiveRecovery: boolean;
  presenter: ReturnType<typeof createPresenter>;
  runtimeProjection: CheckResult<
    Awaited<ReturnType<typeof syncDeviceRuntimeStateProjection>>
  >;
  openMeldProfile: CheckResult<DoctorOpenMeldProfile>;
  rerunInput: {
    profile?: string;
    baseUrl?: string;
    view?: string;
    repair?: boolean;
  };
}): Promise<boolean> {
  if (
    input.runtime.resolvedView !== "human" ||
    !input.allowInteractiveRecovery ||
    !canUseInteractivePrompts(input.runtime)
  ) {
    return false;
  }

  const interactiveRecovered = await maybeRunInteractiveRecovery({
    presenter: input.presenter,
    runtimeProjection: input.runtimeProjection,
    openMeldProfile: input.openMeldProfile,
  });
  if (!interactiveRecovered) {
    return false;
  }

  await runDoctorInternal({
    ...input.rerunInput,
    runtime: input.runtime,
    presenter: input.presenter,
    allowInteractiveRecovery: false,
  });
  return true;
}

async function maybeRunInteractiveRecovery(input: {
  presenter: ReturnType<typeof createPresenter>;
  openMeldProfile: CheckResult<DoctorOpenMeldProfile>;
  runtimeProjection: CheckResult<
    Awaited<ReturnType<typeof syncDeviceRuntimeStateProjection>>
  >;
}): Promise<boolean> {
  const canLoginNow =
    !input.openMeldProfile.ok &&
    input.openMeldProfile.message.includes("authentication required");
  const canRepairNow =
    input.runtimeProjection.ok &&
    input.runtimeProjection.value.missingControllerIds.length > 0;

  if (!(canLoginNow || canRepairNow)) {
    return false;
  }

  const options: Array<{ value: string; label: string; hint?: string }> = [];
  if (canLoginNow) {
    options.push({
      value: "login",
      label: "Sign in now",
      hint: "Open your browser to sign in",
    });
  }
  if (canRepairNow) {
    options.push({
      value: "repair",
      label: "Repair now",
      hint: "Fix the missing OpenMeld setup on this device",
    });
  }
  options.push({
    value: "rerun",
    label: "Rerun diagnostics",
  });
  options.push({
    value: "exit",
    label: "Exit",
  });

  const selected = await select({
    message: "OpenMeld diagnostics found actions you can take. Choose one:",
    options,
  });

  if (isCancel(selected) || selected === "exit") {
    cancel("Cancelled.");
    return false;
  }

  if (selected === "login") {
    await runAuthLogin({
      view: "human",
    });
    input.presenter.line({
      code: "doctor.recovery.login.completed",
      text: "✅ Sign-in completed.",
    });
    await maybePromptRepairAfterLogin(input.presenter);
    input.presenter.line({
      code: "doctor.recovery.rerun",
      text: "ℹ️ Rerunning diagnostics once.",
    });
    return true;
  }

  if (selected === "repair") {
    const repaired = await syncDeviceRuntimeStateProjection({
      mode: "repair",
    });
    input.presenter.line({
      code: "doctor.recovery.repair.completed",
      text: `✅ Repair completed: ${repaired.reason}`,
      data: repaired,
    });
    return true;
  }

  if (selected === "rerun") {
    input.presenter.line({
      code: "doctor.recovery.rerun",
      text: "ℹ️ Rerunning diagnostics once.",
    });
    return true;
  }

  return false;
}

type DoctorOpenMeldProfile = OpenMeldProfile;

type CheckResult<T> = { ok: true; value: T } | { ok: false; message: string };
type SuccessfulCheckResult<T> = Extract<CheckResult<T>, { ok: true }>;
type FailedCheckResult<T> = Extract<CheckResult<T>, { ok: false }>;

type DoctorProfileCheckState =
  | {
      kind: "ready";
      openMeldProfile:
        | SuccessfulCheckResult<DoctorOpenMeldProfile>
        | FailedCheckResult<DoctorOpenMeldProfile>;
      hasFailure: boolean;
      signInReady: true;
    }
  | {
      kind: "sign_in_required";
      openMeldProfile: FailedCheckResult<DoctorOpenMeldProfile>;
      hasFailure: false;
      signInReady: false;
    }
  | {
      kind: "no_selected_profile";
      openMeldProfile: FailedCheckResult<DoctorOpenMeldProfile>;
      hasFailure: false;
      signInReady: true;
    };

async function runCliUpdateDoctorCheck(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): Promise<{ hasFailure: boolean }> {
  const environmentTarget = await resolveOpenMeldEnvironmentTarget();
  const assessment = await assessCliUpdate({ environmentTarget }).catch(
    () => null
  );

  let hasFailure = false;
  if (assessment?.checked && assessment.latestVersion) {
    if (assessment.floorBreached) {
      const target = assessment.requiredFloor ?? assessment.latestVersion;
      emitCheckResult(
        input.presenter,
        {
          ok: false,
          message: formatInlineOpenMeldCliCommands(
            `cli-update failed: a required OpenMeld CLI update is pending — update from ${assessment.currentVersion} to at least ${target} (run \`openmeld upgrade --yes\`).`
          ),
        },
        { label: "cli-update", resolvedView: input.resolvedView }
      );
      hasFailure = true;
    } else if (assessment.updateAvailable) {
      emitCheckWarning(input.presenter, {
        label: "cli-update",
        message: formatInlineOpenMeldCliCommands(
          `warn cli-update: OpenMeld CLI ${assessment.latestVersion} is available (run \`openmeld upgrade --yes\`).`
        ),
        resolvedView: input.resolvedView,
      });
    } else {
      emitCheckResult(
        input.presenter,
        { ok: true, value: null },
        {
          label: "cli-update",
          okText: `ok cli-update: OpenMeld CLI ${assessment.currentVersion} is current`,
          resolvedView: input.resolvedView,
        }
      );
    }
  }

  // Second, independent book: what does Core's release manifest currently
  // require for this account (W-REL-DOCTOR)? This never fails the doctor run
  // on its own (informational only) — it only ever adds a line surfacing a
  // channel/server disagreement or confirming they agree.
  if (assessment) {
    await runServerRequiredVersionDoctorCheck({
      channelAssessment: assessment,
      environmentTarget,
      presenter: input.presenter,
      resolvedView: input.resolvedView,
    });
  }

  return { hasFailure };
}

async function runServerRequiredVersionDoctorCheck(input: {
  channelAssessment: CliUpdateAssessment;
  environmentTarget: OpenMeldEnvironmentTarget;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): Promise<void> {
  const serverAssessment = await assessServerRequiredVersion({
    gatewayUrl: input.environmentTarget.gatewayUrl,
  }).catch(() => null);
  if (!serverAssessment) {
    return;
  }

  const verdict = reconcileCliVersionView({
    channel: input.channelAssessment,
    server: serverAssessment,
  });

  if (verdict.kind === "channel_behind" || verdict.kind === "channel_ahead") {
    emitCheckWarning(input.presenter, {
      label: "cli-update-server",
      message: formatInlineOpenMeldCliCommands(verdict.message),
      resolvedView: input.resolvedView,
    });
    return;
  }

  if (verdict.kind === "aligned") {
    emitCheckResult(
      input.presenter,
      { ok: true, value: null },
      {
        label: "cli-update-server",
        okText: `ok cli-update-server: ${verdict.message}`,
        resolvedView: input.resolvedView,
      }
    );
    return;
  }

  emitCheckInfo(input.presenter, {
    label: "cli-update-server",
    message: formatInlineOpenMeldCliCommands(verdict.message),
    resolvedView: input.resolvedView,
  });
}

async function runCheck<T>(
  label: string,
  fn: () => Promise<T>
): Promise<CheckResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, message: `${label} failed: ${toErrorMessage(err)}` };
  }
}

function emitCheckResult<T>(
  presenter: ReturnType<typeof createPresenter>,
  result: CheckResult<T>,
  input: {
    data?: Record<string, unknown>;
    label: string;
    okText?: string;
    resolvedView: "human" | "agent";
  }
): void {
  if (result.ok) {
    const text = String(input.okText ?? `ok ${input.label}`);
    presenter.line({
      code: "doctor.check.ok",
      text: withDoctorEmoji({
        text,
        kind: "ok",
        resolvedView: input.resolvedView,
      }),
      data: {
        label: input.label,
        ...input.data,
      },
    });
    return;
  }

  presenter.line({
    code: "doctor.check.fail",
    text: withDoctorEmoji({
      text: result.message,
      kind: "fail",
      resolvedView: input.resolvedView,
    }),
    data: {
      label: input.label,
    },
  });
}

function emitCheckWarning(
  presenter: ReturnType<typeof createPresenter>,
  input: {
    data?: Record<string, unknown>;
    label: string;
    message: string;
    resolvedView: "human" | "agent";
  }
): void {
  presenter.line({
    code: "doctor.check.warn",
    text: withDoctorEmoji({
      text: input.message,
      kind: "warn",
      resolvedView: input.resolvedView,
    }),
    data: {
      label: input.label,
      ...input.data,
    },
  });
}

function emitCheckInfo(
  presenter: ReturnType<typeof createPresenter>,
  input: {
    data?: Record<string, unknown>;
    label: string;
    message: string;
    resolvedView: "human" | "agent";
  }
): void {
  presenter.line({
    code: "doctor.check.info",
    text: withDoctorEmoji({
      text: input.message,
      kind: "info",
      resolvedView: input.resolvedView,
    }),
    data: {
      label: input.label,
      ...input.data,
    },
  });
}

function emitRuntimeProjectionDetails(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  result: Awaited<ReturnType<typeof syncDeviceRuntimeStateProjection>>;
}): void {
  const detailParts: string[] = [];
  if (input.result.projectedControllerIds.length > 0) {
    detailParts.push(
      `Your account expects these local agent runtimes on this device: ${input.result.projectedControllerIds.join(", ")}`
    );
  }
  if (input.result.missingControllerIds.length > 0) {
    detailParts.push(
      `This device is missing local setup for: ${input.result.missingControllerIds.join(", ")}`
    );
  }
  if (input.result.disabledControllerIds.length > 0) {
    detailParts.push(
      `This device has these runtimes turned off: ${input.result.disabledControllerIds.join(", ")}`
    );
  }
  if ((input.result.repairRequiredControllerIds?.length ?? 0) > 0) {
    detailParts.push(
      `These runtimes need local launch repair: ${input.result.repairRequiredControllerIds?.join(", ")}`
    );
  }
  if (input.result.repairedControllerIds.length > 0) {
    detailParts.push(
      `Repair refreshed local setup for: ${input.result.repairedControllerIds.join(", ")}`
    );
  }
  if (detailParts.length === 0) {
    return;
  }

  input.presenter.line({
    code: "doctor.device_runtime_projection.details",
    text: withDoctorEmoji({
      text: `Local agent setup details: ${detailParts.join(" | ")}`,
      kind: "info",
      resolvedView: input.resolvedView,
    }),
    data: {
      projectedControllerIds: input.result.projectedControllerIds,
      missingControllerIds: input.result.missingControllerIds,
      disabledControllerIds: input.result.disabledControllerIds,
      repairRequiredControllerIds: input.result.repairRequiredControllerIds,
      repairedControllerIds: input.result.repairedControllerIds,
      status: input.result.status,
      reason: input.result.reason,
    },
  });
}

function withDoctorEmoji(input: {
  text: string;
  kind: "ok" | "fail" | "warn" | "info";
  resolvedView: "human" | "agent";
}): string {
  if (input.resolvedView !== "human") {
    return input.text;
  }

  let symbol = "ℹ️";
  if (input.kind === "ok") {
    symbol = "✅";
  } else if (input.kind === "fail") {
    symbol = "❌";
  } else if (input.kind === "warn") {
    symbol = "⚠️";
  }
  return `${symbol} ${normalizeDoctorHumanText(input.text)}`;
}

async function maybePromptRepairAfterLogin(
  presenter: ReturnType<typeof createPresenter>
): Promise<void> {
  const projection = await syncDeviceRuntimeStateProjection({
    mode: "check",
  }).catch(() => null);
  if (!projection) {
    return;
  }

  const canRepairNow =
    (projection.status === "degraded" &&
      projection.missingControllerIds.length > 0) ||
    (projection.repairRequiredControllerIds?.length ?? 0) > 0;
  if (!canRepairNow) {
    return;
  }

  presenter.line({
    code: "doctor.recovery.repair.suggested",
    text: "⚠️ Your OpenMeld setup on this device is missing some agent controllers from your OpenMeld account.",
    data: {
      missingControllerIds: projection.missingControllerIds,
      repairRequiredControllerIds: projection.repairRequiredControllerIds,
      projectedControllerIds: projection.projectedControllerIds,
    },
  });

  const action = await select({
    message: "Repair your local OpenMeld setup now?",
    options: [
      {
        value: "repair",
        label: "Repair now",
        hint: "Set up the missing agent controllers on this device",
      },
      {
        value: "skip",
        label: "Skip for now",
      },
    ],
  });

  if (isCancel(action) || action === "skip") {
    presenter.line({
      code: "doctor.recovery.repair.skipped",
      text: formatInlineOpenMeldCliCommands(
        "ℹ️ Repair skipped. You can run `openmeld doctor --repair` later."
      ),
    });
    return;
  }

  const repaired = await syncDeviceRuntimeStateProjection({
    mode: "repair",
  });
  presenter.line({
    code: "doctor.recovery.repair.completed",
    text: `✅ Repair completed: ${repaired.reason}`,
    data: repaired,
  });
}

function normalizeDoctorHumanText(text: string): string {
  return text.replace(DOCTOR_TEXT_PREFIX_RE, "");
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

async function buildDoctorHeaders(
  openMeldProfile: CheckResult<DoctorOpenMeldProfile>,
  requestUrl: string
): Promise<Record<string, string>> {
  if (!openMeldProfile.ok) {
    return await buildRequestAuthHeaders({ requestUrl });
  }

  return {
    ...(await buildRequestAuthHeaders({ requestUrl })),
    [OPENMELD_HEADER_PROFILE_ID]: openMeldProfile.value.openMeldProfileId,
  };
}

async function runGatewayChecks(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  baseUrl: string;
  profileCheck: DoctorProfileCheckState;
}): Promise<boolean> {
  const service = await runCheck("connectivity", async () => {
    const endpoint = new URL("/", input.baseUrl).toString();
    const headers = await buildDoctorHeaders(
      input.profileCheck.openMeldProfile,
      endpoint
    );
    const response = await fetch(endpoint, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = (await response.json().catch(() => null)) as {
      service?: unknown;
    } | null;
    return typeof body?.service === "string" ? body.service : "unknown";
  });

  emitCheckResult(input.presenter, service, {
    label: "connectivity",
    resolvedView: input.resolvedView,
    okText: service.ok
      ? `ok connectivity: reachable (${service.value})`
      : undefined,
  });
  if (!service.ok) {
    return true;
  }

  const openMeldProfile = input.profileCheck.openMeldProfile;
  if (!openMeldProfile.ok) {
    const message = resolveGatewayChainSkipMessage({
      kind: input.profileCheck.kind,
      openMeldProfileMessage: openMeldProfile.message,
    });
    emitCheckInfo(input.presenter, {
      label: "gateway-chain",
      resolvedView: input.resolvedView,
      message,
    });
    return false;
  }

  const chain = await runCheck("gateway-chain", async () => {
    const readiness = await resolveGatewayChainReadiness({
      baseUrl: input.baseUrl,
      profile: {
        openMeldProfileId: openMeldProfile.value.openMeldProfileId,
        profileName: openMeldProfile.value.profileName,
      },
    });
    if (readiness.ready !== true) {
      throw new Error(readiness.details);
    }
    return "healthy";
  });

  emitCheckResult(input.presenter, chain, {
    label: "gateway-chain",
    resolvedView: input.resolvedView,
    okText: chain.ok ? `ok gateway chain: ${chain.value}` : undefined,
  });

  return !chain.ok;
}

function resolveGatewayChainSkipMessage(input: {
  kind: DoctorProfileCheckState["kind"];
  openMeldProfileMessage: string;
}): string {
  if (input.kind === "no_selected_profile") {
    return formatInlineOpenMeldCliCommands(
      "Gateway chain checks were skipped because no OpenMeld profile is selected for this terminal yet."
    );
  }
  if (input.kind === "sign_in_required") {
    return `Gateway chain checks were skipped because sign-in is required. ${input.openMeldProfileMessage}`;
  }
  return `Gateway chain checks were skipped because the OpenMeld profile check failed: ${input.openMeldProfileMessage}`;
}

function resolveDaemonRouteSkipMessage(input: {
  kind: DoctorProfileCheckState["kind"];
  openMeldProfileMessage: string;
}): string {
  if (input.kind === "no_selected_profile") {
    return formatInlineOpenMeldCliCommands(
      "Reply route checks were skipped because no OpenMeld profile is selected for this terminal yet."
    );
  }
  if (input.kind === "sign_in_required") {
    return `Reply route checks were skipped because sign-in is required. ${input.openMeldProfileMessage}`;
  }
  return `Reply route checks were skipped because the OpenMeld profile check failed: ${input.openMeldProfileMessage}`;
}
