import { cancel, isCancel, select } from "@clack/prompts";
import type {
  AgentExecutionRouteEvidence,
  AgentExecutionStatusProjection,
} from "@openmeld/agent-runtime";
import {
  createAgentProfileBindingApi,
  type GetAgentProfilePrimaryBindingInput,
} from "@openmeld/api-client";
import {
  observabilityWakeTraceSelectorSchema,
  projectObservabilityWakeCorrelation,
  projectSpaceDispatchTraceFinalVisibleOutcome,
  resolveSpaceDispatchTraceRootCause,
} from "@openmeld/schemas";
import type {
  GetAgentProfilePrimaryBindingResponse,
  GetSpaceDispatchLookupResponse,
  ObservabilityWakeCorrelation,
  ObservabilityWakeTraceSelector,
  SpaceDispatchTraceFinalVisibleOutcome,
  SpaceDispatchTraceOpsDecision,
  SpaceDispatchTraceResponse,
} from "@openmeld/schemas/types";
import { resolveBaseUrl } from "../config/base-url";
import {
  type OpenMeldProfile,
  resolveOpenMeldProfile,
} from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import {
  requireOpenMeldProfile,
  resolveOpenMeldProfileOrNull,
} from "../config/resolve-openmeld-profile";
import { fetchSpaceDispatchLookup } from "../config/space-dispatch-lookup-api";
import { fetchSpaceDispatchTrace } from "../config/space-dispatch-trace-api";
import {
  type DaemonDispatchJournalEvent,
  readRecentDaemonDispatchJournalEvents,
} from "../local-service/dispatch/daemon-dispatch-journal";
import { formatDaemonRouteObservationLabel } from "../local-service/status/daemon-route-observation-presentation";
import { promptForOpenMeldProfileSelection } from "../profile/profile-selection-prompt";
import {
  buildProfileWorkspacePresentation,
  buildProfileWorkspaceRows,
  type ProfileWorkspacePresentation,
} from "../profile-workspace/presentation";
import { resolveOpenClawLocalDiagnosticsValue } from "../provider-hosts/openclaw/diagnostics";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import { resolveRuntimeContext } from "../runtime/context";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { createPresenter } from "../runtime/presenter/index";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import type { CurrentReplyReadinessSnapshot } from "../system/current-reply-readiness-snapshot";
import { resolveCurrentReplyReadinessSnapshot } from "../system/current-reply-readiness-snapshot";
import { resolvePrepareReadinessApiEvidence } from "../system/prepare-readiness-api-evidence";
import {
  type AgentReplyReadinessStatus,
  type DeviceReplyReadinessStatus,
  formatAgentReplyReadinessLabel,
  formatDeviceReplyReadinessLabel,
  formatHumanReplyReadinessReason,
} from "../system/reply-readiness";
import {
  buildReplyReadinessGuidance,
  type ReplyReadinessGuidance,
} from "../system/reply-readiness-guidance";
import { renderInfoCard } from "../ui/info-card";
import {
  buildServiceTraceAgentExecutionStatus,
  buildServiceTraceEvidenceSyncHealth,
  buildServiceTraceLocalExecutionDiagnosticRows,
  type ServiceTraceAgentExecutionStatusInput,
} from "./service-trace-agent-execution-status";

type ServiceTraceDependencies = {
  fetchLookup?: typeof fetchSpaceDispatchLookup;
  fetchPrimaryBinding?: (
    input: GetAgentProfilePrimaryBindingInput
  ) => Promise<GetAgentProfilePrimaryBindingResponse>;
  fetchTrace?: typeof fetchSpaceDispatchTrace;
  resolveProfile?: typeof resolveOpenMeldProfileOrNull;
  resolvePrepareReadinessEvidence?: typeof resolvePrepareReadinessApiEvidence;
  requireProfile?: typeof requireOpenMeldProfile;
};
type DispatchTraceSnapshot = SpaceDispatchTraceResponse["trace"];
type RuntimeCoordinatorTraceEvent =
  NonNullable<DispatchTraceSnapshot>["runtimeCoordinatorEvents"][number];
type ServiceTraceActorProfile = Awaited<
  ReturnType<typeof requireOpenMeldProfile>
>;
type ServiceTracePrimaryBindingEvidence =
  | GetAgentProfilePrimaryBindingResponse
  | {
      reasonCodes: readonly string[];
      status: "unavailable";
    };
type ServiceTraceDaemonDispatchJournalEvidence = {
  factSource: "daemon_dispatch_journal";
  events: DaemonDispatchJournalEvent[];
  eventCount: number;
};
type ServiceTraceLookupReasonCode =
  | "wake_trace.dispatch_not_found"
  | "wake_trace.multiple_dispatches"
  | "wake_trace.source_signal_not_found";
type ServiceTraceLookupDiagnostic = {
  correlation: ObservabilityWakeCorrelation | null;
  reasonCode: ServiceTraceLookupReasonCode;
  selector: ObservabilityWakeTraceSelector | null;
};
type ServiceTraceAgentWaitingBoundary = Pick<
  NonNullable<
    Extract<
      NonNullable<DispatchTraceSnapshot>["runtimeCoordinatorHeadLifecycle"],
      { readStatus: "found" }
    >["waitingBoundary"]
  >,
  | "deadlineAt"
  | "softDeadlineAt"
  | "userRecoveryAction"
  | "waitingFor"
  | "waitingSince"
>;
type ServiceTraceAgentSummary = {
  currentState: string;
  delivered: boolean;
  nextAction: string;
  reasonCode: string | null;
  visibleOutcome: string;
  controllerNormalizationStatus?: string;
  deliveryDestination?: string;
  runtimeFamily?: "hosted_center_agent";
  waitingBoundary?: ServiceTraceAgentWaitingBoundary;
};
const WAITING_BOUNDARY_NEXT_ACTION: Record<
  ServiceTraceAgentWaitingBoundary["userRecoveryAction"],
  string
> = {
  check_status: "check status, then rerun trace with the same selector",
  start_or_restart_openmeld_service:
    "start or restart OpenMeld Service, then rerun trace with the same selector",
  wait_for_wake_route_report:
    "wait for the Wake route report, then rerun trace with the same selector",
};
type ServiceTracePresenter = ReturnType<typeof createPresenter>;
const SERVICE_TRACE_USE_CURRENT_PROFILE = "continue";
const SERVICE_TRACE_CHOOSE_ANOTHER_PROFILE = "choose_another";
const SERVICE_TRACE_CANCEL = "cancel";
const WAKE_TRACE_DIAGNOSTICS_TITLE = "🧭 Wake Trace Diagnostics";

export async function runServiceTrace(
  input: {
    profile?: string;
    baseUrl?: string;
    clientMessageId?: string;
    space: string;
    dispatchId?: string;
    details?: boolean;
    sourceSignalId?: string;
    targetProfileId?: string;
    password?: string;
    view?: string;
  },
  deps: ServiceTraceDependencies = {}
): Promise<void> {
  const runtime = await resolveRuntimeContext({
    profile: input.profile,
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  const initialActingProfile = await (
    deps.requireProfile ?? requireOpenMeldProfile
  )({
    openMeldProfileId: input.profile,
    persistSelection: false,
    authAction: "reading a dispatch trace",
  });
  const actingProfile = await resolveServiceTraceActorProfile({
    explicitProfileId: input.profile,
    runtime,
    actingProfile: initialActingProfile,
  });
  if (!actingProfile) {
    return;
  }
  const baseUrl = await resolveBaseUrl(input.baseUrl);
  const resolvedSpaceId = input.space.trim();
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile: actingProfile,
  });
  const selection = await resolveDispatchTraceSelection({
    actorProfile: actingProfile,
    requestContext,
    baseUrl,
    deps,
    dispatchId: input.dispatchId,
    clientMessageId: input.clientMessageId,
    password: input.password,
    presenter,
    runtimeView: runtime.resolvedView,
    sourceSignalId: input.sourceSignalId,
    spaceId: resolvedSpaceId,
    targetProfileId: input.targetProfileId,
  });
  if (!selection) {
    return;
  }
  const traceResponse = await (deps.fetchTrace ?? fetchSpaceDispatchTrace)({
    requestContext,
    baseUrl,
    space: resolvedSpaceId,
    dispatchId: selection.dispatchId,
    ...(input.details === true
      ? { includeRemoteAgentRuntimeDiagnostics: true }
      : {}),
    password: input.password,
  });
  const targetContext = await resolveTraceTargetContext({
    baseUrl,
    resolveProfile: deps.resolveProfile ?? resolveOpenMeldProfileOrNull,
    trace: traceResponse.trace,
  });
  const agentExecutionStatus = await resolveTraceAgentExecutionStatus({
    baseUrl,
    correlation: traceResponse.correlation,
    currentDaemonRouteObservation:
      targetContext.currentReplyReadiness?.daemonRouteObservation ?? null,
    deps,
    requestContext,
    targetProfile: targetContext.targetProfile,
    trace: traceResponse.trace,
  });
  const evidenceSyncHealth = agentExecutionStatus
    ? buildServiceTraceEvidenceSyncHealth({
        projection: agentExecutionStatus,
      })
    : null;
  const daemonDispatchJournal = resolveDaemonDispatchJournalEvidence(
    selection.dispatchId
  );
  const agentSummary = buildAgentTraceCompactSummary({
    trace: traceResponse.trace,
  });
  const traceReadinessGuidance = shouldExposeCurrentReadinessGuidance(
    traceResponse.trace
  )
    ? targetContext.guidance
    : null;

  const payload = {
    correlation: traceResponse.correlation,
    query: traceResponse.query,
    remoteAgentRuntimeDiagnostics:
      traceResponse.remoteAgentRuntimeDiagnostics ?? null,
    selector: selection.selector,
    lookup: selection.lookup,
    actorProfile: {
      profileId: actingProfile.openMeldProfileId,
      profileName: actingProfile.profileName,
      profileKind: actingProfile.profileKind,
    },
    trace: traceResponse.trace,
    daemonDispatchJournal,
    agentExecutionStatus,
    evidenceSyncHealth,
    targetProfile:
      targetContext.targetProfile === null
        ? null
        : {
            profileId: targetContext.targetProfile.openMeldProfileId,
            profileName: targetContext.targetProfile.profileName,
            profileKind: targetContext.targetProfile.profileKind,
          },
    currentReplyReadiness:
      targetContext.currentReplyReadiness === null
        ? null
        : {
            daemonRouteObservation:
              targetContext.currentReplyReadiness.daemonRouteObservation,
            observedAt: targetContext.currentReplyReadiness.observedAt,
            deviceReplyReadiness:
              targetContext.currentReplyReadiness.deviceReplyReadiness,
            agentReplyReadiness: targetContext.currentAgentReplyReadiness,
          },
    currentProfileWorkspace: targetContext.currentProfileWorkspace,
    agentSummary,
    guidance: traceReadinessGuidance,
  };

  if (runtime.resolvedView === "agent") {
    if (input.details === true) {
      presenter.data({
        code: "service.trace.result",
        payload,
      });
    }
    presenter.line({
      code: "service.trace.summary",
      text: formatAgentTraceCompactSummary(agentSummary),
      data: {
        correlation: payload.correlation,
        query: payload.query,
        selector: payload.selector,
        targetProfile: payload.targetProfile,
        projectFailureContext:
          traceResponse.trace?.resultInbox?.projectFailureContext ?? null,
        agentSummary,
        diagnosticSummary: buildAgentTraceSummary({
          dispatchId: traceResponse.query.dispatchId,
          trace: traceResponse.trace,
        }),
      },
    });
    return;
  }

  renderInfoCard({
    presenter,
    title: WAKE_TRACE_DIAGNOSTICS_TITLE,
    codePrefix: "service.trace.card",
    sanitize: true,
    rows: buildHumanTraceRows({
      actorProfile: actingProfile,
      correlation: traceResponse.correlation,
      selector: selection.selector,
      spaceId: traceResponse.query.spaceId,
      dispatchId: traceResponse.query.dispatchId,
      lookup: selection.lookup,
      trace: traceResponse.trace,
      targetProfile: targetContext.targetProfile,
      currentAgentReplyReadiness: targetContext.currentAgentReplyReadiness,
      currentDeviceReplyReadiness:
        targetContext.currentReplyReadiness?.deviceReplyReadiness ?? null,
      currentDaemonRouteObservation:
        targetContext.currentReplyReadiness?.daemonRouteObservation ?? null,
      currentProfileWorkspace: targetContext.currentProfileWorkspace,
      guidance: traceReadinessGuidance,
      agentExecutionStatus,
      daemonDispatchJournal,
    }),
  });
}

async function resolveTraceAgentExecutionStatus(input: {
  baseUrl: string;
  correlation: SpaceDispatchTraceResponse["correlation"];
  currentDaemonRouteObservation:
    | CurrentReplyReadinessSnapshot["daemonRouteObservation"]
    | null;
  deps: ServiceTraceDependencies;
  requestContext: ReturnType<typeof buildOpenMeldRequestContextFromProfile>;
  targetProfile: OpenMeldProfile | null;
  trace: DispatchTraceSnapshot;
}): Promise<AgentExecutionStatusProjection | null> {
  if (input.targetProfile?.profileKind !== "agent") {
    return null;
  }
  const [bindingResponse, prepareReadiness] = await Promise.all([
    resolveTracePrimaryBinding({
      agentProfileId: input.targetProfile.openMeldProfileId,
      baseUrl: input.baseUrl,
      deps: input.deps,
      requestContext: input.requestContext,
    }),
    (
      input.deps.resolvePrepareReadinessEvidence ??
      resolvePrepareReadinessApiEvidence
    )({
      baseUrl: input.baseUrl,
      profile: input.targetProfile,
    }).catch(() => ({
      nonRunnableCapabilityCount: 0,
      reason: "read_failed" as const,
      reasonCodes: ["prepare_readiness.read_failed"],
      runnableCapabilityCount: 0,
      source: "prepare_readiness_api" as const,
      status: "unavailable" as const,
    })),
  ]);

  return buildServiceTraceAgentExecutionStatus({
    agentProfileId: input.targetProfile.openMeldProfileId,
    binding: normalizeTracePrimaryBindingForExecutionStatus(bindingResponse),
    executionAuthorityDiagnostics:
      resolveTraceExecutionAuthorityDiagnosticsForExecutionStatus({
        correlation: input.correlation,
        trace: input.trace,
      }),
    prepareReadiness,
    route: buildTraceAgentExecutionRouteEvidence(
      input.currentDaemonRouteObservation
    ),
    runtimeCoordinatorCreationReasonCode:
      resolveLatestRuntimeCoordinatorCreationReasonCode(input.trace),
    runtimeCoordinatorExecutionId:
      input.trace?.runtimeCoordinatorExecution?.runtimeCoordinatorExecutionId ??
      input.correlation.runtimeCoordinatorExecutionId,
  });
}

function resolveLatestRuntimeCoordinatorCreationReasonCode(
  trace: DispatchTraceSnapshot
): string | null {
  if (
    !trace ||
    trace.runtimeCoordinatorExecution ||
    trace.runtimeCoordinatorHeadLifecycle?.readStatus === "found" ||
    trace.runtimeCoordinatorHeadLifecycle?.readStatus ===
      "authority_unavailable" ||
    trace.runtimeCoordinatorCreationDiagnostics.length === 0
  ) {
    return null;
  }
  return trace.runtimeCoordinatorCreationDiagnostics.at(-1)?.reasonCode ?? null;
}

function resolveTraceExecutionAuthorityDiagnosticsForExecutionStatus(input: {
  correlation: SpaceDispatchTraceResponse["correlation"];
  trace: DispatchTraceSnapshot;
}): ServiceTraceAgentExecutionStatusInput["executionAuthorityDiagnostics"] {
  if (
    input.trace?.runtimeCoordinatorExecution ||
    input.correlation.runtimeCoordinatorExecutionId
  ) {
    return {
      reasonCodes: [
        resolveRuntimeCoordinatorExecutionAuthorityDiagnosticReason(
          input.trace
        ),
      ],
      status: "accepted",
    };
  }
  const headLifecycleExecutionAuthorityReason =
    resolveRuntimeCoordinatorHeadLifecycleExecutionAuthorityDiagnosticReason(
      input.trace
    );
  if (headLifecycleExecutionAuthorityReason) {
    return {
      reasonCodes: [headLifecycleExecutionAuthorityReason],
      status:
        headLifecycleExecutionAuthorityReason ===
        "local_service.identity_mismatch"
          ? "mismatch"
          : "unavailable",
    };
  }
  if (
    input.trace?.runtimeCoordinatorHeadLifecycle?.readStatus ===
    "authority_unavailable"
  ) {
    return {
      reasonCodes: [input.trace.runtimeCoordinatorHeadLifecycle.reasonCode],
      status: "unavailable",
    };
  }
  return null;
}

function resolveRuntimeCoordinatorHeadLifecycleExecutionAuthorityDiagnosticReason(
  trace: DispatchTraceSnapshot
): string | null {
  const headLifecycle = trace?.runtimeCoordinatorHeadLifecycle;
  if (
    !trace ||
    headLifecycle?.readStatus !== "found" ||
    trace.runtimeCoordinatorExecution ||
    headLifecycle.runtimeCoordinatorExecutionId
  ) {
    return null;
  }
  return (
    resolvePreExecutionNoExecutionEvidenceRootCause(trace) ??
    headLifecycle.waitingBoundary?.reasonCode ??
    resolveRuntimeCoordinatorHeadStatusRootCause(headLifecycle.status)
  );
}

function resolveRuntimeCoordinatorExecutionAuthorityDiagnosticReason(
  trace: DispatchTraceSnapshot
): string {
  return trace?.runtimeCoordinatorHeadLifecycle?.readStatus === "found"
    ? "runtime_coordinator.head_lifecycle_authority_present"
    : "runtime_coordinator.execution_authority_present";
}

function normalizeTracePrimaryBindingForExecutionStatus(
  response: ServiceTracePrimaryBindingEvidence
): ServiceTraceAgentExecutionStatusInput["binding"] {
  if (response.status !== "unavailable") {
    return response.binding;
  }
  if ("binding" in response) {
    return {
      reasonCodes: response.binding.reasonCodes,
      status: "unavailable",
    };
  }
  return response;
}

function buildTraceAgentExecutionRouteEvidence(
  observation: CurrentReplyReadinessSnapshot["daemonRouteObservation"] | null
): AgentExecutionRouteEvidence | null {
  if (!observation) {
    return null;
  }

  if (observation.status === "online") {
    return {
      deviceId: resolveTraceRouteDeviceId(observation.route),
      observedAt: observation.observedAt,
      status: "online",
    };
  }

  if (observation.status === "offline") {
    return {
      deviceId: resolveTraceRouteDeviceId(observation.route),
      observedAt: observation.observedAt,
      reasonCodes: [
        "agent_execution.route_offline",
        `daemon_route.${observation.reasonCode}`,
      ],
      status: "offline",
    };
  }

  return {
    deviceId: null,
    observedAt: observation.observedAt,
    reasonCodes: [
      "agent_execution.route_unavailable",
      `daemon_route.${observation.reasonCode}`,
    ],
    status: "unavailable",
  };
}

function resolveTraceRouteDeviceId(
  route: CurrentReplyReadinessSnapshot["daemonRouteObservation"]["route"]
): string | null {
  if (route && "deviceId" in route) {
    return route.deviceId;
  }
  return null;
}

async function resolveTracePrimaryBinding(input: {
  agentProfileId: string;
  baseUrl: string;
  deps: ServiceTraceDependencies;
  requestContext: ReturnType<typeof buildOpenMeldRequestContextFromProfile>;
}): Promise<ServiceTracePrimaryBindingEvidence> {
  try {
    const fetchPrimaryBinding =
      input.deps.fetchPrimaryBinding ??
      createAgentProfileBindingApi(createCliApiClientFoundation(input.baseUrl))
        .getPrimaryBinding;
    return await fetchPrimaryBinding({
      agentProfileId: input.agentProfileId,
      requestContext: input.requestContext,
    });
  } catch {
    return {
      reasonCodes: ["agent_profile_binding.read_unavailable"],
      status: "unavailable",
    };
  }
}

function resolveDaemonDispatchJournalEvidence(
  dispatchId: string
): ServiceTraceDaemonDispatchJournalEvidence {
  const events = readRecentDaemonDispatchJournalEvents({
    dispatchId,
    limit: 20,
  });
  return {
    factSource: "daemon_dispatch_journal",
    events,
    eventCount: events.length,
  };
}

async function resolveDispatchTraceSelection(input: {
  actorProfile: ServiceTraceActorProfile;
  requestContext: ReturnType<typeof buildOpenMeldRequestContextFromProfile>;
  baseUrl: string;
  clientMessageId?: string;
  deps: ServiceTraceDependencies;
  dispatchId?: string;
  password?: string;
  presenter: ServiceTracePresenter;
  runtimeView: "human" | "agent";
  sourceSignalId?: string;
  spaceId: string;
  targetProfileId?: string;
}): Promise<{
  dispatchId: string;
  lookup: GetSpaceDispatchLookupResponse | null;
  selector: ObservabilityWakeTraceSelector;
} | null> {
  const dispatchSelector = normalizeOptionalString(input.dispatchId);
  const sourceSignalSelector = normalizeOptionalString(input.sourceSignalId);
  const clientMessageSelector = normalizeOptionalString(input.clientMessageId);
  const targetProfileSelector = normalizeOptionalString(input.targetProfileId);
  const selectorCount =
    Number(dispatchSelector !== null) +
    Number(sourceSignalSelector !== null) +
    Number(clientMessageSelector !== null);
  if (selectorCount !== 1) {
    throw new Error(
      "exactly one of dispatchId, sourceSignalId, or clientMessageId is required"
    );
  }
  if (dispatchSelector) {
    return {
      dispatchId: dispatchSelector,
      lookup: null,
      selector: parseServiceTraceSelector({
        dispatchId: dispatchSelector,
        kind: "dispatch",
        spaceId: input.spaceId,
      }),
    };
  }
  if (!(sourceSignalSelector || clientMessageSelector)) {
    throw new Error("lookup selector could not be resolved");
  }

  const lookup = await (input.deps.fetchLookup ?? fetchSpaceDispatchLookup)({
    requestContext: input.requestContext,
    baseUrl: input.baseUrl,
    space: input.spaceId,
    ...(sourceSignalSelector ? { sourceSignalId: sourceSignalSelector } : {}),
    ...(clientMessageSelector
      ? { clientMessageId: clientMessageSelector }
      : {}),
    ...(targetProfileSelector
      ? { targetProfileId: targetProfileSelector }
      : {}),
    password: input.password,
  });
  if (lookup.matches.length === 0) {
    renderLookupNotFound({
      presenter: input.presenter,
      runtimeView: input.runtimeView,
      spaceId: lookup.query.spaceId,
      sourceSignalId: lookup.query.sourceSignalId,
      clientMessageId: lookup.query.clientMessageId,
      targetProfileId: lookup.query.targetProfileId,
    });
    return null;
  }
  if (lookup.matches.length > 1) {
    renderLookupAmbiguous({
      presenter: input.presenter,
      runtimeView: input.runtimeView,
      lookup,
    });
    return null;
  }
  const dispatchId = lookup.matches[0]?.dispatchId ?? null;
  const targetProfileId =
    lookup.query.targetProfileId ?? lookup.matches[0]?.targetProfileId ?? null;
  if (!dispatchId) {
    throw new Error("dispatchId could not be resolved");
  }
  if (!targetProfileId) {
    throw new Error("targetProfileId could not be resolved");
  }
  return {
    dispatchId,
    lookup,
    selector: parseServiceTraceSelector(
      clientMessageSelector
        ? {
            kind: "client_message",
            spaceId: lookup.query.spaceId,
            clientMessageId: clientMessageSelector,
            targetProfileId,
          }
        : {
            kind: "source_signal",
            spaceId: lookup.query.spaceId,
            sourceSignalId: sourceSignalSelector,
            targetProfileId,
          }
    ),
  };
}

function parseServiceTraceSelector(
  selector: unknown
): ObservabilityWakeTraceSelector {
  const parsed = observabilityWakeTraceSelectorSchema.safeParse(selector);
  if (!parsed.success) {
    throw new Error("invalid service trace selector");
  }
  return parsed.data;
}

async function resolveTraceTargetContext(input: {
  baseUrl: string;
  resolveProfile: typeof resolveOpenMeldProfileOrNull;
  trace: DispatchTraceSnapshot;
}): Promise<{
  targetProfile: OpenMeldProfile | null;
  currentReplyReadiness: Awaited<
    ReturnType<typeof resolveCurrentReplyReadinessSnapshot>
  > | null;
  currentAgentReplyReadiness: AgentReplyReadinessStatus | null;
  currentProfileWorkspace: ProfileWorkspacePresentation | null;
  guidance: ReplyReadinessGuidance | null;
}> {
  const targetProfileId = input.trace?.dispatch.targetProfileId ?? null;
  if (!targetProfileId) {
    return {
      targetProfile: null,
      currentReplyReadiness: null,
      currentAgentReplyReadiness: null,
      currentProfileWorkspace: null,
      guidance: null,
    };
  }

  const targetProfile = await input
    .resolveProfile({
      openMeldProfileId: targetProfileId,
      allowUnauthenticated: true,
      allowDefaultFallback: false,
      persistSelection: false,
    })
    .catch(() => null);
  if (targetProfile?.profileKind !== "agent") {
    return {
      targetProfile,
      currentReplyReadiness: null,
      currentAgentReplyReadiness: null,
      currentProfileWorkspace: null,
      guidance: null,
    };
  }

  const currentReplyReadiness = await resolveCurrentReplyReadinessSnapshot({
    baseUrl: input.baseUrl,
    includeDaemonRouteObservation: true,
    openClawDiagnosticsMode: "inspect",
    ownerUserId: targetProfile.ownerUserId,
    profile: targetProfile,
  }).catch(() => null);
  const currentAgentReplyReadiness =
    currentReplyReadiness?.agentReplyReadiness ?? null;
  const guidance = currentAgentReplyReadiness
    ? buildReplyReadinessGuidance({
        openClawLocalDiagnostics: resolveOpenClawLocalDiagnosticsValue(
          currentReplyReadiness?.openClawLocalDiagnostics ?? null
        ),
        profile: targetProfile,
        replyReadiness: currentAgentReplyReadiness,
      })
    : null;
  return {
    targetProfile,
    currentReplyReadiness,
    currentAgentReplyReadiness,
    currentProfileWorkspace: buildProfileWorkspacePresentation(
      currentReplyReadiness?.profileWorkspaceRuntimeResolution ?? null
    ),
    guidance,
  };
}

const TRACE_GUIDANCE_SUPPRESSED_RUNTIME_COORDINATOR_STATUSES = new Set([
  "created",
  "delivery_pending",
  "delivery_accepted",
  "accepted_local",
  "running",
  "completed_local",
  "result_received",
  "result_accepted",
  "reply_published",
]);

const TRACE_PRE_RESULT_RUNTIME_COORDINATOR_STATUSES = new Set([
  "created",
  "delivery_pending",
  "delivery_accepted",
  "cancellation_requested",
  "accepted_local",
  "running",
  "completed_local",
]);

const TRACE_GUIDANCE_SUPPRESSED_HEAD_STATUSES = new Set([
  "accepted",
  "execution_linked",
  "waiting",
  "publication_intent_ready",
]);

function shouldExposeCurrentReadinessGuidance(
  trace: DispatchTraceSnapshot
): boolean {
  if (!trace) {
    return true;
  }
  const finalVisibleOutcome =
    projectSpaceDispatchTraceFinalVisibleOutcome(trace);
  if (finalVisibleOutcome.delivered) {
    return false;
  }
  const executionStatus = trace.runtimeCoordinatorExecution?.status ?? null;
  if (
    executionStatus &&
    TRACE_GUIDANCE_SUPPRESSED_RUNTIME_COORDINATOR_STATUSES.has(executionStatus)
  ) {
    return false;
  }
  const headLifecycle = trace.runtimeCoordinatorHeadLifecycle ?? null;
  return !(
    headLifecycle?.readStatus === "found" &&
    TRACE_GUIDANCE_SUPPRESSED_HEAD_STATUSES.has(headLifecycle.status)
  );
}

function renderLookupNotFound(input: {
  clientMessageId: string | null;
  presenter: ReturnType<typeof createPresenter>;
  runtimeView: "human" | "agent";
  spaceId: string;
  sourceSignalId: string | null;
  targetProfileId: string | null;
}): void {
  const lookup = {
    query: {
      spaceId: input.spaceId,
      sourceSignalId: input.sourceSignalId,
      clientMessageId: input.clientMessageId,
      targetProfileId: input.targetProfileId,
    },
    matches: [],
  } satisfies GetSpaceDispatchLookupResponse;
  const diagnostic = buildLookupDiagnostic({
    clientMessageId: input.clientMessageId,
    sourceSignalId: input.sourceSignalId,
    spaceId: input.spaceId,
    targetProfileId: input.targetProfileId,
    reasonCode: resolveLookupNotFoundReasonCode(input),
  });
  const payload = {
    ...lookup,
    ...diagnostic,
  };
  const selectorLabel = formatLookupSelectorLabel(input);
  if (input.runtimeView === "agent") {
    input.presenter.data({
      code: "service.trace.lookup",
      payload,
    });
    input.presenter.line({
      code: "service.trace.lookup.summary",
      text: `${selectorLabel}: no matching dispatches`,
      data: payload,
    });
    return;
  }

  renderInfoCard({
    presenter: input.presenter,
    title: WAKE_TRACE_DIAGNOSTICS_TITLE,
    codePrefix: "service.trace.lookup.card",
    sanitize: true,
    rows: [
      { label: "Space ID", value: input.spaceId },
      ...(input.sourceSignalId
        ? [{ label: "Source Signal", value: input.sourceSignalId }]
        : []),
      ...(input.clientMessageId
        ? [{ label: "Client Message", value: input.clientMessageId }]
        : []),
      ...(input.targetProfileId
        ? [{ label: "Target Profile", value: input.targetProfileId }]
        : []),
      ...(diagnostic.correlation
        ? [
            {
              label: "Correlation Model",
              value: diagnostic.correlation.modelVersion,
            },
            {
              label: "Selector",
              value: formatWakeTraceSelector(diagnostic.correlation.selector),
            },
            {
              label: "Correlation Chain",
              value: formatCorrelationChain(diagnostic.correlation),
            },
          ]
        : []),
      { label: "Status", value: "not found" },
      { label: "Reason", value: diagnostic.reasonCode },
      {
        label: "Why",
        value: formatLookupNotFoundExplanation({
          reasonCode: diagnostic.reasonCode,
        }),
      },
    ],
  });
}

function renderLookupAmbiguous(input: {
  presenter: ReturnType<typeof createPresenter>;
  runtimeView: "human" | "agent";
  lookup: GetSpaceDispatchLookupResponse;
}): void {
  const payload = {
    ...input.lookup,
    reasonCode: "wake_trace.multiple_dispatches",
  } satisfies GetSpaceDispatchLookupResponse & {
    reasonCode: ServiceTraceLookupReasonCode;
  };
  if (input.runtimeView === "agent") {
    input.presenter.data({
      code: "service.trace.lookup",
      payload,
    });
    input.presenter.line({
      code: "service.trace.lookup.summary",
      text: `${formatLookupSelectorLabel(input.lookup.query)}: ${input.lookup.matches.length} matching dispatches; specify --target-profile or --dispatch`,
      data: payload,
    });
    return;
  }

  const rows: Array<{ label: string; value: string }> = [
    { label: "Space ID", value: input.lookup.query.spaceId },
    ...(input.lookup.query.sourceSignalId
      ? [{ label: "Source Signal", value: input.lookup.query.sourceSignalId }]
      : []),
    ...(input.lookup.query.clientMessageId
      ? [{ label: "Client Message", value: input.lookup.query.clientMessageId }]
      : []),
    {
      label: "Status",
      value: `${input.lookup.matches.length} matching dispatches`,
    },
  ];
  for (const match of input.lookup.matches) {
    rows.push({
      label: `Dispatch ${match.dispatchId}`,
      value: `${match.targetProfileId} · ${match.status} · latestAttempt=${match.latestAttemptStatus ?? "none"}`,
    });
  }
  rows.push({
    label: "Next",
    value:
      "Run again with --target-profile <id> or use one dispatch ID with --dispatch.",
  });

  renderInfoCard({
    presenter: input.presenter,
    title: WAKE_TRACE_DIAGNOSTICS_TITLE,
    codePrefix: "service.trace.lookup.card",
    sanitize: true,
    rows,
  });
}

function buildLookupDiagnostic(input: {
  clientMessageId: string | null;
  reasonCode: ServiceTraceLookupReasonCode;
  sourceSignalId: string | null;
  spaceId: string;
  targetProfileId: string | null;
}): ServiceTraceLookupDiagnostic {
  const selector = buildLookupDiagnosticSelector(input);
  return {
    correlation: selector
      ? projectObservabilityWakeCorrelation({
          selector,
          clientMessageId: input.clientMessageId,
          sourceSignalId: input.sourceSignalId,
          spaceId: input.spaceId,
          targetProfileId: input.targetProfileId,
        })
      : null,
    reasonCode: input.reasonCode,
    selector,
  };
}

function buildLookupDiagnosticSelector(input: {
  clientMessageId: string | null;
  sourceSignalId: string | null;
  spaceId: string;
  targetProfileId: string | null;
}): ObservabilityWakeTraceSelector | null {
  if (!input.targetProfileId) {
    return null;
  }
  if (input.clientMessageId) {
    return parseServiceTraceSelector({
      kind: "client_message",
      spaceId: input.spaceId,
      clientMessageId: input.clientMessageId,
      targetProfileId: input.targetProfileId,
    });
  }
  if (input.sourceSignalId) {
    return parseServiceTraceSelector({
      kind: "source_signal",
      spaceId: input.spaceId,
      sourceSignalId: input.sourceSignalId,
      targetProfileId: input.targetProfileId,
    });
  }
  return null;
}

function resolveLookupNotFoundReasonCode(input: {
  clientMessageId: string | null;
  sourceSignalId: string | null;
}): ServiceTraceLookupReasonCode {
  if (input.clientMessageId && !input.sourceSignalId) {
    return "wake_trace.source_signal_not_found";
  }
  return "wake_trace.dispatch_not_found";
}

function formatLookupNotFoundExplanation(input: {
  reasonCode: ServiceTraceLookupReasonCode;
}): string {
  switch (input.reasonCode) {
    case "wake_trace.source_signal_not_found":
      return "No source signal was found for this client message.";
    case "wake_trace.dispatch_not_found":
      return "No dispatch ledger or planner non-ready record was found for this source and target.";
    case "wake_trace.multiple_dispatches":
      return "More than one dispatch matched this selector; specify the target profile or dispatch ID.";
    default:
      return "No matching dispatch trace evidence was found.";
  }
}

function formatLookupSelectorLabel(input: {
  clientMessageId: string | null;
  sourceSignalId: string | null;
}): string {
  if (input.sourceSignalId) {
    return `source signal ${input.sourceSignalId}`;
  }
  if (input.clientMessageId) {
    return `client message ${input.clientMessageId}`;
  }
  return "lookup selector";
}

function buildHumanTraceRows(input: {
  actorProfile: OpenMeldProfile;
  spaceId: string;
  dispatchId: string;
  lookup: GetSpaceDispatchLookupResponse | null;
  trace: DispatchTraceSnapshot;
  targetProfile: OpenMeldProfile | null;
  currentAgentReplyReadiness: AgentReplyReadinessStatus | null;
  currentDeviceReplyReadiness: DeviceReplyReadinessStatus | null;
  currentDaemonRouteObservation:
    | Awaited<
        ReturnType<typeof resolveCurrentReplyReadinessSnapshot>
      >["daemonRouteObservation"]
    | null;
  currentProfileWorkspace: ProfileWorkspacePresentation | null;
  correlation: SpaceDispatchTraceResponse["correlation"];
  selector: ObservabilityWakeTraceSelector;
  guidance: ReplyReadinessGuidance | null;
  agentExecutionStatus: AgentExecutionStatusProjection | null;
  daemonDispatchJournal: ServiceTraceDaemonDispatchJournalEvidence;
}): Array<{ label: string; value: string }> {
  if (!input.trace) {
    return [
      {
        label: "Actor",
        value: formatServiceTraceActorLabel(input.actorProfile),
      },
      { label: "Space ID", value: input.spaceId },
      { label: "Dispatch ID", value: input.dispatchId },
      {
        label: "Correlation Model",
        value: input.correlation.modelVersion,
      },
      {
        label: "Selector",
        value: formatWakeTraceSelector(input.selector),
      },
      { label: "Status", value: "not found" },
      {
        label: "Why",
        value: "No dispatch ledger record was found for this space.",
      },
      {
        label: "Next",
        value: formatOpenMeldCliCommand(
          "openmeld space history <space-id> --kind text --limit 20"
        ),
      },
    ];
  }

  const rows: Array<{ label: string; value: string }> = [
    {
      label: "Actor",
      value: formatServiceTraceActorLabel(input.actorProfile),
    },
    { label: "Space ID", value: input.spaceId },
    { label: "Dispatch ID", value: input.trace.dispatch.dispatchId },
    {
      label: "Correlation Model",
      value: input.correlation.modelVersion,
    },
    {
      label: "Selector",
      value: formatWakeTraceSelector(input.selector),
    },
    {
      label: "Correlation Chain",
      value: formatCorrelationChain(input.correlation),
    },
    ...(input.lookup?.query.sourceSignalId
      ? [{ label: "Source Signal", value: input.lookup.query.sourceSignalId }]
      : []),
    ...(input.lookup?.query.clientMessageId
      ? [
          {
            label: "Client Message",
            value: input.lookup.query.clientMessageId,
          },
        ]
      : []),
    {
      label: "Target",
      value:
        input.targetProfile?.profileName ??
        input.trace.dispatch.targetProfileId,
    },
  ];

  appendFinalVisibleOutcomeRows(rows, input.trace);
  appendFinalVisibleMessageRows(rows, input.trace);
  appendFinalVisibleMessageLinkageRows(rows, input.trace);
  rows.push({
    label: "Root Cause",
    value: resolveTraceRootCause(input.trace),
  });
  rows.push({
    label: "Dispatch Ledger Evidence",
    value: `${input.trace.dispatch.status} · attempts ${input.trace.dispatch.attemptCount}`,
  });
  appendPublicationDiagnosticRows(rows, input.trace);

  if (input.agentExecutionStatus) {
    rows.push({
      label: "Current Local Execution Diagnostics",
      value:
        "Local binding, execution target, daemon route, and execution authority evidence only; not Core AgentExecutionReadiness and not this Wake's final result.",
    });
    rows.push(
      ...buildServiceTraceLocalExecutionDiagnosticRows(
        input.agentExecutionStatus
      )
    );
  }

  if (input.currentAgentReplyReadiness) {
    rows.push({ label: "", value: "" });
    rows.push({
      label: "Current Local Reply Evidence",
      value: formatLocalReplyEvidenceLabel(
        formatAgentReplyReadinessLabel(input.currentAgentReplyReadiness)
      ),
    });
    rows.push({
      label: "Current Local Service Link Evidence",
      value:
        input.currentDeviceReplyReadiness === null
          ? "Unknown"
          : formatLocalReplyEvidenceLabel(
              formatDeviceReplyReadinessLabel(input.currentDeviceReplyReadiness)
            ),
    });
    if (input.currentDaemonRouteObservation) {
      rows.push({
        label: "Current Local Reply Route Evidence",
        value: formatDaemonRouteObservationLabel(
          input.currentDaemonRouteObservation
        ),
      });
    }
    rows.push({
      label: "Current Local Reply Evidence Reason",
      value: formatHumanReplyReadinessReason(input.currentAgentReplyReadiness),
    });
    rows.push(...buildProfileWorkspaceRows(input.currentProfileWorkspace));
  }

  appendRuntimeCoordinatorRows(rows, input.trace);
  appendDispatchResultRows(rows, input.trace);
  appendResultInboxRows(rows, input.trace);
  appendDaemonDispatchJournalRows(rows, input.daemonDispatchJournal);
  appendLatestAttemptRows(rows, input.trace);
  appendStructuredActionFailureRows(rows, input.trace);
  appendStreamingRows(rows, input.trace);
  appendRuntimeRows(rows, input.trace);
  appendExecutionRows(rows, input.trace);
  appendOriginRows(rows, input.trace);
  appendPromptRows(rows, input.trace);
  appendDispatchExecutionRows(rows, input.trace);
  appendOpenClawBindingRows(rows, input.trace);
  appendOpenClawGatewayVisibilityRows(rows, input.trace);

  const operatorReason = resolveTraceReason(input.trace.recentOpsDecisions);
  if (operatorReason) {
    rows.push({
      label: "Trace Reason",
      value: operatorReason,
    });
  }

  if (input.trace.replySignal) {
    rows.push({
      label: "Reply Signal",
      value: truncateText(input.trace.replySignal.text, 120),
    });
  }

  rows.push({
    label: "Ops Decisions",
    value: formatOpsDecisionSummary(input.trace.recentOpsDecisions),
  });

  if (input.guidance?.nextSteps[0]) {
    rows.push({
      label: "Next",
      value: input.guidance.nextSteps[0],
    });
  }
  if (input.guidance?.nextSteps[1]) {
    rows.push({
      label: "Then",
      value: input.guidance.nextSteps[1],
    });
  }

  return rows;
}

function formatLocalReplyEvidenceLabel(value: string): string {
  if (
    value === "Ready" ||
    value === "Available for Wake" ||
    value === "Can reply"
  ) {
    return "Local evidence: reply-capable";
  }
  const replyCapableDetail = firstPrefixedDetail(value, [
    "Ready · ",
    "Available for Wake · ",
    "Can reply · ",
  ]);
  if (replyCapableDetail !== null) {
    return `Local evidence: reply-capable · ${replyCapableDetail}`;
  }
  if (value === "Not ready" || value === "Unavailable" || value === "Blocked") {
    return "Local evidence: not reply-capable";
  }
  const notReplyCapableDetail = firstPrefixedDetail(value, [
    "Not ready · ",
    "Unavailable · ",
    "Blocked · ",
  ]);
  if (notReplyCapableDetail !== null) {
    return `Local evidence: not reply-capable · ${notReplyCapableDetail}`;
  }
  const blockedParenthesizedDetail = parenthesizedDetail(value, "Blocked");
  if (blockedParenthesizedDetail !== null) {
    return `Local evidence: not reply-capable · ${blockedParenthesizedDetail}`;
  }
  return value;
}

function firstPrefixedDetail(
  value: string,
  prefixes: readonly string[]
): string | null {
  const prefix = prefixes.find((candidate) => value.startsWith(candidate));
  return prefix ? value.slice(prefix.length) : null;
}

function parenthesizedDetail(value: string, label: string): string | null {
  const prefix = `${label} (`;
  if (!(value.startsWith(prefix) && value.endsWith(")"))) {
    return null;
  }
  const detail = value.slice(prefix.length, -1).trim();
  return detail.length > 0 ? detail : null;
}

async function resolveServiceTraceActorProfile(input: {
  explicitProfileId?: string;
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  actingProfile: OpenMeldProfile;
}): Promise<OpenMeldProfile | null> {
  if (
    normalizeOptionalString(input.explicitProfileId) ||
    !canUseInteractivePrompts(input.runtime)
  ) {
    return input.actingProfile;
  }

  while (true) {
    const selectedAction = await select({
      message: `Use ${input.actingProfile.profileName} (${input.actingProfile.openMeldProfileId}) to read this dispatch trace?`,
      initialValue: SERVICE_TRACE_USE_CURRENT_PROFILE,
      options: [
        {
          value: SERVICE_TRACE_USE_CURRENT_PROFILE,
          label: "Continue with this profile",
        },
        {
          value: SERVICE_TRACE_CHOOSE_ANOTHER_PROFILE,
          label: "Choose another profile",
        },
        {
          value: SERVICE_TRACE_CANCEL,
          label: "Cancel",
        },
      ],
    });

    if (isCancel(selectedAction) || selectedAction === SERVICE_TRACE_CANCEL) {
      cancel("Cancelled.");
      return null;
    }
    if (selectedAction !== SERVICE_TRACE_CHOOSE_ANOTHER_PROFILE) {
      return input.actingProfile;
    }

    const selectedProfile = await promptForOpenMeldProfileSelection({
      message: "Which profile do you want to use to read this trace?",
      resolvedView: input.runtime.resolvedView,
      currentProfileId: input.actingProfile.openMeldProfileId,
      backLabel: "Back",
    });
    if (selectedProfile.status === "back") {
      continue;
    }
    if (selectedProfile.status !== "submitted") {
      cancel("Cancelled.");
      return null;
    }

    if (selectedProfile.value === input.actingProfile.openMeldProfileId) {
      return input.actingProfile;
    }

    return await resolveOpenMeldProfile({
      openMeldProfileId: selectedProfile.value,
    });
  }
}

function formatServiceTraceActorLabel(profile: OpenMeldProfile): string {
  return `${profile.profileName} (${profile.openMeldProfileId}) · ${profile.profileKind}`;
}

function formatCorrelationChain(
  correlation: ObservabilityWakeCorrelation
): string {
  return [
    correlation.spaceId ? `space=${correlation.spaceId}` : null,
    correlation.clientMessageId
      ? `client=${correlation.clientMessageId}`
      : null,
    correlation.sourceSignalId ? `source=${correlation.sourceSignalId}` : null,
    correlation.targetProfileId
      ? `target=${correlation.targetProfileId}`
      : null,
    correlation.dispatchId ? `dispatch=${correlation.dispatchId}` : null,
    correlation.runtimeCoordinatorExecutionId
      ? `runtimeCoordinatorExecution=${correlation.runtimeCoordinatorExecutionId}`
      : null,
    correlation.latestAttemptId
      ? `attempt=${correlation.latestAttemptId}`
      : null,
    correlation.bindingId ? `binding=${correlation.bindingId}` : null,
    correlation.openMeldServiceRuntimeId
      ? `runtime=${correlation.openMeldServiceRuntimeId}`
      : null,
    correlation.agentControllerRef
      ? `agentController=${correlation.agentControllerRef}`
      : null,
    correlation.resultRef ? `result=${correlation.resultRef}` : null,
    correlation.publishedSignalId
      ? `published=${correlation.publishedSignalId}`
      : null,
    correlation.replySignalId ? `reply=${correlation.replySignalId}` : null,
    correlation.cloudflare.cfRayId
      ? `cfRay=${correlation.cloudflare.cfRayId}`
      : null,
    correlation.cloudflare.traceId
      ? `cfTrace=${correlation.cloudflare.traceId}`
      : null,
    correlation.cloudflare.requestId
      ? `cfRequest=${correlation.cloudflare.requestId}`
      : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" -> ");
}

function formatWakeTraceSelector(
  selector: ObservabilityWakeTraceSelector
): string {
  switch (selector.kind) {
    case "client_message":
      return `client_message · space=${selector.spaceId} · client=${selector.clientMessageId} · target=${selector.targetProfileId}`;
    case "source_signal":
      return `source_signal · space=${selector.spaceId} · source=${selector.sourceSignalId} · target=${selector.targetProfileId}`;
    case "dispatch":
      return `dispatch · space=${selector.spaceId} · dispatch=${selector.dispatchId}`;
    case "claim_lease":
      return `legacy dispatch lease · diagnostic · id=${selector.claimLeaseId}`;
    default:
      return "unknown";
  }
}

function appendRuntimeCoordinatorRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace) {
    return;
  }

  if (trace.runtimeCoordinatorHeadLifecycle) {
    rows.push({
      label: "RuntimeCoordinator Head",
      value: formatRuntimeCoordinatorHeadLifecycleLabel(
        trace.runtimeCoordinatorHeadLifecycle
      ),
    });
    if (
      trace.runtimeCoordinatorHeadLifecycle.readStatus === "found" &&
      trace.runtimeCoordinatorHeadLifecycle.waitingBoundary
    ) {
      const boundary = trace.runtimeCoordinatorHeadLifecycle.waitingBoundary;
      rows.push({
        label: "Head Waiting Boundary",
        value: `${boundary.waitingCategory} · ${boundary.reasonCode} · softWait=${boundary.softDeadlineAt} · deadline=${boundary.deadlineAt}`,
      });
    }
    if (
      trace.runtimeCoordinatorHeadLifecycle.readStatus === "found" &&
      trace.runtimeCoordinatorHeadLifecycle.publicationIntent
    ) {
      rows.push({
        label: "Head Publication Intent",
        value: formatRuntimeCoordinatorHeadPublicationIntentLabel(
          trace.runtimeCoordinatorHeadLifecycle.publicationIntent
        ),
      });
    }
  }

  if (trace.runtimeCoordinatorExecution) {
    rows.push({
      label: "RuntimeCoordinator Execution",
      value: `${trace.runtimeCoordinatorExecution.runtimeCoordinatorExecutionId} · ${trace.runtimeCoordinatorExecution.status}`,
    });
    rows.push({
      label: "Execution Authority",
      value: `${trace.runtimeCoordinatorExecution.openMeldServiceRuntimeId.value} · ${trace.runtimeCoordinatorExecution.bindingId} · ${trace.runtimeCoordinatorExecution.agentControllerRef}`,
    });
    if (trace.runtimeCoordinatorExecution.terminalOutcome) {
      rows.push({
        label: "Execution Terminal Outcome",
        value: `${trace.runtimeCoordinatorExecution.terminalOutcome.kind} · ${trace.runtimeCoordinatorExecution.terminalOutcome.reasonCode ?? "no_reason"}`,
      });
    }
  } else if (
    trace.runtimeCoordinatorHeadLifecycle?.readStatus === "found" &&
    trace.runtimeCoordinatorCreationDiagnostics.length > 0
  ) {
    rows.push({
      label: "RuntimeCoordinator Creation Diagnostic",
      value: `diagnostic_only · ${formatRuntimeCoordinatorCreationDiagnostics(trace.runtimeCoordinatorCreationDiagnostics)}`,
    });
  } else if (trace.runtimeCoordinatorCreationDiagnostics.length > 0) {
    rows.push({
      label: "RuntimeCoordinator Execution",
      value: `not_created · ${formatRuntimeCoordinatorCreationDiagnostics(trace.runtimeCoordinatorCreationDiagnostics)}`,
    });
  }

  const tokenSummary = formatRuntimeCoordinatorTokenSummary(
    trace.runtimeCoordinatorEvents
  );
  if (tokenSummary) {
    rows.push({
      label: "Execution Token",
      value: tokenSummary,
    });
  }

  const ignoredEventSummary = formatRuntimeCoordinatorIgnoredEventSummary(
    trace.runtimeCoordinatorEvents
  );
  if (ignoredEventSummary) {
    rows.push({
      label: "Ignored Runtime Events",
      value: ignoredEventSummary,
    });
  }
}

function formatRuntimeCoordinatorHeadLifecycleLabel(
  headLifecycle: NonNullable<
    NonNullable<DispatchTraceSnapshot>["runtimeCoordinatorHeadLifecycle"]
  >
): string {
  if (headLifecycle.readStatus === "authority_unavailable") {
    return `authority_unavailable · ${headLifecycle.reasonCode}`;
  }
  if (headLifecycle.readStatus === "missing") {
    return `missing · ${headLifecycle.reasonCode}`;
  }
  const noExecutionReason =
    headLifecycle.noExecutionDecision?.reasonCode ?? null;
  const stoppedReason =
    headLifecycle.publicationIntent?.kind === "stopped_notice"
      ? headLifecycle.publicationIntent.reasonCode
      : null;
  const waitingReason = headLifecycle.waitingBoundary?.reasonCode ?? null;
  return [
    headLifecycle.status,
    `targetWake=${headLifecycle.targetWakeLifecycleId}`,
    `execution=${headLifecycle.runtimeCoordinatorExecutionId ?? "none"}`,
    noExecutionReason ? `noExecution=${noExecutionReason}` : null,
    stoppedReason ? `stop=${stoppedReason}` : null,
    waitingReason ? `waiting=${waitingReason}` : null,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" · ");
}

function formatRuntimeCoordinatorHeadPublicationIntentLabel(
  intent: NonNullable<
    Extract<
      NonNullable<
        NonNullable<DispatchTraceSnapshot>["runtimeCoordinatorHeadLifecycle"]
      >,
      { readStatus: "found" }
    >["publicationIntent"]
  >
): string {
  if (intent.kind === "stopped_notice") {
    return `${intent.status} · stopped_notice · ${intent.reasonCode}`;
  }
  return `${intent.status} · ${intent.publicationCategory} · ${intent.reasonCode} · ${intent.userRecoveryAction}`;
}

const RUNTIME_COORDINATOR_TOKEN_EVENT_TYPES = new Set<
  RuntimeCoordinatorTraceEvent["eventType"]
>([
  "execution_token_expired",
  "execution_token_issued",
  "execution_token_revoked",
  "execution_token_superseded",
  "execution_token_terminal_late",
  "execution_token_validation_failed",
  "token_history_pruned",
  "token_history_retained",
]);

const RUNTIME_COORDINATOR_IGNORED_EVENT_TYPES = new Set<
  RuntimeCoordinatorTraceEvent["eventType"]
>([
  "execution_token_expired",
  "execution_token_revoked",
  "execution_token_superseded",
  "execution_token_terminal_late",
  "execution_token_validation_failed",
  "owner_conflict_current_token",
  "owner_conflict_missing_token",
  "owner_conflict_stale_token",
  "result_connection_generation_mismatch",
  "result_duplicate",
  "result_identity_echo_mismatch",
  "result_late_diagnostic",
  "result_stale_attempt",
  "result_stale_lease",
]);

function formatRuntimeCoordinatorCreationDiagnostics(
  diagnostics: NonNullable<DispatchTraceSnapshot>["runtimeCoordinatorCreationDiagnostics"]
): string {
  return diagnostics
    .slice(0, 3)
    .map((diagnostic) => diagnostic.reasonCode)
    .join(", ");
}

function formatRuntimeCoordinatorTokenSummary(
  events: RuntimeCoordinatorTraceEvent[]
): string | null {
  const tokenEvents = events.filter((event) =>
    RUNTIME_COORDINATOR_TOKEN_EVENT_TYPES.has(event.eventType)
  );
  const latestTokenEvent = tokenEvents.at(-1);
  if (!latestTokenEvent) {
    return null;
  }

  const payload = parseRuntimeCoordinatorEventPayload(latestTokenEvent);
  const tokenStatus =
    readRuntimeCoordinatorPayloadString(payload, "tokenStatus") ??
    inferTokenStatusFromRuntimeCoordinatorEvent(latestTokenEvent.eventType) ??
    "unknown";
  const tokenFingerprint = readRuntimeCoordinatorPayloadString(
    payload,
    "tokenFingerprint"
  );
  const runId = readRuntimeCoordinatorPayloadString(payload, "runId");
  const reason = latestTokenEvent.reasonCode ?? "no_reason";
  return [
    `status=${tokenStatus}`,
    tokenFingerprint ? `fingerprint=${tokenFingerprint}` : null,
    runId ? `run=${runId}` : null,
    `reason=${reason}`,
    `event=${latestTokenEvent.eventType}`,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

function formatRuntimeCoordinatorIgnoredEventSummary(
  events: RuntimeCoordinatorTraceEvent[]
): string | null {
  const ignoredEvents = events.filter((event) =>
    RUNTIME_COORDINATOR_IGNORED_EVENT_TYPES.has(event.eventType)
  );
  if (ignoredEvents.length === 0) {
    return null;
  }

  return ignoredEvents
    .slice(-4)
    .map(formatRuntimeCoordinatorIgnoredEvent)
    .join(", ");
}

function formatRuntimeCoordinatorIgnoredEvent(
  event: RuntimeCoordinatorTraceEvent
): string {
  const payload = parseRuntimeCoordinatorEventPayload(event);
  const tokenFingerprint = readRuntimeCoordinatorPayloadString(
    payload,
    "tokenFingerprint"
  );
  const tokenStatus = readRuntimeCoordinatorPayloadString(
    payload,
    "tokenStatus"
  );
  const reason = event.reasonCode ?? "no_reason";
  return [
    `${event.eventType}:${reason}`,
    tokenStatus ? `status=${tokenStatus}` : null,
    tokenFingerprint ? `fingerprint=${tokenFingerprint}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
}

function inferTokenStatusFromRuntimeCoordinatorEvent(
  eventType: RuntimeCoordinatorTraceEvent["eventType"]
): string | null {
  switch (eventType) {
    case "execution_token_issued":
      return "active";
    case "execution_token_expired":
      return "expired";
    case "execution_token_revoked":
      return "revoked";
    case "execution_token_superseded":
      return "superseded";
    case "execution_token_terminal_late":
      return "terminal";
    default:
      return null;
  }
}

function parseRuntimeCoordinatorEventPayload(
  event: RuntimeCoordinatorTraceEvent
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(event.payloadJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readRuntimeCoordinatorPayloadString(
  payload: Record<string, unknown> | null,
  fieldName: string
): string | null {
  const value = payload?.[fieldName];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function appendDispatchResultRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace?.result) {
    return;
  }
  rows.push({
    label: "Dispatch Result Evidence",
    value: `${trace.result.publicOutcome} · ${trace.result.resultRef}`,
  });
  if (trace.result.publishedSignalId) {
    rows.push({
      label: "Published Signal Evidence",
      value: trace.result.publishedSignalId,
    });
  }
}

function appendFinalVisibleMessageRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  const finalVisibleMessage = trace?.finalVisibleMessage ?? null;
  if (!finalVisibleMessage) {
    return;
  }
  rows.push({
    label: "Final Visible Message",
    value: formatFinalVisibleMessage(finalVisibleMessage),
  });
}

function appendFinalVisibleOutcomeRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace) {
    return;
  }
  const finalVisibleOutcome =
    projectSpaceDispatchTraceFinalVisibleOutcome(trace);
  rows.push({
    label: "Final Visible Outcome",
    value: formatFinalVisibleOutcome(finalVisibleOutcome, trace),
  });
}

function formatFinalVisibleOutcome(
  finalVisibleOutcome: SpaceDispatchTraceFinalVisibleOutcome,
  trace: NonNullable<DispatchTraceSnapshot>
): string {
  const deliveryLabel = formatFinalVisibleOutcomeDeliveryLabel({
    finalVisibleOutcome,
    trace,
  });
  const details = [
    deliveryLabel,
    finalVisibleOutcome.status,
    finalVisibleOutcome.publicationKind,
    finalVisibleOutcome.reasonCode,
    finalVisibleOutcome.sourceReasonCode
      ? `detail=${finalVisibleOutcome.sourceReasonCode}`
      : null,
    finalVisibleOutcome.publicationErrorCode
      ? `error=${finalVisibleOutcome.publicationErrorCode}`
      : null,
    `source=${finalVisibleOutcome.sourceFact}`,
    finalVisibleOutcome.sourceStatus
      ? `sourceStatus=${finalVisibleOutcome.sourceStatus}`
      : null,
    finalVisibleOutcome.signalId
      ? `signal=${finalVisibleOutcome.signalId}`
      : null,
  ].filter((value): value is string => Boolean(value));
  return details.join(" · ");
}

function formatFinalVisibleOutcomeDeliveryLabel(input: {
  finalVisibleOutcome: SpaceDispatchTraceFinalVisibleOutcome;
  trace: NonNullable<DispatchTraceSnapshot>;
}): string {
  if (input.finalVisibleOutcome.delivered) {
    return "delivered";
  }
  const linkage = input.trace.finalVisibleMessageLinkage ?? null;
  if (
    linkage?.status === "linkage_missing" &&
    shouldExposeFinalVisibleLinkageDiagnostic(input)
  ) {
    return "linkage missing";
  }
  if (
    linkage?.status === "storage_inconsistent" &&
    shouldExposeFinalVisibleLinkageDiagnostic(input)
  ) {
    return "storage inconsistent";
  }

  switch (input.finalVisibleOutcome.status) {
    case "publication_pending":
      return "publishing";
    case "publication_retrying":
      return "publishing retrying";
    case "not_applicable":
      return "final projection pending";
    case "publication_unresolved":
      return "not delivered";
    default:
      return "not delivered";
  }
}

function shouldExposeFinalVisibleLinkageDiagnostic(input: {
  finalVisibleOutcome: SpaceDispatchTraceFinalVisibleOutcome;
  trace: NonNullable<DispatchTraceSnapshot>;
}): boolean {
  const linkage = input.trace.finalVisibleMessageLinkage ?? null;
  if (
    !linkage ||
    (linkage.status !== "linkage_missing" &&
      linkage.status !== "storage_inconsistent")
  ) {
    return false;
  }
  return !(
    input.finalVisibleOutcome.status === "publication_unresolved" &&
    (input.finalVisibleOutcome.sourceFact === "runtime_coordinator_event" ||
      (input.finalVisibleOutcome.sourceFact ===
        "runtime_coordinator_head_lifecycle" &&
        input.finalVisibleOutcome.signalId === null))
  );
}

function appendFinalVisibleMessageLinkageRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  const linkage = trace?.finalVisibleMessageLinkage ?? null;
  if (!linkage) {
    return;
  }
  rows.push({
    label: "Final Visible Linkage",
    value: formatFinalVisibleMessageLinkage(linkage),
  });
}

function formatFinalVisibleMessageLinkage(
  linkage: NonNullable<
    NonNullable<DispatchTraceSnapshot>["finalVisibleMessageLinkage"]
  >
): string {
  return [
    linkage.status,
    linkage.reasonCode ? `reason=${linkage.reasonCode}` : null,
    `source=${linkage.sourceFact}`,
    linkage.candidateSignalIds.length > 0
      ? `candidates=${linkage.candidateSignalIds.join(",")}`
      : null,
    linkage.claimSignalId ? `claim=${linkage.claimSignalId}` : null,
    linkage.selectedSignalId ? `selected=${linkage.selectedSignalId}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function appendPublicationDiagnosticRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace) {
    return;
  }
  const finalVisibleOutcome =
    projectSpaceDispatchTraceFinalVisibleOutcome(trace);
  if (!isPublicationDiagnosticOutcome(finalVisibleOutcome)) {
    return;
  }

  rows.push({
    label: "Publication Closure",
    value: formatPublicationClosure(finalVisibleOutcome),
  });
  rows.push({
    label: "Publication Diagnostic Evidence",
    value: formatPublicationDiagnosticEvidence(finalVisibleOutcome),
  });

  const publicationBlocker = resolveRuntimeCoordinatorPublicationBlocker(trace);
  if (publicationBlocker) {
    rows.push({
      label: "RuntimeCoordinator Publication Blocker Evidence",
      value: formatRuntimeCoordinatorPublicationBlocker(publicationBlocker),
    });
    const finalizationCommandId = parseFinalizationCommandId(
      publicationBlocker.blockerId
    );
    if (finalizationCommandId) {
      rows.push({
        label: "Finalization Command Evidence",
        value: `${finalizationCommandId} · diagnostic_only`,
      });
    }
  }

  appendHeadPublicationDiagnosticRows(rows, trace);
  appendResultPublicationDiagnosticRows(rows, trace);
}

function isPublicationDiagnosticOutcome(
  finalVisibleOutcome: SpaceDispatchTraceFinalVisibleOutcome
): boolean {
  return (
    finalVisibleOutcome.status === "publication_retrying" ||
    finalVisibleOutcome.status === "publication_unresolved"
  );
}

function formatPublicationClosure(
  finalVisibleOutcome: SpaceDispatchTraceFinalVisibleOutcome
): string {
  let deliveryLabel = "not delivered";
  if (finalVisibleOutcome.delivered) {
    deliveryLabel = "delivered";
  } else if (finalVisibleOutcome.status === "publication_retrying") {
    deliveryLabel = "publishing retrying";
  }
  return [
    deliveryLabel,
    finalVisibleOutcome.status,
    finalVisibleOutcome.publicationKind,
    "diagnostic_only",
    "no Space-visible final outcome",
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function formatPublicationDiagnosticEvidence(
  finalVisibleOutcome: SpaceDispatchTraceFinalVisibleOutcome
): string {
  return [
    finalVisibleOutcome.publicationKind,
    `source=${finalVisibleOutcome.sourceFact}`,
    finalVisibleOutcome.reasonCode
      ? `reason=${finalVisibleOutcome.reasonCode}`
      : null,
    finalVisibleOutcome.sourceReasonCode
      ? `detail=${finalVisibleOutcome.sourceReasonCode}`
      : null,
    finalVisibleOutcome.publicationErrorCode
      ? `error=${finalVisibleOutcome.publicationErrorCode}`
      : null,
    finalVisibleOutcome.sourceStatus
      ? `sourceStatus=${finalVisibleOutcome.sourceStatus}`
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

type RuntimeCoordinatorPublicationBlockerEvidence = {
  blockerId: string | null;
  blockerKind: string | null;
  publicationKind: string | null;
  reasonCode: string | null;
  status: string | null;
  targetProfileId: string | null;
  targetWakeLifecycleId: string | null;
};

function resolveRuntimeCoordinatorPublicationBlocker(
  trace: DispatchTraceSnapshot
): RuntimeCoordinatorPublicationBlockerEvidence | null {
  const event = trace?.runtimeCoordinatorEvents
    .filter(
      (candidate) =>
        candidate.eventType === "runtime_coordinator_decision_recorded" &&
        candidate.reasonCode === "runtime_coordinator.publication_unresolved"
    )
    .at(-1);
  if (!event) {
    return null;
  }
  const payload = parseRuntimeCoordinatorEventPayload(event);
  const status = readRuntimeCoordinatorPayloadString(payload, "status");
  if (status !== "unresolved_publication_failure") {
    return null;
  }
  return {
    blockerId: readRuntimeCoordinatorPayloadString(payload, "blockerId"),
    blockerKind: readRuntimeCoordinatorPayloadString(payload, "blockerKind"),
    publicationKind: readRuntimeCoordinatorPayloadString(
      payload,
      "publicationKind"
    ),
    reasonCode: readRuntimeCoordinatorPayloadString(payload, "reasonCode"),
    status,
    targetProfileId: readRuntimeCoordinatorPayloadString(
      payload,
      "targetProfileId"
    ),
    targetWakeLifecycleId: readRuntimeCoordinatorPayloadString(
      payload,
      "targetWakeLifecycleId"
    ),
  };
}

function formatRuntimeCoordinatorPublicationBlocker(
  blocker: RuntimeCoordinatorPublicationBlockerEvidence
): string {
  return [
    blocker.blockerId,
    blocker.blockerKind,
    blocker.publicationKind,
    blocker.status,
    blocker.reasonCode ? `reason=${blocker.reasonCode}` : null,
    blocker.targetProfileId ? `target=${blocker.targetProfileId}` : null,
    blocker.targetWakeLifecycleId
      ? `targetWake=${blocker.targetWakeLifecycleId}`
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function parseFinalizationCommandId(blockerId: string | null): string | null {
  const prefix = "finalization:";
  return blockerId?.startsWith(prefix)
    ? blockerId.slice(prefix.length).trim() || null
    : null;
}

function appendHeadPublicationDiagnosticRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  const headLifecycle = trace?.runtimeCoordinatorHeadLifecycle;
  if (headLifecycle?.readStatus !== "found") {
    return;
  }

  if (headLifecycle.publicationOutcome) {
    rows.push({
      label: "Failure Publication Command Evidence",
      value: formatHeadPublicationOutcome(headLifecycle.publicationOutcome),
    });
  }
  if (headLifecycle.publicationExhaustion) {
    rows.push({
      label: "Publication Exhaustion Evidence",
      value: formatHeadPublicationExhaustion(
        headLifecycle.publicationExhaustion
      ),
    });
  }
}

function formatHeadPublicationOutcome(
  outcome: Extract<
    NonNullable<DispatchTraceSnapshot>["runtimeCoordinatorHeadLifecycle"],
    { readStatus: "found" }
  >["publicationOutcome"]
): string {
  if (!outcome) {
    return "missing";
  }
  return [
    outcome.failurePublicationCommandId,
    outcome.status,
    outcome.finalMessageKind ?? "unknown_message_kind",
    outcome.publicationErrorCode
      ? `error=${outcome.publicationErrorCode}`
      : null,
    outcome.publishedSignalId ? `published=${outcome.publishedSignalId}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function formatHeadPublicationExhaustion(
  exhaustion: NonNullable<
    Extract<
      NonNullable<DispatchTraceSnapshot>["runtimeCoordinatorHeadLifecycle"],
      { readStatus: "found" }
    >["publicationExhaustion"]
  >
): string {
  return [
    exhaustion.status,
    `attempts ${exhaustion.attemptCount}`,
    `exhausted=${exhaustion.exhaustedAt}`,
    `lastFailure=${exhaustion.lastFailureAt}`,
    `lastReason=${exhaustion.lastReasonCode}`,
  ].join(" · ");
}

function appendResultPublicationDiagnosticRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  const resultInbox = trace?.resultInbox;
  if (
    !(
      resultInbox &&
      (resultInbox.publishState === "late_result_available" ||
        resultInbox.publishState === "reply_publication_failed" ||
        resultInbox.publicationErrorCode)
    )
  ) {
    return;
  }

  rows.push({
    label: "Result Publication Diagnostic Evidence",
    value: [
      resultInbox.publishState,
      resultInbox.resultKey,
      resultInbox.publicationErrorCode
        ? `error=${resultInbox.publicationErrorCode}`
        : null,
      resultInbox.publishedSignalId
        ? `published=${resultInbox.publishedSignalId}`
        : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · "),
  });
}

function formatFinalVisibleMessage(
  finalVisibleMessage: NonNullable<
    NonNullable<DispatchTraceSnapshot>["finalVisibleMessage"]
  >
): string {
  const details = [
    finalVisibleMessage.signalType,
    finalVisibleMessage.noticeType,
    finalVisibleMessage.statusType,
    finalVisibleMessage.reasonCode,
  ].filter((value): value is string => Boolean(value));
  const prefix =
    details.length > 0
      ? `${details.join(" · ")} · ${finalVisibleMessage.signalId}`
      : finalVisibleMessage.signalId;
  return finalVisibleMessage.text
    ? `${prefix} · ${truncateText(finalVisibleMessage.text, 120)}`
    : prefix;
}

function appendResultInboxRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace?.resultInbox) {
    return;
  }

  rows.push({
    label: "Result Inbox Evidence",
    value: `${trace.resultInbox.publishState} · ${trace.resultInbox.resultKey}`,
  });
  rows.push({
    label: "Result Submission Accepted",
    value: trace.resultInbox.acceptedAt,
  });
  rows.push({
    label: "Result Submission Evidence",
    value: `${trace.resultInbox.daemonSessionId} · lease ${trace.resultInbox.leaseEpoch} · connection ${trace.resultInbox.submittedConnectionGeneration}`,
  });
  if (trace.resultInbox.projectFailureContext) {
    rows.push({
      label: "Default Project Failure Context",
      value: [
        trace.resultInbox.projectFailureContext.projectId,
        trace.resultInbox.projectFailureContext.bindingGeneration
          ? `binding ${trace.resultInbox.projectFailureContext.bindingGeneration}`
          : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · "),
    });
  }
  if (trace.resultInbox.publicationErrorCode) {
    rows.push({
      label: "Result Publication Error Evidence",
      value: trace.resultInbox.publicationErrorCode,
    });
  }
}

function appendDaemonDispatchJournalRows(
  rows: Array<{ label: string; value: string }>,
  journal: ServiceTraceDaemonDispatchJournalEvidence
): void {
  if (journal.eventCount === 0) {
    return;
  }

  rows.push({
    label: "Daemon Result Delivery Evidence",
    value: formatDaemonDispatchJournalSummary(journal.events),
  });
}

function appendLatestAttemptRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace?.latestAttempt) {
    return;
  }

  rows.push({
    label: "Latest Attempt",
    value: resolveLatestAttemptLabel({
      latestAttempt: trace.latestAttempt,
      recentOpsDecisions: trace.recentOpsDecisions,
    }),
  });
  if (trace.latestAttempt.daemonSessionId) {
    rows.push({
      label: "Daemon Session",
      value: trace.latestAttempt.daemonSessionId,
    });
  }
  if (typeof trace.latestAttempt.connectionGeneration === "number") {
    rows.push({
      label: "Connection Generation",
      value: String(trace.latestAttempt.connectionGeneration),
    });
  }
  if (trace.latestAttempt.errorCode) {
    rows.push({
      label: "Attempt Error",
      value: formatAttemptError(
        trace.latestAttempt.errorCode,
        trace.latestAttempt.errorMessage
      ),
    });
  }
}

function appendStreamingRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace?.streaming) {
    return;
  }

  rows.push({
    label: "Streaming",
    value: formatStreamingTraceLabel(trace.streaming),
  });
  rows.push({
    label: "First Stdout",
    value: trace.streaming.firstStdoutAt ?? "n/a",
  });
  rows.push({
    label: "First Output",
    value: trace.streaming.firstOutputAt ?? "n/a",
  });
}

function appendRuntimeRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace?.runtime) {
    return;
  }

  rows.push({
    label: "Runtime",
    value: formatRuntimeTraceLabel(trace.runtime),
  });
  rows.push({
    label: "Spawned",
    value: trace.runtime.processSpawnedAt ?? "n/a",
  });
  rows.push({
    label: "Stdin Closed",
    value: trace.runtime.stdinClosedAt ?? "n/a",
  });
  rows.push({
    label: "First Stderr",
    value: trace.runtime.firstStderrAt ?? "n/a",
  });
  rows.push({
    label: "Exit",
    value: formatRuntimeExitLabel(trace.runtime),
  });
}

function appendExecutionRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace?.execution) {
    return;
  }

  rows.push({
    label: "Execution",
    value: formatExecutionTraceLabel(trace.execution),
  });
  rows.push({
    label: "Phase Entered",
    value: trace.execution.phaseEnteredAt ?? "n/a",
  });
  rows.push({
    label: "Last Lifecycle",
    value: trace.execution.lastLifecycleAt ?? "n/a",
  });
}

function appendOriginRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace?.origin) {
    return;
  }

  const conversationRef =
    trace.origin.agentControllerRef &&
    trace.origin.agentControllerConversationKind &&
    trace.origin.resolvedAgentControllerConversationId
      ? `${trace.origin.agentControllerRef}/${trace.origin.agentControllerConversationKind} · ${trace.origin.resolvedAgentControllerConversationId}`
      : null;

  if (conversationRef) {
    rows.push({
      label: "Agent Controller Conversation",
      value: conversationRef,
    });
  }
  if (trace.origin.agentControllerConversationId) {
    rows.push({
      label: "Origin Context",
      value: trace.origin.agentControllerConversationId,
    });
  }
  if (trace.origin.effectiveRuntimeWorkingDirectory) {
    rows.push({
      label: "Dispatch Effective Runtime Working Directory",
      value: trace.origin.effectiveRuntimeWorkingDirectory,
    });
  }
}

function appendPromptRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace?.prompt) {
    return;
  }

  if (trace.prompt.fingerprint || trace.prompt.length !== null) {
    rows.push({
      label: "Prompt",
      value: formatPromptTraceLabel(trace.prompt),
    });
  }
  if (trace.prompt.preview) {
    rows.push({
      label: "Prompt Preview",
      value: trace.prompt.preview,
    });
  }
}

function appendDispatchExecutionRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace?.dispatchExecution) {
    return;
  }

  rows.push({
    label: "Agent Controller Conversation Resume",
    value: formatDispatchExecutionResumeLabel(trace.dispatchExecution),
  });
  rows.push({
    label: "Local Runtime Context",
    value: formatDispatchExecutionLocalRuntimeLabel(trace.dispatchExecution),
  });
  rows.push({
    label: "Bootstrap",
    value: formatDispatchExecutionBootstrapLabel(trace.dispatchExecution),
  });
}

function buildAgentTraceSummary(input: {
  dispatchId: string;
  trace: DispatchTraceSnapshot;
}): string {
  if (!input.trace) {
    return `dispatch ${input.dispatchId}: not_found`;
  }

  const finalVisibleOutcome = projectSpaceDispatchTraceFinalVisibleOutcome(
    input.trace
  );
  const finalVisibleOutcomeSummary =
    finalVisibleOutcome.status === "not_applicable"
      ? "finalVisibleOutcome=not_applicable"
      : `finalVisibleOutcome=${finalVisibleOutcome.status}`;
  const attemptStatus = input.trace.latestAttempt?.status ?? "none";
  const streamingMode = input.trace.streaming?.streamingMode ?? "final";
  const previewEmitted = input.trace.streaming?.previewEmitted === true;
  const runtimeSummary = input.trace.runtime
    ? ` runtime=${formatRuntimeTraceSummary(input.trace.runtime)}`
    : "";
  const dispatchExecutionSummary = input.trace.dispatchExecution
    ? ` agent_controller_conversation_resume=${input.trace.dispatchExecution.agentControllerConversationResume.status} local_runtime_context=${input.trace.dispatchExecution.localRuntimeContext.status} bootstrap=${input.trace.dispatchExecution.bootstrap.status}`
    : "";
  const resultInboxSummary = input.trace.resultInbox
    ? ` resultInbox=${input.trace.resultInbox.publishState}`
    : "";
  const projectFailureContextSummary = input.trace.resultInbox
    ?.projectFailureContext
    ? ` projectId=${input.trace.resultInbox.projectFailureContext.projectId}${input.trace.resultInbox.projectFailureContext.bindingGeneration ? ` bindingGeneration=${input.trace.resultInbox.projectFailureContext.bindingGeneration}` : ""}`
    : "";
  const headLifecycleSummary = input.trace.runtimeCoordinatorHeadLifecycle
    ? ` head=${formatRuntimeCoordinatorHeadLifecycleSummary(input.trace.runtimeCoordinatorHeadLifecycle)}`
    : "";
  const finalVisibleSummary = input.trace.finalVisibleMessage
    ? ` finalVisible=${input.trace.finalVisibleMessage.signalType}:${input.trace.finalVisibleMessage.signalId}`
    : "";
  const finalVisibleLinkageSummary = input.trace.finalVisibleMessageLinkage
    ? ` finalVisibleLinkage=${input.trace.finalVisibleMessageLinkage.status}`
    : "";
  const nativeDeliverySummary = input.trace.nativeDelivery
    ? ` nativeDelivery=${input.trace.nativeDelivery.status} destination=${formatNativeDeliveryDestination(input.trace.nativeDelivery.destination)} controllerNormalization=${input.trace.nativeDelivery.controllerNormalization.storedAgentControllerRefStatus}`
    : "";
  return `dispatch ${input.trace.dispatch.dispatchId}: ${finalVisibleOutcomeSummary} delivered=${finalVisibleOutcome.delivered ? "true" : "false"} rootCause=${resolveTraceRootCause(input.trace)} status=${input.trace.dispatch.status} latestAttempt=${attemptStatus} streaming=${streamingMode} preview=${previewEmitted ? "emitted" : "none"}${headLifecycleSummary}${resultInboxSummary}${projectFailureContextSummary}${finalVisibleSummary}${finalVisibleLinkageSummary}${nativeDeliverySummary}${runtimeSummary}${dispatchExecutionSummary}`;
}

function buildAgentTraceCompactSummary(input: {
  trace: DispatchTraceSnapshot;
}): ServiceTraceAgentSummary {
  const trace = input.trace;
  if (!trace) {
    return {
      currentState: "not_found",
      delivered: false,
      nextAction: "check the trace selector and rerun trace",
      reasonCode: "wake_trace.dispatch_not_found",
      visibleOutcome: "not_applicable",
    };
  }

  const nativeDeliveryEvidence = trace.nativeDelivery
    ? {
        controllerNormalizationStatus:
          trace.nativeDelivery.controllerNormalization
            .storedAgentControllerRefStatus,
        deliveryDestination: formatNativeDeliveryDestination(
          trace.nativeDelivery.destination
        ),
        runtimeFamily: trace.nativeDelivery.runtimeFamily,
      }
    : {};
  const finalVisibleOutcome =
    projectSpaceDispatchTraceFinalVisibleOutcome(trace);
  if (finalVisibleOutcome.delivered) {
    return {
      ...nativeDeliveryEvidence,
      currentState: "delivered",
      delivered: true,
      nextAction: "none",
      reasonCode: finalVisibleOutcome.reasonCode,
      visibleOutcome: finalVisibleOutcome.status,
    };
  }

  const headLifecycle = trace.runtimeCoordinatorHeadLifecycle;
  if (headLifecycle?.readStatus === "found" && headLifecycle.waitingBoundary) {
    const waitingBoundary = headLifecycle.waitingBoundary;
    return {
      ...nativeDeliveryEvidence,
      currentState: headLifecycle.status,
      delivered: false,
      nextAction:
        WAITING_BOUNDARY_NEXT_ACTION[waitingBoundary.userRecoveryAction],
      reasonCode: waitingBoundary.reasonCode,
      visibleOutcome: finalVisibleOutcome.status,
      waitingBoundary: {
        deadlineAt: waitingBoundary.deadlineAt,
        softDeadlineAt: waitingBoundary.softDeadlineAt,
        userRecoveryAction: waitingBoundary.userRecoveryAction,
        waitingFor: waitingBoundary.waitingFor,
        waitingSince: waitingBoundary.waitingSince,
      },
    };
  }

  if (
    finalVisibleOutcome.status === "publication_pending" ||
    finalVisibleOutcome.status === "publication_retrying"
  ) {
    return {
      ...nativeDeliveryEvidence,
      currentState: "publishing",
      delivered: false,
      nextAction: "wait, then rerun trace with the same selector",
      reasonCode: finalVisibleOutcome.reasonCode,
      visibleOutcome: finalVisibleOutcome.status,
    };
  }

  if (
    shouldExposeFinalVisibleLinkageDiagnostic({
      finalVisibleOutcome,
      trace,
    })
  ) {
    const linkage = trace.finalVisibleMessageLinkage;
    return {
      ...nativeDeliveryEvidence,
      currentState: linkage?.status ?? "linkage_missing",
      delivered: false,
      nextAction: "report this Wake with the Signal ID or diagnostic report",
      reasonCode:
        linkage?.reasonCode ??
        finalVisibleOutcome.reasonCode ??
        "final_visible_message.linkage_missing",
      visibleOutcome: finalVisibleOutcome.status,
    };
  }

  if (finalVisibleOutcome.status === "publication_unresolved") {
    return {
      ...nativeDeliveryEvidence,
      currentState: "not_delivered",
      delivered: false,
      nextAction: "report this Wake with the Signal ID or diagnostic report",
      reasonCode:
        finalVisibleOutcome.publicationErrorCode ??
        finalVisibleOutcome.reasonCode,
      visibleOutcome: finalVisibleOutcome.status,
    };
  }

  const runtimeCoordinatorExecutionStatus =
    trace.runtimeCoordinatorExecution?.status ?? null;
  if (
    finalVisibleOutcome.status === "not_applicable" &&
    runtimeCoordinatorExecutionStatus &&
    TRACE_PRE_RESULT_RUNTIME_COORDINATOR_STATUSES.has(
      runtimeCoordinatorExecutionStatus
    )
  ) {
    return {
      ...nativeDeliveryEvidence,
      currentState: runtimeCoordinatorExecutionStatus,
      delivered: false,
      nextAction: resolveAgentTraceNextAction(trace),
      reasonCode: resolveTraceRootCause(trace),
      visibleOutcome: finalVisibleOutcome.status,
    };
  }

  if (
    finalVisibleOutcome.status === "not_applicable" &&
    trace.finalVisibleMessageLinkage?.status === "projection_pending"
  ) {
    return {
      ...nativeDeliveryEvidence,
      currentState: "final_projection_pending",
      delivered: false,
      nextAction:
        "wait - if the target computer is offline, this Wake is delivered automatically when its OpenMeld Service reconnects; rerun trace with the same selector to confirm",
      reasonCode: trace.finalVisibleMessageLinkage.reasonCode,
      visibleOutcome: finalVisibleOutcome.status,
    };
  }

  return {
    ...nativeDeliveryEvidence,
    currentState: trace.dispatch.status,
    delivered: false,
    nextAction: resolveAgentTraceNextAction(trace),
    reasonCode: resolveTraceRootCause(trace),
    visibleOutcome: finalVisibleOutcome.status,
  };
}

function formatAgentTraceCompactSummary(
  input: ServiceTraceAgentSummary
): string {
  return [
    `delivered=${input.delivered ? "true" : "false"}`,
    `visible_outcome=${input.visibleOutcome}`,
    `current_state=${input.currentState}`,
    input.reasonCode ? `reason=${input.reasonCode}` : null,
    input.waitingBoundary
      ? `waiting_for=${input.waitingBoundary.waitingFor}`
      : null,
    input.waitingBoundary
      ? `waiting_deadline=${input.waitingBoundary.deadlineAt}`
      : null,
    input.waitingBoundary
      ? `recovery_action=${input.waitingBoundary.userRecoveryAction}`
      : null,
    input.waitingBoundary
      ? `waiting_soft_deadline=${input.waitingBoundary.softDeadlineAt}`
      : null,
    input.waitingBoundary
      ? `waiting_since=${input.waitingBoundary.waitingSince}`
      : null,
    input.runtimeFamily ? `runtime_family=${input.runtimeFamily}` : null,
    input.deliveryDestination
      ? `destination=${input.deliveryDestination}`
      : null,
    input.controllerNormalizationStatus
      ? `controller_normalization=${input.controllerNormalizationStatus}`
      : null,
    `next_action=${input.nextAction}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function formatNativeDeliveryDestination(
  destination: NonNullable<
    NonNullable<DispatchTraceSnapshot>["nativeDelivery"]
  >["destination"]
): string {
  return `${destination.conversationKind}:${destination.spaceId}`;
}

function resolveAgentTraceNextAction(
  trace: NonNullable<DispatchTraceSnapshot>
): string {
  if (trace.resultInbox?.publishState === "late_result_available") {
    return "open the Space outcome details and inspect the retained-result evidence; do not retry the Wake";
  }
  const rootCause = resolveTraceRootCause(trace);
  if (rootCause === "none" || rootCause === "ok") {
    return "none";
  }
  if (trace.dispatch.status === "dispatching") {
    return "wait, then rerun trace with the same selector";
  }
  return "inspect the full trace payload and follow the first failing evidence row";
}

function formatRuntimeCoordinatorHeadLifecycleSummary(
  headLifecycle: NonNullable<
    NonNullable<DispatchTraceSnapshot>["runtimeCoordinatorHeadLifecycle"]
  >
): string {
  if (headLifecycle.readStatus !== "found") {
    return `${headLifecycle.readStatus}:${headLifecycle.reasonCode}`;
  }
  const noExecutionReason =
    headLifecycle.noExecutionDecision?.reasonCode ??
    headLifecycle.publicationIntent?.reasonCode ??
    headLifecycle.waitingBoundary?.reasonCode ??
    null;
  return `${headLifecycle.status}${noExecutionReason ? `:${noExecutionReason}` : ""}`;
}

function resolveTraceRootCause(
  trace: NonNullable<DispatchTraceSnapshot>
): string {
  return resolveSpaceDispatchTraceRootCause(trace);
}

function resolveRuntimeCoordinatorHeadStatusRootCause(status: string): string {
  if (status === "accepted") {
    return "runtime_coordinator.head_accepted";
  }
  if (status === "execution_linked") {
    return "runtime_coordinator.head_execution_linked";
  }
  if (status === "waiting") {
    return "runtime_coordinator.head_waiting";
  }
  return "runtime_coordinator.head_publication_intent_ready";
}

const PRE_EXECUTION_NO_EXECUTION_EVIDENCE_REASON_CODES = new Set([
  "local_service.identity_mismatch",
]);

function resolvePreExecutionNoExecutionEvidenceRootCause(
  trace: DispatchTraceSnapshot
): string | null {
  const headLifecycle = trace?.runtimeCoordinatorHeadLifecycle;
  if (
    !trace ||
    trace.runtimeCoordinatorExecution ||
    headLifecycle?.readStatus !== "found" ||
    headLifecycle.runtimeCoordinatorExecutionId ||
    headLifecycle.waitingBoundary
  ) {
    return null;
  }

  const authoritativeHeadReason =
    headLifecycle.noExecutionDecision?.reasonCode ??
    headLifecycle.publicationIntent?.reasonCode ??
    null;
  return authoritativeHeadReason &&
    PRE_EXECUTION_NO_EXECUTION_EVIDENCE_REASON_CODES.has(
      authoritativeHeadReason
    )
    ? authoritativeHeadReason
    : null;
}

function formatAttemptError(
  errorCode: string,
  errorMessage: string | null
): string {
  return errorMessage ? `${errorCode} (${errorMessage})` : errorCode;
}

function formatOpsDecisionSummary(
  items: SpaceDispatchTraceOpsDecision[]
): string {
  if (items.length === 0) {
    return "none";
  }
  return items
    .slice(0, 3)
    .map((item) => item.decisionCode)
    .join(", ");
}

function formatDaemonDispatchJournalSummary(
  events: DaemonDispatchJournalEvent[]
): string {
  if (events.length === 0) {
    return "none";
  }
  return events
    .slice(-8)
    .map((event) => {
      const attempt = event.attemptId ? `/${event.attemptId}` : "";
      const connection =
        typeof event.connectionGeneration === "number"
          ? `@connection ${event.connectionGeneration}`
          : "";
      return `${formatDaemonDispatchJournalEventType(event)}${attempt}${connection}`;
    })
    .join(", ");
}

function formatDaemonDispatchJournalEventType(
  event: DaemonDispatchJournalEvent
): string {
  const phase =
    event.type === "dispatch.local.phase" &&
    event.metadata &&
    typeof event.metadata.phase === "string" &&
    event.metadata.phase.length > 0
      ? event.metadata.phase
      : null;
  return phase ? `${event.type}:${phase}` : event.type;
}

function resolveLatestAttemptLabel(input: {
  latestAttempt: NonNullable<
    NonNullable<DispatchTraceSnapshot>["latestAttempt"]
  >;
  recentOpsDecisions: SpaceDispatchTraceOpsDecision[];
}): string {
  return `${input.latestAttempt.status} · no.${input.latestAttempt.attemptNo}`;
}

function resolveTraceReason(
  items: SpaceDispatchTraceOpsDecision[]
): string | null {
  const latestRelevantDecision = items.find((item) => {
    return (
      item.decisionCode === "dispatch.attempt.still_owned" ||
      item.decisionCode === "daemon.delivery.route_lost_redrive" ||
      item.decisionCode === "daemon.delivery.connection_replaced_redrive" ||
      item.decisionCode === "daemon.delivery.session_replaced"
    );
  });
  if (!latestRelevantDecision) {
    return null;
  }
  switch (latestRelevantDecision.decisionCode) {
    case "dispatch.attempt.still_owned":
      return "still_owned";
    case "daemon.delivery.route_lost_redrive":
      return "route_lost_redrive";
    case "daemon.delivery.connection_replaced_redrive":
      return "connection_replaced_redrive";
    case "daemon.delivery.session_replaced":
      return "session_replaced";
    default:
      return latestRelevantDecision.decisionCode;
  }
}

function formatExecutionTraceLabel(
  execution: NonNullable<NonNullable<DispatchTraceSnapshot>["execution"]>
): string {
  const waitWindow =
    execution.timeoutPolicy.waitWindowMs === null
      ? "n/a"
      : `${String(execution.timeoutPolicy.waitWindowMs)}ms`;
  const progressEvidence = `${execution.progressEvidenceState} progress evidence`;
  return `${execution.phase} · ${progressEvidence} · wait ${waitWindow}`;
}

function appendStructuredActionFailureRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace?.structuredActionFailure) {
    return;
  }

  rows.push({
    label: "Structured Action",
    value: formatStructuredActionFailureLabel(trace.structuredActionFailure),
  });
  if (trace.structuredActionFailure.publicFailureReason) {
    rows.push({
      label: "Public Failure Reason",
      value: trace.structuredActionFailure.publicFailureReason,
    });
  }
  if (trace.structuredActionFailure.spaceActionParseError) {
    rows.push({
      label: "Action Parse Error",
      value: trace.structuredActionFailure.spaceActionParseError,
    });
  }
  if (trace.structuredActionFailure.invalidOutputPreview) {
    rows.push({
      label: "Invalid Output",
      value: trace.structuredActionFailure.invalidOutputPreview,
    });
  }
}

function formatStreamingTraceLabel(
  streaming: NonNullable<NonNullable<DispatchTraceSnapshot>["streaming"]>
): string {
  return `${streaming.streamingMode} · preview ${streaming.previewEmitted ? "emitted" : "not_emitted"}`;
}

function formatDispatchExecutionResumeLabel(
  dispatchExecution: NonNullable<
    NonNullable<DispatchTraceSnapshot>["dispatchExecution"]
  >
): string {
  return dispatchExecution.agentControllerConversationResume.status;
}

function formatDispatchExecutionLocalRuntimeLabel(
  dispatchExecution: NonNullable<
    NonNullable<DispatchTraceSnapshot>["dispatchExecution"]
  >
): string {
  const reason = dispatchExecution.localRuntimeContext.reason;
  return reason
    ? `${dispatchExecution.localRuntimeContext.status} · ${reason}`
    : dispatchExecution.localRuntimeContext.status;
}

function formatDispatchExecutionBootstrapLabel(
  dispatchExecution: NonNullable<
    NonNullable<DispatchTraceSnapshot>["dispatchExecution"]
  >
): string {
  const reason = dispatchExecution.bootstrap.reason;
  return reason
    ? `${dispatchExecution.bootstrap.status} · ${reason}`
    : dispatchExecution.bootstrap.status;
}

function formatStructuredActionFailureLabel(
  failure: NonNullable<
    NonNullable<DispatchTraceSnapshot>["structuredActionFailure"]
  >
): string {
  return `${failure.carrierKind} · ${failure.repairMode}`;
}

function appendOpenClawGatewayVisibilityRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace?.openClawGatewayVisibility) {
    return;
  }

  rows.push({
    label: "OpenClaw Gateway",
    value: `${trace.openClawGatewayVisibility.gatewayVisibility} · restart ${trace.openClawGatewayVisibility.gatewayRestartAttempted ? "attempted" : "not_needed"}`,
  });
  rows.push({
    label: "OpenClaw Agent",
    value: trace.openClawGatewayVisibility.agentId,
  });
}

function appendOpenClawBindingRows(
  rows: Array<{ label: string; value: string }>,
  trace: DispatchTraceSnapshot
): void {
  if (!trace?.openClawBinding) {
    return;
  }

  rows.push({
    label: "Binding Classification",
    value: trace.openClawBinding.classification,
  });
  rows.push({
    label: "Binding Source",
    value: trace.openClawBinding.bindingSource ?? "n/a",
  });
  rows.push({
    label: "Binding Upgrade",
    value: formatOpenClawBindingUpgradeDisplay(trace),
  });
}

function formatOpenClawBindingUpgradeDisplay(
  trace: DispatchTraceSnapshot
): string {
  if (!trace?.openClawBinding) {
    return "not_applied";
  }
  if (trace.openClawBinding.upgradeApplied) {
    return "applied";
  }
  if (
    trace.dispatch.status === "failed_terminal" ||
    trace.dispatch.status === "failed_retryable"
  ) {
    return "not_applied (dispatch_failed)";
  }
  return "not_applied";
}

function formatPromptTraceLabel(
  prompt: NonNullable<NonNullable<DispatchTraceSnapshot>["prompt"]>
): string {
  const fingerprint = prompt.fingerprint ?? "n/a";
  const length =
    prompt.length === null ? "n/a" : `${String(prompt.length)} chars`;
  return `${fingerprint} · ${length}`;
}

function formatRuntimeTraceLabel(
  runtime: NonNullable<NonNullable<DispatchTraceSnapshot>["runtime"]>
): string {
  const processLabel =
    runtime.processId === null
      ? "pid unknown"
      : `pid ${String(runtime.processId)}`;
  const timeoutLabel = runtime.timeoutTriggeredAt
    ? "timeout_triggered"
    : "no_timeout";
  return `${processLabel} · ${timeoutLabel}`;
}

function formatRuntimeExitLabel(
  runtime: NonNullable<NonNullable<DispatchTraceSnapshot>["runtime"]>
): string {
  if (!runtime.exitObservedAt) {
    return "n/a";
  }
  const exitCode =
    runtime.exitCode === null ? "null" : String(runtime.exitCode);
  const exitSignal = runtime.exitSignal ?? "none";
  return `${runtime.exitObservedAt} · code ${exitCode} · signal ${exitSignal}`;
}

function formatRuntimeTraceSummary(
  runtime: NonNullable<NonNullable<DispatchTraceSnapshot>["runtime"]>
): string {
  const processLabel =
    runtime.processId === null
      ? "pid:unknown"
      : `pid:${String(runtime.processId)}`;
  if (runtime.timeoutTriggeredAt) {
    return `${processLabel}/timeout`;
  }
  if (runtime.exitObservedAt) {
    return `${processLabel}/exited`;
  }
  if (runtime.processSpawnedAt) {
    return `${processLabel}/spawned`;
  }
  return `${processLabel}/pending`;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
