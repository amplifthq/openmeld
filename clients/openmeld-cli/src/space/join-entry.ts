import {
  buildCommandAuthenticationPromptMessage,
  ensureCommandAuthenticationOrCancel,
} from "../auth/command-auth";
import { resolveBaseUrl } from "../config/base-url";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { resolveLocalServiceDemand } from "../local-service/lifecycle/local-service-demand";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
} from "../runtime/cli-entry-command";
import { resolveRuntimeContext } from "../runtime/context";
import { createSpaceTargetGuideError } from "../runtime/dual-view-guide-catalog";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { formatMessage } from "../runtime/messages";
import { createPresenter } from "../runtime/presenter/index";
import { assessActionParticipationCandidate } from "../system/action-participation-planner";
import { runLocalParticipationOrchestrator } from "../system/local-participation-orchestrator";
import { resolveServiceParticipationReadiness } from "../system/service-participation-readiness";
import { emitSpaceAgentOverview } from "./agent-overview";
import {
  assertValidSpaceIdTarget,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import {
  SPACE_JOIN_LOCAL_READINESS_SPINNER_MESSAGE,
  SPACE_JOIN_SPACE_READINESS_SPINNER_MESSAGE,
  shouldShowSpaceJoinProgress,
  withSpaceJoinProgress,
} from "./join-progress";
import type { SpaceCommandNavigationStatus } from "./navigation-status";
import {
  emitResolvedSpaceCommandPreflight,
  emitSpaceCommandPreflight,
} from "./preflight";

export type SpaceJoinEntryTarget = {
  space: string;
  baseUrl?: string;
};

export type SpaceJoinTargetResolution =
  | {
      status: "submitted";
      value: SpaceJoinEntryTarget;
    }
  | {
      status: "cancelled" | "back" | "create";
      value: null;
    };

export type SpaceJoinEntryTargetOutcome =
  | {
      status: "submitted";
      target: SpaceJoinEntryTarget;
    }
  | {
      status: "completed" | "cancelled" | "back";
    };

export type PreparedSpaceJoinEntryContext = {
  status: "ready";
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  presenter: ReturnType<typeof createPresenter>;
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  localDemand: Awaited<ReturnType<typeof resolveLocalServiceDemand>> | null;
  authenticatedGatewayUrl: string | null;
  allowPromptForSpaceTarget: boolean;
  allowPromptForRoleContext: boolean;
  canPromptPreJoinActions: boolean;
  allowBackToTargetSelection: boolean;
  hasExplicitBaseUrlInput: boolean;
};

const LOCAL_SERVICE_ONLY_JOIN_BLOCK_REASON_CODES: ReadonlySet<string> = new Set(
  ["service.drifted", "service.not_installed", "service.not_running"] as const
);

const LOCAL_PARTICIPATION_ONLY_JOIN_BLOCK_REASON_CODES: ReadonlySet<string> =
  new Set([
    "service.not_installed",
    "service.drifted",
    "service.not_running",
    "dispatch.storage_not_ready",
    "service.gateway_chain_unhealthy",
    "profile.unbound",
    "controller.binding.disabled",
    "projection.missing",
    "controller.registry.disabled",
    "controller.launch.choice_required",
    "controller.launch.needs_repair",
    "workspace.missing",
    "workspace.invalid",
    "runtime.adapter.unsupported",
    "controller.bootstrap.failed",
    "controller.gateway.unhealthy",
    "route.offline",
    "route.not_registered",
  ] as const);

// Join entry owns the front door only: runtime/auth/preflight/target routing.
// It must stop before bootstrap, password retry, and connect handoff begin.
export async function prepareSpaceJoinEntryContext(input: {
  profile?: string;
  baseUrl?: string;
  space?: string;
  view?: string;
  allowPrompt?: boolean;
  output?: string;
  rawStream?: boolean;
  entryChecksHandled?: boolean;
}): Promise<PreparedSpaceJoinEntryContext | { status: "cancelled" }> {
  const runtime = await resolveRuntimeContext({
    profile: input.profile,
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  if (
    runtime.resolvedView === "agent" &&
    String(input.space ?? "").trim().length === 0
  ) {
    emitJoinEntryOverview({
      presenter,
      resolvedView: runtime.resolvedView,
      rawStream: input.rawStream,
    });
  }
  assertJoinEntryTargetGuard({
    space: input.space,
    resolvedView: runtime.resolvedView,
  });

  const resolvedBaseUrl = await resolveBaseUrl(input.baseUrl);
  const hasExplicitBaseUrlInput = String(input.baseUrl ?? "").trim().length > 0;
  const allowPrompt = input.allowPrompt ?? canUseInteractivePrompts(runtime);
  if (!input.entryChecksHandled) {
    const authReady = await ensureCommandAuthenticationOrCancel({
      runtime,
      ...(hasExplicitBaseUrlInput ? { gatewayUrl: resolvedBaseUrl } : {}),
      promptMessage: buildCommandAuthenticationPromptMessage("joining a space"),
      allowPrompt,
    });
    if (!authReady) {
      return {
        status: "cancelled",
      };
    }
  }

  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive: canUseInteractivePrompts(runtime),
  });

  const serviceState = await withSpaceJoinProgress({
    enabled: shouldShowSpaceJoinProgress({
      resolvedView: runtime.resolvedView,
      interactive: allowPrompt && canUseInteractivePrompts(runtime),
      output: input.output,
      rawStream: input.rawStream,
    }),
    message: SPACE_JOIN_LOCAL_READINESS_SPINNER_MESSAGE,
    run: async () =>
      await prepareSpaceJoinServiceState({
        openMeldProfile,
        interactiveHuman: isHumanInteractiveJoinRuntime(runtime),
        input: {
          baseUrl: input.baseUrl,
          resolvedBaseUrl,
          view: input.view,
        },
      }),
  });

  const allowPromptForSpaceTarget =
    input.allowPrompt ?? canUseInteractivePrompts(runtime);
  const allowPromptForRoleContext =
    input.allowPrompt ?? canUseInteractivePrompts(runtime);
  const canPromptPreJoinActions =
    allowPromptForSpaceTarget && runtime.resolvedView === "human";
  const allowBackToTargetSelection =
    canPromptPreJoinActions && String(input.space ?? "").trim().length === 0;

  return {
    status: "ready",
    runtime,
    presenter,
    openMeldProfile,
    baseUrl: serviceState.baseUrl,
    localDemand: serviceState.localDemand,
    authenticatedGatewayUrl: hasExplicitBaseUrlInput ? resolvedBaseUrl : null,
    allowPromptForSpaceTarget,
    allowPromptForRoleContext,
    canPromptPreJoinActions,
    allowBackToTargetSelection,
    hasExplicitBaseUrlInput: serviceState.hasExplicitBaseUrlInput,
  };
}

function emitJoinEntryOverview(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  rawStream?: boolean;
}): void {
  if (input.rawStream === true) {
    return;
  }
  emitSpaceAgentOverview({
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    command: "join",
  });
}

function assertJoinEntryTargetGuard(input: {
  space?: string;
  resolvedView: "human" | "agent";
}): void {
  const explicitSpace = String(input.space ?? "").trim();
  if (input.resolvedView === "agent" && explicitSpace.length === 0) {
    throw createSpaceTargetGuideError("join");
  }
  if (!explicitSpace) {
    return;
  }
  assertValidSpaceIdTarget({
    space: explicitSpace,
    resolvedView: input.resolvedView,
  });
}

function isHumanInteractiveJoinRuntime(
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>
): boolean {
  return runtime.resolvedView === "human" && canUseInteractivePrompts(runtime);
}

export async function resolveSpaceJoinEntryTargetOutcome(input: {
  resolveTarget: () => Promise<SpaceJoinTargetResolution>;
  runCreate: () => Promise<SpaceCommandNavigationStatus>;
}): Promise<SpaceJoinEntryTargetOutcome> {
  const targetResult = await input.resolveTarget();
  if (targetResult.status === "submitted") {
    return {
      status: "submitted",
      target: targetResult.value,
    };
  }
  if (targetResult.status === "cancelled") {
    return {
      status: "cancelled",
    };
  }
  if (targetResult.status === "back") {
    return {
      status: "back",
    };
  }

  const createResult = await input.runCreate();
  if (createResult === "cancelled") {
    return {
      status: "cancelled",
    };
  }
  if (createResult === "back") {
    return {
      status: "back",
    };
  }
  return {
    status: "completed",
  };
}

async function prepareSpaceJoinServiceState(input: {
  openMeldProfile: OpenMeldProfile;
  interactiveHuman: boolean;
  input: {
    baseUrl?: string;
    resolvedBaseUrl?: string;
    view?: string;
  };
}): Promise<{
  localDemand: Awaited<ReturnType<typeof resolveLocalServiceDemand>> | null;
  baseUrl: string;
  hasExplicitBaseUrlInput: boolean;
}> {
  const localDemand = input.interactiveHuman
    ? await resolveLocalServiceDemand({
        ownerUserId: input.openMeldProfile.ownerUserId,
      }).catch(() => null)
    : null;
  const hasExplicitBaseUrlInput =
    String(input.input.baseUrl ?? "").trim().length > 0;
  const baseUrl =
    input.input.resolvedBaseUrl ?? (await resolveBaseUrl(input.input.baseUrl));
  return {
    baseUrl,
    hasExplicitBaseUrlInput,
    localDemand,
  };
}

export async function assertSpaceJoinTargetPreflightReady(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  allowPrompt?: boolean;
  localDemand?: Awaited<ReturnType<typeof resolveLocalServiceDemand>> | null;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  serviceIntent?: "space_join" | "space_create_join";
  showProgress?: boolean;
  view?: string;
}): Promise<"continue" | "cancelled"> {
  const explicitLocalAgentProfile =
    input.openMeldProfile.profileKind === "agent";
  const serviceIntent = input.serviceIntent ?? "space_join";
  let preflight = await runSpaceJoinPreflightWithProgress({
    ...input,
    emitOutput: false,
    runtimeProjection: input.localDemand?.projection ?? undefined,
  });
  let assessment = resolveSpaceJoinParticipationAssessment({
    openMeldProfile: input.openMeldProfile,
    preflight,
  });

  const orchestratorResult = await runLocalParticipationOrchestrator({
    intent: serviceIntent,
    plan: {
      intent: serviceIntent,
      assessments: [assessment],
      shouldOfferServiceGate:
        assessment.localParticipationState === "needs_openmeld_service",
      hasAgentPreparationWork:
        assessment.localParticipationState === "needs_agent_prepare",
      hasReadyLocalAgentParticipation:
        assessment.localParticipationState === "ready",
      explicitLocalAgentCount: explicitLocalAgentProfile ? 1 : 0,
    },
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    allowPrompt: input.allowPrompt ?? true,
    gatewayUrl: input.baseUrl,
    localDemand: input.localDemand,
    forceServicePrompt: explicitLocalAgentProfile,
    profilesToPrepare: explicitLocalAgentProfile ? [input.openMeldProfile] : [],
    view: input.view,
  });
  if (orchestratorResult.status === "cancelled") {
    return "cancelled";
  }
  if (orchestratorResult.status === "recheck_required") {
    preflight = await runSpaceJoinPreflightWithProgress({
      ...input,
      emitOutput: false,
    });
    assessment = resolveSpaceJoinParticipationAssessment({
      openMeldProfile: input.openMeldProfile,
      preflight,
    });
  }
  emitResolvedSpaceCommandPreflight({
    presenter: input.presenter,
    command: "join",
    resolvedView: input.resolvedView,
    humanServiceGuidanceMode: "suppress",
    preflight,
  });
  assessment = resolveSpaceJoinParticipationAssessment({
    openMeldProfile: input.openMeldProfile,
    preflight,
  });

  const blockedJoinResult = handleBlockedSpaceJoinLocalParticipation({
    openMeldProfile: input.openMeldProfile,
    explicitLocalAgentProfile,
    preflight,
    presenter: input.presenter,
    assessmentState: assessment.localParticipationState,
  });
  if (blockedJoinResult) {
    return blockedJoinResult;
  }
  if (preflight.deviceReplyReadiness.replyReadiness === "blocked") {
    throw new Error(preflight.deviceReplyReadiness.reasonText);
  }
  return "continue";
}

async function runSpaceJoinPreflight(input: {
  openMeldProfile: OpenMeldProfile;
  allowPrompt?: boolean;
  baseUrl: string;
  emitOutput: boolean;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  runtimeProjection?: Awaited<
    ReturnType<typeof resolveLocalServiceDemand>
  >["projection"];
}) {
  return await emitSpaceCommandPreflight({
    presenter: input.presenter,
    command: "join",
    profile: input.openMeldProfile,
    baseUrl: input.baseUrl,
    resolvedView: input.resolvedView,
    humanServiceGuidanceMode: "suppress",
    emitOutput: input.emitOutput,
    runtimeProjection: input.runtimeProjection,
  });
}

async function runSpaceJoinPreflightWithProgress(input: {
  openMeldProfile: OpenMeldProfile;
  allowPrompt?: boolean;
  baseUrl: string;
  emitOutput: boolean;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  runtimeProjection?: Awaited<
    ReturnType<typeof resolveLocalServiceDemand>
  >["projection"];
  showProgress?: boolean;
}) {
  return await withSpaceJoinProgress({
    enabled: input.showProgress === true,
    message: SPACE_JOIN_SPACE_READINESS_SPINNER_MESSAGE,
    run: async () => await runSpaceJoinPreflight(input),
  });
}

function resolveSpaceJoinParticipationAssessment(input: {
  openMeldProfile: OpenMeldProfile;
  preflight: Awaited<ReturnType<typeof emitSpaceCommandPreflight>>;
}) {
  const serviceParticipationReadiness =
    input.preflight.serviceParticipationReadiness ??
    resolveServiceParticipationReadiness({
      deviceReplyReadiness: input.preflight.deviceReplyReadiness,
    });
  return assessActionParticipationCandidate({
    profileId: input.openMeldProfile.openMeldProfileId,
    profileName: input.openMeldProfile.profileName,
    profileKind:
      input.openMeldProfile.profileKind === "agent" ? "agent" : "human",
    localParticipationReadiness: serviceParticipationReadiness.serviceReadiness,
    localParticipationReasonCodes: [
      ...input.preflight.deviceReplyReadiness.reasonCodes,
    ],
  });
}

function handleBlockedSpaceJoinLocalParticipation(input: {
  openMeldProfile: OpenMeldProfile;
  explicitLocalAgentProfile: boolean;
  preflight: Awaited<ReturnType<typeof emitSpaceCommandPreflight>>;
  presenter: ReturnType<typeof createPresenter>;
  assessmentState: ReturnType<
    typeof resolveSpaceJoinParticipationAssessment
  >["localParticipationState"];
}): "continue" | null {
  if (
    input.preflight.deviceReplyReadiness.replyReadiness !== "blocked" ||
    !isBlockingLocalParticipationJoinAttention(input.preflight)
  ) {
    return null;
  }
  if (input.explicitLocalAgentProfile) {
    input.presenter.line({
      code: "space.join.local_participation.pending",
      text: buildSpaceJoinMembershipOnlyMessage({
        openMeldProfile: input.openMeldProfile,
        reasonCodes: input.preflight.deviceReplyReadiness.reasonCodes,
      }),
    });
    return "continue";
  }
  if (input.assessmentState === "not_needed") {
    input.presenter.line({
      code: "space.join.service.not_needed",
      text: formatInlineOpenMeldCliCommands(
        "OpenMeld will join this space. Local agent participation on this device can be checked later with `openmeld service status`."
      ),
    });
    return "continue";
  }
  input.presenter.line({
    code: "space.join.service.pending",
    text: formatInlineOpenMeldCliCommands(
      "OpenMeld will join this space. Local agent participation on this device can be checked separately with `openmeld service status`."
    ),
  });
  return "continue";
}

function isBlockingLocalParticipationJoinAttention(
  preflight: Awaited<ReturnType<typeof emitSpaceCommandPreflight>>
): boolean {
  const { deviceReplyReadiness } = preflight;
  return (
    deviceReplyReadiness.replyReadiness === "blocked" &&
    deviceReplyReadiness.reasonCodes.length > 0 &&
    deviceReplyReadiness.reasonCodes.every((reasonCode) =>
      LOCAL_PARTICIPATION_ONLY_JOIN_BLOCK_REASON_CODES.has(reasonCode)
    )
  );
}

function buildSpaceJoinMembershipOnlyMessage(input: {
  openMeldProfile: OpenMeldProfile;
  reasonCodes: readonly string[];
}): string {
  const profileName = input.openMeldProfile.profileName;
  const profileId = input.openMeldProfile.openMeldProfileId;
  const reasonCodes = input.reasonCodes;
  const statusCommand = formatOpenMeldCliCommand(
    `openmeld service status --profile ${profileId}`
  );

  if (reasonCodes.includes("profile.unbound")) {
    return `${profileName} will join this space. Choose its local agent in OpenMeld Web when you want it to handle work from this device.`;
  }

  if (
    reasonCodes.some((reasonCode) =>
      LOCAL_SERVICE_ONLY_JOIN_BLOCK_REASON_CODES.has(reasonCode)
    ) ||
    reasonCodes.includes("dispatch.storage_not_ready") ||
    reasonCodes.includes("service.gateway_chain_unhealthy") ||
    reasonCodes.includes("route.offline") ||
    reasonCodes.includes("route.not_registered")
  ) {
    return formatInlineOpenMeldCliCommands(
      `${profileName} will join this space. OpenMeld has not confirmed its local reply path on this device yet. Use \`${statusCommand}\` to check this device.`
    );
  }

  if (
    reasonCodes.includes("controller.launch.needs_repair") ||
    reasonCodes.includes("controller.launch.choice_required") ||
    reasonCodes.includes("workspace.missing") ||
    reasonCodes.includes("workspace.invalid")
  ) {
    return formatInlineOpenMeldCliCommands(
      `${profileName} will join this space, but its local agent setup on this device needs attention. Use \`openmeld agents list\` to find the local agent, then run \`openmeld agents repair --agent <agent-id>\`.`
    );
  }

  return `${profileName} will join this space. Check Local Agents in OpenMeld Web when you want it to handle work from this device.`;
}

export function buildJoinTargetMissingMessage(input: {
  resolvedView: "human" | "agent";
}): string {
  return formatMessage(input.resolvedView, "space.target.missing", {
    command: "join",
  });
}
