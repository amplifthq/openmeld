import {
  resolveAuthenticationGuidance,
  resolveAuthenticationGuidanceFromError,
} from "../auth/auth-guidance";
import { resolveAuthRequestCompatibility } from "../config/auth-request-compatibility";
import {
  type AuthSessionState,
  getAuthSessionState,
} from "../config/auth-session";
import type { DaemonServiceRuntimeStatus } from "../config/daemon-state";
import {
  isOpenMeldLockError,
  resolveOpenMeldOrphanedLockIssue,
} from "../config/lock";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { resolveOpenMeldEnvPreset } from "../config/paths";
import { buildDaemonServiceRepairGuidance } from "../local-service/lifecycle/daemon-service-repair-guidance";
import type { DeviceRuntimeStateSyncResult } from "../local-service/reporting/device-runtime-state-sync";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
  formatOpenMeldCliCommands,
  formatProfileAwareOpenMeldCliCommand,
} from "../runtime/cli-entry-command";
import type { Presenter } from "../runtime/presenter/types";
import { resolveCurrentReplyReadinessSnapshot } from "../system/current-reply-readiness-snapshot";
import {
  classifyGatewayChainFailure,
  resolveGatewayChainRetryGuidance,
} from "../system/gateway-chain-readiness";
import {
  type AgentReplyReadinessStatus,
  type DeviceReplyReadinessStatus,
  formatReplyReadinessSummary,
  type ReplyReadinessReasonCode,
} from "../system/reply-readiness";
import {
  formatServiceParticipationReadinessLabel,
  formatServiceRuntimeHeadline,
  resolveServiceParticipationReadiness,
  type ServiceParticipationReadinessSummary,
} from "../system/service-participation-readiness";
import { renderInfoCard } from "../ui/info-card";
import { resolveSpaceRequestTimeoutMsForDiagnostics } from "./fetch-with-timeout";
import { parseHttpFailure } from "./http-failure";

type SpaceCommandName =
  | "create"
  | "join"
  | "send"
  | "add_members"
  | "remove_members"
  | "leave";

type HumanServiceGuidanceMode = "show" | "suppress";

type SpacePreflightPayload = {
  command: SpaceCommandName;
  actionRequirements: {
    localService: "not_required" | "required_for_local_agent_participation";
    localServiceSummary: string;
  };
  auth: {
    state: AuthSessionState;
    ready: boolean;
    compatibleWithBaseUrl: boolean;
    authBaseUrl: string | null;
    gatewayUrl: string;
  };
  profile: {
    profileId: string;
    profileName: string;
    profileKind: OpenMeldProfile["profileKind"];
  };
  agentReplyReadiness?: {
    reasonCodes: ReplyReadinessReasonCode[];
    reasonText: string;
    replyReadiness: "blocked" | "degraded" | "ready" | "unknown";
  } | null;
  services?: {
    daemon: {
      installed: boolean;
      version: string | null;
      runtimeStatus: DaemonServiceRuntimeStatus["status"];
      runtimeReason: string | null;
    };
  };
  env: {
    baseUrl: string;
    requestTimeoutMs: number;
  };
  serviceRepairGuidance?: {
    reason:
      | "service_needs_repair"
      | "service_update_available"
      | "service_not_running"
      | "service_not_installed"
      | "service_unknown";
    summary: string;
    nextSteps: string[];
  } | null;
};

export type SpaceSessionDiagnostics = {
  openMeldServiceLabel: string;
  canWakeLocalAgentsLabel: string;
};

export type SpaceFailureGuidance = {
  reason:
    | "auth_required"
    | "space_join_locked"
    | "space_password_required"
    | "space_password_invalid"
    | "space_password_too_short"
    | "space_send_timeout_uncertain"
    | "service_unavailable"
    | "local_dev_session_missing"
    | "binding_store_unavailable"
    | "daemon_control_contract_mismatch"
    | "daemon_control_endpoint_missing";
  summary: string;
  steps: string[];
};

export type SpaceCommandPreflightResult = {
  deviceReplyReadiness: DeviceReplyReadinessStatus;
  payload: SpacePreflightPayload;
  serviceParticipationReadiness: ServiceParticipationReadinessSummary;
};

const SPACE_PASSWORD_REQUIRED_RE = /\bspace[.\s]+password[.\s]+required\b/i;
const SPACE_PASSWORD_INVALID_RE = /\bspace[.\s]+password[.\s]+invalid\b/i;
const SPACE_PASSWORD_TOO_SHORT_RE = /\bpassword\b.*\btoo short\b/i;
const SPACE_PASSWORD_MIN_LENGTH_RE = /\bat least\s+6\s+characters?\b/i;
const SPACE_LOCKED_RE = /^space is locked \(/i;
const LOCAL_AGENT_BINDING_LOOKUP_FAILED_CODE =
  "controller.binding.lookup_failed";

export async function resolveSpaceSessionDiagnostics(input: {
  baseUrl: string;
  profile: OpenMeldProfile;
}): Promise<SpaceSessionDiagnostics> {
  const snapshot = await resolveCurrentReplyReadinessSnapshot({
    baseUrl: input.baseUrl,
    ownerUserId: input.profile.ownerUserId,
    profile: input.profile,
  });

  const serviceParticipationReadiness = resolveServiceParticipationReadiness({
    deviceReplyReadiness: snapshot.deviceReplyReadiness,
    inventory: snapshot.inventory,
    runtimeStatus:
      snapshot.displayRuntimeStatus ?? snapshot.runtimeStatus ?? null,
  });

  return {
    openMeldServiceLabel:
      serviceParticipationReadiness.summaryText.toLowerCase(),
    canWakeLocalAgentsLabel: resolveCanWakeLocalAgentsLabel({
      agentReplyReadiness: snapshot.agentReplyReadiness,
      serviceParticipationReadiness,
    }),
  };
}

export async function emitSpaceCommandPreflight(input: {
  presenter: Presenter;
  command: SpaceCommandName;
  profile: OpenMeldProfile;
  baseUrl: string;
  resolvedView: "human" | "agent";
  humanServiceGuidanceMode?: HumanServiceGuidanceMode;
  emitOutput?: boolean;
  runtimeProjection?: DeviceRuntimeStateSyncResult | null;
}): Promise<SpaceCommandPreflightResult> {
  const actionRequirements = resolveSpacePreflightActionRequirements(
    input.command
  );
  const authState = await getAuthSessionState({ validateRemote: false });
  if (actionRequirements.localService === "not_required") {
    const preflight = buildLocalServiceNotRequiredPreflight({
      actionRequirements,
      authState,
      baseUrl: input.baseUrl,
      command: input.command,
      profile: input.profile,
    });
    if (shouldEmitSpaceCommandPreflightOutput(input.emitOutput)) {
      emitResolvedSpaceCommandPreflight({
        presenter: input.presenter,
        command: input.command,
        resolvedView: input.resolvedView,
        humanServiceGuidanceMode: input.humanServiceGuidanceMode ?? "show",
        preflight,
      });
    }
    return preflight;
  }

  const replyReadinessSnapshot = await resolveCurrentReplyReadinessSnapshot({
    baseUrl: input.baseUrl,
    checkGatewayChain: input.command === "join",
    ownerUserId: input.profile.ownerUserId,
    profile: input.profile,
    runtimeProjection: input.runtimeProjection,
  });
  const serviceParticipationReadiness = resolveServiceParticipationReadiness({
    deviceReplyReadiness: replyReadinessSnapshot.deviceReplyReadiness,
    inventory: replyReadinessSnapshot.inventory,
    runtimeStatus:
      replyReadinessSnapshot.displayRuntimeStatus ??
      replyReadinessSnapshot.runtimeStatus,
  });
  const payload: SpacePreflightPayload = {
    command: input.command,
    auth: {
      state: authState.state,
      ready: resolvePreflightAuthReadiness({
        authState,
        baseUrl: input.baseUrl,
      }),
      compatibleWithBaseUrl: resolvePreflightAuthCompatibility({
        authState,
        baseUrl: input.baseUrl,
      }),
      authBaseUrl:
        authState.state === "valid" && authState.session
          ? authState.session.authBaseUrl
          : null,
      gatewayUrl: input.baseUrl,
    },
    profile: {
      profileId: input.profile.openMeldProfileId,
      profileName: input.profile.profileName,
      profileKind: input.profile.profileKind,
    },
    actionRequirements,
    agentReplyReadiness: toSpacePreflightAgentReplyReadiness({
      command: input.command,
      readiness: replyReadinessSnapshot.agentReplyReadiness,
    }),
    services: {
      daemon: {
        installed: replyReadinessSnapshot.daemonStatus.installed,
        version: replyReadinessSnapshot.daemonStatus.installed
          ? replyReadinessSnapshot.daemonStatus.state.daemonVersion
          : null,
        runtimeStatus:
          replyReadinessSnapshot.displayRuntimeStatus?.status ??
          replyReadinessSnapshot.runtimeStatus?.status ??
          "unknown",
        runtimeReason:
          replyReadinessSnapshot.displayRuntimeStatus?.reason ??
          replyReadinessSnapshot.runtimeStatus?.reason ??
          null,
      },
    },
    env: {
      baseUrl: input.baseUrl,
      requestTimeoutMs: resolveSpaceRequestTimeoutMsForDiagnostics(),
    },
    serviceRepairGuidance: resolveSpacePreflightRepairGuidance({
      command: input.command,
      serviceParticipationReadiness,
    }),
  };

  if (!shouldEmitSpaceCommandPreflightOutput(input.emitOutput)) {
    return {
      deviceReplyReadiness: replyReadinessSnapshot.deviceReplyReadiness,
      payload,
      serviceParticipationReadiness,
    };
  }

  emitResolvedSpaceCommandPreflight({
    presenter: input.presenter,
    command: input.command,
    resolvedView: input.resolvedView,
    humanServiceGuidanceMode: input.humanServiceGuidanceMode ?? "show",
    preflight: {
      deviceReplyReadiness: replyReadinessSnapshot.deviceReplyReadiness,
      payload,
      serviceParticipationReadiness,
    },
  });

  return {
    deviceReplyReadiness: replyReadinessSnapshot.deviceReplyReadiness,
    payload,
    serviceParticipationReadiness,
  };
}

function buildLocalServiceNotRequiredPreflight(input: {
  actionRequirements: SpacePreflightPayload["actionRequirements"];
  authState: Awaited<ReturnType<typeof getAuthSessionState>>;
  baseUrl: string;
  command: SpaceCommandName;
  profile: OpenMeldProfile;
}): SpaceCommandPreflightResult {
  const deviceReplyReadiness: DeviceReplyReadinessStatus = {
    reasonCodes: [],
    reasonText: input.actionRequirements.localServiceSummary,
    replyReadiness: "unknown",
    updatedAt: new Date().toISOString(),
    wakeableRouteCount: 0,
  };
  const serviceParticipationReadiness: ServiceParticipationReadinessSummary = {
    serviceReadiness: "unknown",
    serviceReadinessState: "unknown",
    summaryText: "not required",
    detailText: input.actionRequirements.localServiceSummary,
    nextStepSummary: null,
    nextSteps: [],
    runtimeHeadline: "unknown",
  };
  const payload: SpacePreflightPayload = {
    command: input.command,
    auth: {
      state: input.authState.state,
      ready: resolvePreflightAuthReadiness({
        authState: input.authState,
        baseUrl: input.baseUrl,
      }),
      compatibleWithBaseUrl: resolvePreflightAuthCompatibility({
        authState: input.authState,
        baseUrl: input.baseUrl,
      }),
      authBaseUrl:
        input.authState.state === "valid" && input.authState.session
          ? input.authState.session.authBaseUrl
          : null,
      gatewayUrl: input.baseUrl,
    },
    profile: {
      profileId: input.profile.openMeldProfileId,
      profileName: input.profile.profileName,
      profileKind: input.profile.profileKind,
    },
    actionRequirements: input.actionRequirements,
    agentReplyReadiness: null,
    env: {
      baseUrl: input.baseUrl,
      requestTimeoutMs: resolveSpaceRequestTimeoutMsForDiagnostics(),
    },
    serviceRepairGuidance: null,
  };

  return {
    deviceReplyReadiness,
    payload,
    serviceParticipationReadiness,
  };
}

export function emitResolvedSpaceCommandPreflight(input: {
  presenter: Presenter;
  command: SpaceCommandName;
  resolvedView: "human" | "agent";
  humanServiceGuidanceMode?: HumanServiceGuidanceMode;
  preflight: SpaceCommandPreflightResult;
}): void {
  const { payload, serviceParticipationReadiness } = input.preflight;

  if (input.resolvedView === "human") {
    const authLabel = buildHumanPreflightAuthLabel(payload.auth);
    emitHumanSpaceCommandPreflight({
      presenter: input.presenter,
      command: input.command,
      authReady: payload.auth.ready,
      authLabel,
      profileName: payload.profile.profileName,
      guidance: payload.serviceRepairGuidance,
      serviceParticipationReadiness,
      humanServiceGuidanceMode: input.humanServiceGuidanceMode ?? "show",
    });
    return;
  }

  input.presenter.line({
    code: `space.${input.command}.preflight`,
    text: buildAgentSpaceCommandPreflightText({
      payload,
      serviceParticipationReadiness,
    }),
    data: payload,
  });
  emitSpacePreflightRepairGuidance({
    presenter: input.presenter,
    command: input.command,
    guidance: payload.serviceRepairGuidance,
    mode: shouldSurfaceServiceRepairGuidanceInPreflight(input.command)
      ? "show"
      : "suppress",
  });
}

function emitHumanSpaceCommandPreflight(input: {
  presenter: Presenter;
  command: SpaceCommandName;
  authReady: boolean;
  authLabel: string;
  profileName: string;
  guidance: SpacePreflightPayload["serviceRepairGuidance"];
  serviceParticipationReadiness: ServiceParticipationReadinessSummary;
  humanServiceGuidanceMode: HumanServiceGuidanceMode;
}): void {
  if (input.command === "join") {
    renderInfoCard({
      presenter: input.presenter,
      title: "🔎 Join Quick Check",
      codePrefix: "space.join.preflight.card",
      rows: [
        {
          label: input.authReady ? "✅ Auth" : "⚠️ Auth",
          value: input.authLabel,
        },
        {
          label: "👤 Profile",
          value: input.profileName,
        },
        {
          label: "🧩 Local Service Link",
          value: formatServiceParticipationReadinessLabel(
            input.serviceParticipationReadiness
          ),
        },
        {
          label: "⚙️ OpenMeld Service Runtime",
          value: formatServiceRuntimeHeadline(
            input.serviceParticipationReadiness.runtimeHeadline
          ),
        },
      ],
      sanitize: true,
      minContentWidth: 52,
    });
    emitSpacePreflightRepairGuidance({
      presenter: input.presenter,
      command: input.command,
      guidance: input.guidance,
      mode: input.humanServiceGuidanceMode,
    });
    return;
  }

  input.presenter.line({
    code: `space.${input.command}.preflight`,
    text: buildHumanSpaceCommandPreflightText({
      authLabel: input.authLabel,
      command: input.command,
      profileName: input.profileName,
      serviceParticipationReadiness: input.serviceParticipationReadiness,
    }),
  });
  emitSpacePreflightRepairGuidance({
    presenter: input.presenter,
    command: input.command,
    guidance: input.guidance,
    mode: input.humanServiceGuidanceMode,
  });
}

function shouldSurfaceServiceRepairGuidanceInPreflight(
  command: SpaceCommandName
): boolean {
  return (
    resolveSpacePreflightActionRequirements(command).localService ===
    "required_for_local_agent_participation"
  );
}

function buildAgentSpaceCommandPreflightText(input: {
  payload: SpacePreflightPayload;
  serviceParticipationReadiness: ServiceParticipationReadinessSummary;
}): string {
  if (input.payload.actionRequirements.localService === "not_required") {
    return `preflight ${input.payload.command}: auth=${input.payload.auth.state}, profile=${input.payload.profile.profileId}, local_service=not_required`;
  }

  return `preflight ${input.payload.command}: auth=${input.payload.auth.state}, profile=${input.payload.profile.profileId}, daemon=${input.payload.services?.daemon.runtimeStatus ?? "unknown"}, local_service_link=${input.serviceParticipationReadiness.serviceReadiness}, service_state=${input.serviceParticipationReadiness.serviceReadinessState}`;
}

function buildHumanSpaceCommandPreflightText(input: {
  authLabel: string;
  command: SpaceCommandName;
  profileName: string;
  serviceParticipationReadiness: ServiceParticipationReadinessSummary;
}): string {
  const actionRequirements = resolveSpacePreflightActionRequirements(
    input.command
  );
  if (actionRequirements.localService === "not_required") {
    return `Quick check before ${input.command}: ${input.authLabel}, profile ${input.profileName}. ${actionRequirements.localServiceSummary}`;
  }

  return `Quick check before ${input.command}: ${input.authLabel}, profile ${input.profileName}, local service link: ${input.serviceParticipationReadiness.summaryText}.`;
}

function resolveSpacePreflightActionRequirements(
  command: SpaceCommandName
): SpacePreflightPayload["actionRequirements"] {
  if (command === "create") {
    return {
      localService: "not_required",
      localServiceSummary:
        "OpenMeld Service is not required to create a Space.",
    };
  }

  if (command === "send") {
    return {
      localService: "not_required",
      localServiceSummary:
        "OpenMeld Service is not required to send a Space message.",
    };
  }

  if (command === "remove_members" || command === "leave") {
    return {
      localService: "not_required",
      localServiceSummary:
        "OpenMeld Service is not required for this Space command.",
    };
  }

  return {
    localService: "required_for_local_agent_participation",
    localServiceSummary:
      "OpenMeld Service is checked only for local agent participation from this computer.",
  };
}

function resolveCanWakeLocalAgentsLabel(input: {
  agentReplyReadiness: AgentReplyReadinessStatus | null;
  serviceParticipationReadiness: ServiceParticipationReadinessSummary;
}): string {
  if (input.agentReplyReadiness) {
    return formatReplyReadinessSummary({
      reasonCodes: input.agentReplyReadiness.reasonCodes,
      reasonText: input.agentReplyReadiness.reasonText,
      replyReadiness: input.agentReplyReadiness.replyReadiness,
    });
  }

  switch (input.serviceParticipationReadiness.serviceReadiness) {
    case "ready":
      return "likely available";
    case "needs_repair":
      return "needs repair";
    case "not_running":
    case "not_installed":
      return "unavailable";
    default:
      return "unknown";
  }
}

function resolvePreflightAuthReadiness(input: {
  authState: Awaited<ReturnType<typeof getAuthSessionState>>;
  baseUrl: string;
}): boolean {
  if (input.authState.state !== "valid") {
    return false;
  }
  if (!input.authState.session) {
    return true;
  }

  return resolveAuthRequestCompatibility({
    session: input.authState.session,
    requestUrl: input.baseUrl,
  }).compatible;
}

function resolvePreflightAuthCompatibility(input: {
  authState: Awaited<ReturnType<typeof getAuthSessionState>>;
  baseUrl: string;
}): boolean {
  if (input.authState.state !== "valid") {
    return false;
  }
  if (!input.authState.session) {
    return true;
  }

  return resolveAuthRequestCompatibility({
    session: input.authState.session,
    requestUrl: input.baseUrl,
  }).compatible;
}

function buildHumanPreflightAuthLabel(
  auth: SpacePreflightPayload["auth"]
): string {
  if (auth.ready) {
    return "signed in";
  }
  if (auth.state === "valid" && !auth.compatibleWithBaseUrl) {
    return `signed in to another OpenMeld environment (${auth.authBaseUrl ?? "unknown"}), not this gateway`;
  }
  return "not signed in";
}

function resolveSpacePreflightRepairGuidance(input: {
  command: SpaceCommandName;
  serviceParticipationReadiness: ServiceParticipationReadinessSummary;
}): SpacePreflightPayload["serviceRepairGuidance"] {
  if (
    resolveSpacePreflightActionRequirements(input.command).localService ===
    "not_required"
  ) {
    return null;
  }

  if (input.serviceParticipationReadiness.nextSteps.length === 0) {
    return null;
  }

  const nextSteps = input.serviceParticipationReadiness.nextSteps;
  if (
    nextSteps.length < 1 ||
    !input.serviceParticipationReadiness.nextStepSummary
  ) {
    return null;
  }

  return {
    reason: resolveSpacePreflightRepairReason(
      input.serviceParticipationReadiness
    ),
    summary: input.serviceParticipationReadiness.nextStepSummary,
    nextSteps,
  };
}

function resolveSpacePreflightRepairReason(
  serviceParticipationReadiness: ServiceParticipationReadinessSummary
): NonNullable<SpacePreflightPayload["serviceRepairGuidance"]>["reason"] {
  if (
    serviceParticipationReadiness.serviceReadinessState === "update_available"
  ) {
    return "service_update_available";
  }
  switch (serviceParticipationReadiness.serviceReadiness) {
    case "needs_repair":
      return "service_needs_repair";
    case "not_running":
      return "service_not_running";
    case "not_installed":
      return "service_not_installed";
    default:
      return "service_unknown";
  }
}

function toSpacePreflightAgentReplyReadiness(input: {
  command: SpaceCommandName;
  readiness: AgentReplyReadinessStatus | null;
}): SpacePreflightPayload["agentReplyReadiness"] {
  if (!shouldIncludeWakeReadinessInSpacePreflight(input.command)) {
    return null;
  }
  if (!input.readiness) {
    return null;
  }

  return {
    reasonCodes: input.readiness.reasonCodes,
    reasonText: input.readiness.reasonText,
    replyReadiness: input.readiness.replyReadiness,
  };
}

function shouldIncludeWakeReadinessInSpacePreflight(
  command: SpaceCommandName
): boolean {
  return command === "join";
}

function emitSpacePreflightRepairGuidance(input: {
  presenter: Presenter;
  command: SpaceCommandName;
  guidance: SpacePreflightPayload["serviceRepairGuidance"];
  mode?: HumanServiceGuidanceMode;
}): void {
  if (!input.guidance || input.mode === "suppress") {
    return;
  }

  input.presenter.line({
    code: `space.${input.command}.preflight.next_step`,
    text: `Next step: ${input.guidance.summary}`,
    data: {
      reason: input.guidance.reason,
      steps: input.guidance.nextSteps,
    },
  });
}

function shouldEmitSpaceCommandPreflightOutput(emitOutput?: boolean): boolean {
  return emitOutput !== false;
}

export function emitSpaceFailureNextStep(input: {
  presenter: Presenter;
  command: SpaceCommandName;
  error: unknown;
  profileId?: string | null;
  resolvedView?: "human" | "agent" | string;
}): void {
  const guidance = resolveSpaceFailureGuidance(input.error, {
    command: input.command,
    profileId: input.profileId,
    resolvedView: input.resolvedView,
  });
  if (!guidance) {
    return;
  }

  input.presenter.line({
    code: `space.${input.command}.next_step`,
    text: `Next step: ${guidance.summary}`,
    data: {
      reason: guidance.reason,
      steps: guidance.steps,
    },
  });
}

export function resolveSpaceFailureGuidance(
  error: unknown,
  options: {
    command?: SpaceCommandName;
    profileId?: string | null;
    resolvedView?: "human" | "agent" | string;
  } = {}
): SpaceFailureGuidance | null {
  const message = toErrorMessage(error);
  const lowered = message.toLowerCase();
  const localErrorCode = readErrorCode(error);
  const parsedHttpError = parseHttpFailure(error);
  const status = parsedHttpError?.status ?? null;
  const code = parsedHttpError?.code ?? "";
  const passwordRequiredByMessage = SPACE_PASSWORD_REQUIRED_RE.test(message);
  const passwordInvalidByMessage = SPACE_PASSWORD_INVALID_RE.test(message);
  const passwordTooShortByMessage =
    SPACE_PASSWORD_TOO_SHORT_RE.test(message) ||
    SPACE_PASSWORD_MIN_LENGTH_RE.test(message);
  const lockGuidance = resolveSpaceLockFailureGuidance(error, message);
  if (lockGuidance) {
    return lockGuidance;
  }

  if (code === "space.password_required" || passwordRequiredByMessage) {
    const whoamiCommand = formatSpaceFailureCliCommand(
      "openmeld whoami",
      options
    );
    const listSpacesCommand = formatSpaceFailureCliCommand(
      "openmeld space list",
      options
    );
    const joinWithPasswordCommand = formatSpaceFailureCliCommand(
      "openmeld space join <space-id> --password <value>",
      options
    );
    return {
      reason: "space_password_required",
      summary:
        "this OpenMeld account has not joined this protected Space yet; join once with the Space password or switch to a profile that has access.",
      steps: [whoamiCommand, listSpacesCommand, joinWithPasswordCommand],
    };
  }

  if (code === "space.password_invalid" || passwordInvalidByMessage) {
    const whoamiCommand = formatSpaceFailureCliCommand(
      "openmeld whoami",
      options
    );
    const listSpacesCommand = formatSpaceFailureCliCommand(
      "openmeld space list",
      options
    );
    const joinWithPasswordCommand = formatSpaceFailureCliCommand(
      "openmeld space join <space-id> --password <value>",
      options
    );
    return {
      reason: "space_password_invalid",
      summary:
        "the provided Space password is invalid; confirm it or ask a Space member to add this profile.",
      steps: [whoamiCommand, listSpacesCommand, joinWithPasswordCommand],
    };
  }

  if (code === "space.password_too_short" || passwordTooShortByMessage) {
    const listSpacesCommand = formatSpaceFailureCliCommand(
      "openmeld space list",
      options
    );
    const createWithPasswordCommand = formatSpaceFailureCliCommand(
      "openmeld space create --name <name> --visibility <public|private> --password <value>",
      options
    );
    const passwordUpdateCommand = formatSpaceFailureCliCommand(
      "openmeld space password <space-id> --password <new-password>",
      options
    );
    return {
      reason: "space_password_too_short",
      summary: "password must be at least 6 characters.",
      steps: [
        listSpacesCommand,
        createWithPasswordCommand,
        passwordUpdateCommand,
      ],
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    lowered.includes("auth.unauthenticated") ||
    lowered.includes("authentication required")
  ) {
    const authGuidance =
      resolveAuthenticationGuidanceFromError(error) ??
      resolveAuthenticationGuidance({
        reason: "required",
      });
    return {
      reason: "auth_required",
      summary: authGuidance.errorNextStep,
      steps: formatOpenMeldCliCommands([
        "openmeld login",
        "openmeld auth status --view agent",
      ]),
    };
  }

  if (
    isBindingStoreUnavailableFailure({
      localErrorCode,
      message,
      parsedHttpError,
    })
  ) {
    const repairCommand = formatOpenMeldCliCommand("openmeld doctor --repair");
    const migrateCommand = "pnpm db:migrate:dev";
    return {
      reason: "binding_store_unavailable",
      summary: `run \`${migrateCommand}\`, then \`${repairCommand}\`, then retry.`,
      steps: [migrateCommand, repairCommand],
    };
  }

  if (localErrorCode === "daemon.control.contract_mismatch") {
    const guidance = buildDaemonServiceRepairGuidance();
    return {
      reason: "daemon_control_contract_mismatch",
      summary: guidance.summary,
      steps: guidance.nextSteps,
    };
  }

  if (localErrorCode === "daemon.control.endpoint_missing") {
    const guidance = buildDaemonServiceRepairGuidance();
    return {
      reason: "daemon_control_endpoint_missing",
      summary: guidance.summary,
      steps: guidance.nextSteps,
    };
  }

  if (
    lowered.includes("network.timeout") ||
    lowered.includes("timed out") ||
    lowered.includes("upstream_unreachable") ||
    lowered.includes("gateway is unreachable") ||
    lowered.includes("can't reach the gateway")
  ) {
    return resolveGatewayUnavailableFailureGuidance({
      code,
      command: options.command,
      message,
      parsedHttpError,
      status,
    });
  }

  return null;
}

function resolveSpaceLockFailureGuidance(
  error: unknown,
  message: string
): SpaceFailureGuidance | null {
  if (!(isOpenMeldLockError(error) || SPACE_LOCKED_RE.test(message.trim()))) {
    return null;
  }
  const orphanedIssue = resolveOpenMeldOrphanedLockIssue(error);
  if (orphanedIssue) {
    return {
      reason: "space_join_locked",
      summary: orphanedIssue.summary,
      steps: orphanedIssue.primaryAction ? [orphanedIssue.primaryAction] : [],
    };
  }
  return {
    reason: "space_join_locked",
    summary: "This profile has already joined this space.",
    steps: [
      formatInlineOpenMeldCliCommands(
        "Stop the other terminal session running `openmeld space join`."
      ),
      formatOpenMeldCliCommand("openmeld space join <space-id>"),
      formatOpenMeldCliCommand("openmeld doctor --repair"),
    ],
  };
}

function formatSpaceFailureCliCommand(
  command: string,
  options: {
    profileId?: string | null;
    resolvedView?: "human" | "agent" | string;
  }
): string {
  if (options.profileId || options.resolvedView === "agent") {
    return formatProfileAwareOpenMeldCliCommand(command, {
      profileId: options.profileId,
      resolvedView: options.resolvedView,
    });
  }
  return formatOpenMeldCliCommand(command);
}

function resolveGatewayUnavailableFailureGuidance(input: {
  code: string;
  command?: SpaceCommandName;
  message: string;
  parsedHttpError: ReturnType<typeof parseHttpFailure>;
  status: number | null;
}): SpaceFailureGuidance {
  if (input.command === "send") {
    return {
      reason: "space_send_timeout_uncertain",
      summary:
        "the send request timed out before OpenMeld could confirm the result. Check recent text history before retrying so you do not duplicate a message.",
      steps: [
        formatOpenMeldCliCommand(
          "openmeld space history <space-id> --kind text --limit 20 --view agent"
        ),
      ],
    };
  }
  const failureKind = classifyGatewayChainFailure({
    code: input.code,
    message: resolveGatewayFailureMessage(input),
    status: input.status,
  });
  if (failureKind === "local_dev_session_missing") {
    const guidance = resolveGatewayChainRetryGuidance({
      failureKind,
      lane: resolveOpenMeldEnvPreset(),
    });
    return {
      reason: "local_dev_session_missing",
      summary: guidance.summary,
      steps: guidance.nextSteps,
    };
  }
  return {
    reason: "service_unavailable",
    summary:
      "OpenMeld Cloud service is temporarily unavailable. Try again after OpenMeld is reachable.",
    steps: [],
  };
}

function resolveGatewayFailureMessage(input: {
  message: string;
  parsedHttpError: ReturnType<typeof parseHttpFailure>;
}): string {
  return [input.parsedHttpError?.message ?? "", input.message]
    .filter((value) => value.length > 0)
    .join(" ");
}

function isBindingStoreUnavailableFailure(input: {
  message: string;
  localErrorCode: string;
  parsedHttpError: ReturnType<typeof parseHttpFailure>;
}): boolean {
  if (input.localErrorCode === LOCAL_AGENT_BINDING_LOOKUP_FAILED_CODE) {
    return true;
  }

  if (
    input.parsedHttpError?.upstreamCode ===
      LOCAL_AGENT_BINDING_LOOKUP_FAILED_CODE ||
    input.parsedHttpError?.code === LOCAL_AGENT_BINDING_LOOKUP_FAILED_CODE
  ) {
    return true;
  }

  const lowered = input.message.toLowerCase();
  return lowered.includes("openmeld_profiles unavailable");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function readErrorCode(error: unknown): string {
  let current: unknown = error;
  const visited = new Set<object>();

  while (current && typeof current === "object") {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);

    const record = current as {
      cause?: unknown;
      code?: unknown;
    };
    if (typeof record.code === "string") {
      return record.code;
    }
    current = record.cause;
  }

  return "";
}
