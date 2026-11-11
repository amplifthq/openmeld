import type {
  OpenMeldDaemonProviderAccessEvidenceProvider,
  RuntimeProviderConversationProofMethod,
} from "@openmeld/schemas/types";
import type { AgentProfileBindingDisplayProjection } from "./agent-profile-binding";
import type { PrepareReadinessSummary } from "./prepare-readiness";

export type AgentExecutionDisplayState =
  | "ready"
  | "not_ready"
  | "blocked"
  | "unknown";

export type AgentExecutionPrimaryAction =
  | "none"
  | "connect_service"
  | "reconnect_binding"
  | "run_prepare"
  | "update_service"
  | "check_status"
  | "fix_provider_account";

export type AgentExecutionClaimDiagnosticEvidence =
  | {
      reasonCodes?: readonly string[];
      status: "accepted" | "not_checked";
    }
  | {
      reasonCodes: readonly string[];
      status: "missing" | "mismatch" | "rejected" | "unavailable";
    };

export type AgentExecutionBindingEvidence =
  | AgentProfileBindingDisplayProjection
  | {
      reasonCodes?: readonly string[];
      status: "not_checked";
    }
  | {
      reasonCodes: readonly string[];
      status: "unavailable";
    };

export type AgentExecutionRouteEvidence =
  | {
      deviceId?: string | null;
      lane?: string | null;
      observedAt?: string | null;
      reasonCodes?: readonly string[];
      source?: "daemon_route" | "hosted_route";
      status: "online";
    }
  | {
      deviceId?: string | null;
      lane?: string | null;
      observedAt?: string | null;
      reasonCodes: readonly string[];
      source?: "daemon_route" | "hosted_route" | "not_checked";
      status: "offline" | "unavailable";
    };

export type AgentExecutionLocalServiceEvidence = {
  reachable: boolean;
  refreshable: boolean;
  reasonCodes: readonly string[];
  source: "runtime_transport" | "not_checked" | "unavailable";
};

export type AgentExecutionServiceEvidence = {
  executionCompatible: boolean;
  expectedEpoch: string;
  observedEpoch: string | null;
  reasonCodes: readonly string[];
  source: "runtime_transport" | "not_checked" | "unavailable";
};

export type AgentExecutionProfileEvidence = {
  active: boolean;
  reasonCodes: readonly string[];
  source: "not_checked" | "profile_identity" | "unavailable";
};

export type AgentExecutionProviderAccountEvidence = {
  blocked: boolean;
  expiresAtMs: number;
  observedAtMs: number;
  provider: OpenMeldDaemonProviderAccessEvidenceProvider;
  reasonCodes: readonly string[];
  source: "wake_failure";
};

export type AgentExecutionProviderConversationEvidence = {
  agentControllerConversationId: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  errorType?: string | null;
  expiresAtMs: number | null;
  method: RuntimeProviderConversationProofMethod | null;
  observedAtMs: number | null;
  provider: "codex" | null;
  ready: boolean;
  reasonCodes: readonly string[];
  required: boolean;
  source: "not_required" | "runtime_reporting" | "unavailable";
  status: "failed" | "missing" | "not_required" | "passed" | "unavailable";
};

export type AgentExecutionReadinessImpactEvidence = {
  blocked: boolean;
  expiresAtMs: number;
  impactKind: "local_execution";
  observedAtMs: number;
  reasonCodes: readonly string[];
  source: "wake_failure";
};

export type AgentExecutionStatusInput = {
  agentProfileId: string;
  binding?: AgentExecutionBindingEvidence | null;
  claimDiagnostics?: AgentExecutionClaimDiagnosticEvidence | null;
  executionFamily?: "native" | "workstation" | "unknown";
  localService?: AgentExecutionLocalServiceEvidence | null;
  profile?: AgentExecutionProfileEvidence | null;
  providerAccount?: AgentExecutionProviderAccountEvidence | null;
  providerConversation?: AgentExecutionProviderConversationEvidence | null;
  readinessImpact?: AgentExecutionReadinessImpactEvidence | null;
  route?: AgentExecutionRouteEvidence | null;
  runtimeReadiness?: PrepareReadinessSummary | null;
  service?: AgentExecutionServiceEvidence | null;
};

export type AgentExecutionStatusProjection = {
  agentProfileId: string;
  displayState: AgentExecutionDisplayState;
  facts: {
    profile: {
      active: boolean;
      reasonCodes: readonly string[];
      source: "not_checked" | "profile_identity" | "unavailable";
    };
    binding: {
      reasonCodes: readonly string[];
      routable: boolean;
      source:
        | "binding_truth"
        | "blocked"
        | "missing"
        | "not_checked"
        | "unavailable";
    };
    claim: {
      executionBlocked: boolean;
      grantsClaimSuccess: false;
      reasonCodes: readonly string[];
      source: "claim_diagnostics" | "not_checked";
    };
    providerAccount: {
      blocked: boolean;
      expiresAtMs: number | null;
      observedAtMs: number | null;
      provider: OpenMeldDaemonProviderAccessEvidenceProvider | null;
      reasonCodes: readonly string[];
      source: "not_checked" | "wake_failure";
    };
    providerConversation: {
      agentControllerConversationId: string | null;
      errorCode: string | null;
      errorMessage: string | null;
      errorType: string | null;
      expiresAtMs: number | null;
      method: RuntimeProviderConversationProofMethod | null;
      observedAtMs: number | null;
      provider: "codex" | null;
      ready: boolean;
      reasonCodes: readonly string[];
      required: boolean;
      source: "not_required" | "runtime_reporting" | "unavailable";
      status: "failed" | "missing" | "not_required" | "passed" | "unavailable";
    };
    readinessImpact: {
      blocked: boolean;
      expiresAtMs: number | null;
      impactKind: "local_execution" | null;
      observedAtMs: number | null;
      reasonCodes: readonly string[];
      source: "not_checked" | "wake_failure";
    };
    localService: {
      reachable: boolean;
      refreshable: boolean;
      reasonCodes: readonly string[];
      source: "runtime_transport" | "not_checked" | "unavailable";
    };
    service: {
      executionCompatible: boolean;
      expectedEpoch: string;
      observedEpoch: string | null;
      reasonCodes: readonly string[];
      source: "runtime_transport" | "not_checked" | "unavailable";
    };
    route: {
      deviceId: string | null;
      lane: string | null;
      observedAt: string | null;
      online: boolean;
      reasonCodes: readonly string[];
      source: "daemon_route" | "hosted_route" | "missing" | "not_checked";
    };
    runtime: {
      ready: boolean;
      reasonCodes: readonly string[];
      source:
        | "missing"
        | "native_runtime"
        | "not_checked"
        | "prepare_readiness";
    };
  };
  primaryAction: AgentExecutionPrimaryAction;
  reasonCodes: readonly string[];
};

export type AgentExecutionSelfHealingReadinessInput = Pick<
  AgentExecutionStatusProjection,
  "facts" | "primaryAction" | "reasonCodes"
>;

export function resolveAgentExecutionStatus(
  input: AgentExecutionStatusInput
): AgentExecutionStatusProjection {
  const executionFamily = input.executionFamily ?? "workstation";
  const profile = resolveProfileFact(input.profile);
  const binding = resolveBindingFact({
    agentProfileId: input.agentProfileId,
    binding: input.binding,
  });
  const claim = resolveClaimFact(input.claimDiagnostics);
  const providerAccount = resolveProviderAccountFact(input.providerAccount);
  const providerConversation = resolveProviderConversationFact(
    input.providerConversation
  );
  const readinessImpact = resolveReadinessImpactFact(input.readinessImpact);
  const route = resolveRouteFact(
    executionFamily === "unknown"
      ? { status: "unavailable", source: "not_checked", reasonCodes: [] }
      : input.route
  );
  const localService = resolveLocalServiceFact({
    localService: executionFamily === "workstation" ? input.localService : null,
    routeOnline: executionFamily === "workstation" && route.online,
  });
  const service = resolveServiceFact(
    executionFamily === "workstation"
      ? input.service
      : {
          executionCompatible: true,
          expectedEpoch: input.service?.expectedEpoch ?? "",
          observedEpoch: null,
          reasonCodes: [],
          source: "not_checked",
        }
  );
  const runtime = resolveRuntimeFact({
    executionFamily,
    runtimeReadiness: input.runtimeReadiness,
    service,
  });
  const reasonCodes = uniqueReasonCodes([
    ...profile.reasonCodes,
    ...binding.reasonCodes,
    ...localService.reasonCodes,
    ...service.reasonCodes,
    ...runtime.reasonCodes,
    ...claim.reasonCodes,
    ...route.reasonCodes,
  ]);

  const displayState = resolveDisplayState({
    bindingBlocked: binding.source === "blocked",
    bindingRoutable: binding.routable,
    claimBlocked: claim.executionBlocked,
    executionFamily,
    localServiceReachable: localService.reachable,
    profile,
    routeOnline: route.online,
    runtimeReady: runtime.ready,
    serviceExecutionCompatible: service.executionCompatible,
  });

  return {
    agentProfileId: input.agentProfileId,
    displayState,
    facts: {
      profile,
      binding,
      claim,
      providerAccount,
      providerConversation,
      readinessImpact,
      localService,
      service,
      route,
      runtime,
    },
    primaryAction: resolvePrimaryAction({
      binding,
      claim,
      displayState,
      executionFamily,
      localService,
      profile,
      providerAccount,
      providerConversation,
      readinessImpact,
      route,
      runtime,
      service,
    }),
    reasonCodes,
  };
}

function resolveProviderConversationFact(
  providerConversation:
    | AgentExecutionProviderConversationEvidence
    | null
    | undefined
): AgentExecutionStatusProjection["facts"]["providerConversation"] {
  if (!providerConversation) {
    return {
      agentControllerConversationId: null,
      errorCode: null,
      errorMessage: null,
      errorType: null,
      expiresAtMs: null,
      method: null,
      observedAtMs: null,
      provider: null,
      ready: true,
      reasonCodes: [],
      required: false,
      source: "not_required",
      status: "not_required",
    };
  }
  return {
    agentControllerConversationId:
      providerConversation.agentControllerConversationId,
    errorCode: providerConversation.errorCode ?? null,
    errorMessage: providerConversation.errorMessage ?? null,
    errorType: providerConversation.errorType ?? null,
    expiresAtMs: providerConversation.expiresAtMs,
    method: providerConversation.method,
    observedAtMs: providerConversation.observedAtMs,
    provider: providerConversation.provider,
    ready: providerConversation.ready,
    reasonCodes: providerConversation.reasonCodes,
    required: providerConversation.required,
    source: providerConversation.source,
    status: providerConversation.status,
  };
}

function resolveProviderAccountFact(
  providerAccount: AgentExecutionProviderAccountEvidence | null | undefined
): AgentExecutionStatusProjection["facts"]["providerAccount"] {
  if (!providerAccount) {
    return {
      blocked: false,
      expiresAtMs: null,
      observedAtMs: null,
      provider: null,
      reasonCodes: [],
      source: "not_checked",
    };
  }
  return {
    blocked: providerAccount.blocked,
    expiresAtMs: providerAccount.expiresAtMs,
    observedAtMs: providerAccount.observedAtMs,
    provider: providerAccount.provider,
    reasonCodes: providerAccount.reasonCodes,
    source: providerAccount.source,
  };
}

function resolveReadinessImpactFact(
  readinessImpact: AgentExecutionReadinessImpactEvidence | null | undefined
): AgentExecutionStatusProjection["facts"]["readinessImpact"] {
  if (!readinessImpact) {
    return {
      blocked: false,
      expiresAtMs: null,
      impactKind: null,
      observedAtMs: null,
      reasonCodes: [],
      source: "not_checked",
    };
  }
  return {
    blocked: readinessImpact.blocked,
    expiresAtMs: readinessImpact.expiresAtMs,
    impactKind: readinessImpact.impactKind,
    observedAtMs: readinessImpact.observedAtMs,
    reasonCodes: readinessImpact.reasonCodes,
    source: readinessImpact.source,
  };
}

function resolveProfileFact(
  profile: AgentExecutionProfileEvidence | null | undefined
): AgentExecutionStatusProjection["facts"]["profile"] {
  if (profile) {
    return {
      active: profile.active,
      reasonCodes: profile.reasonCodes,
      source: profile.source,
    };
  }
  return {
    active: true,
    reasonCodes: [],
    source: "not_checked",
  };
}

function resolveLocalServiceFact(input: {
  localService: AgentExecutionLocalServiceEvidence | null | undefined;
  routeOnline: boolean;
}): AgentExecutionStatusProjection["facts"]["localService"] {
  if (input.localService) {
    return {
      reachable: input.localService.reachable,
      refreshable: input.localService.refreshable,
      reasonCodes: input.localService.reasonCodes,
      source: input.localService.source,
    };
  }

  if (input.routeOnline) {
    return {
      reachable: true,
      refreshable: true,
      reasonCodes: [],
      source: "runtime_transport",
    };
  }

  return {
    reachable: false,
    refreshable: false,
    reasonCodes: [],
    source: "not_checked",
  };
}

function resolveServiceFact(
  service: AgentExecutionServiceEvidence | null | undefined
): AgentExecutionStatusProjection["facts"]["service"] {
  if (service) {
    return {
      executionCompatible: service.executionCompatible,
      expectedEpoch: service.expectedEpoch,
      observedEpoch: service.observedEpoch,
      reasonCodes: service.reasonCodes,
      source: service.source,
    };
  }

  return {
    executionCompatible: true,
    expectedEpoch: "",
    observedEpoch: null,
    reasonCodes: [],
    source: "not_checked",
  };
}

function resolveBindingFact(input: {
  agentProfileId: string;
  binding: AgentExecutionBindingEvidence | null | undefined;
}): AgentExecutionStatusProjection["facts"]["binding"] {
  const { agentProfileId, binding } = input;
  if (!binding) {
    return {
      reasonCodes: ["agent_profile_binding.missing"],
      routable: false,
      source: "missing",
    };
  }
  if (isNotCheckedBindingEvidence(binding)) {
    return {
      reasonCodes: binding.reasonCodes ?? [],
      routable: false,
      source: "not_checked",
    };
  }
  if (isUnavailableBindingEvidence(binding)) {
    return {
      reasonCodes: binding.reasonCodes,
      routable: false,
      source: "unavailable",
    };
  }
  if (binding.agentProfileId !== agentProfileId) {
    return {
      reasonCodes: ["agent_execution.binding_agent_profile_mismatch"],
      routable: false,
      source: "blocked",
    };
  }
  if (
    binding.authoritySource === "binding_truth" &&
    binding.bindingState === "enabled_primary" &&
    binding.dispatchEligibility.routable
  ) {
    return {
      reasonCodes: binding.reasonCodes,
      routable: true,
      source: "binding_truth",
    };
  }
  return {
    reasonCodes: binding.reasonCodes,
    routable: false,
    source: "blocked",
  };
}

function isNotCheckedBindingEvidence(
  binding: AgentExecutionBindingEvidence
): binding is Extract<
  AgentExecutionBindingEvidence,
  { status: "not_checked" }
> {
  return "status" in binding && binding.status === "not_checked";
}

function isUnavailableBindingEvidence(
  binding: AgentExecutionBindingEvidence
): binding is Extract<
  AgentExecutionBindingEvidence,
  { status: "unavailable" }
> {
  return "status" in binding && binding.status === "unavailable";
}

function resolveRuntimeFact(input: {
  executionFamily: "native" | "workstation" | "unknown";
  runtimeReadiness: PrepareReadinessSummary | null | undefined;
  service: AgentExecutionStatusProjection["facts"]["service"];
}): AgentExecutionStatusProjection["facts"]["runtime"] {
  const { executionFamily, runtimeReadiness, service } = input;
  if (executionFamily === "unknown") {
    return { ready: false, reasonCodes: [], source: "not_checked" };
  }
  if (!runtimeReadiness) {
    if (executionFamily === "native") {
      return {
        ready: false,
        reasonCodes: [],
        source: "not_checked",
      };
    }
    return {
      ready: false,
      reasonCodes: ["runtime.projection_missing"],
      source: "missing",
    };
  }
  return {
    ready:
      executionFamily === "native"
        ? runtimeReadiness.ready
        : runtimeReadiness.ready ||
          (service.executionCompatible &&
            hasOnlyAdvisoryServiceDriftReason(runtimeReadiness.reasonCodes)),
    reasonCodes: runtimeReadiness.reasonCodes,
    source:
      executionFamily === "native" ? "native_runtime" : "prepare_readiness",
  };
}

function resolveClaimFact(
  claimDiagnostics: AgentExecutionClaimDiagnosticEvidence | null | undefined
): AgentExecutionStatusProjection["facts"]["claim"] {
  if (!claimDiagnostics || claimDiagnostics.status === "not_checked") {
    return {
      executionBlocked: false,
      grantsClaimSuccess: false,
      reasonCodes: [],
      source: "not_checked",
    };
  }
  const reasonCodes = claimDiagnostics.reasonCodes ?? [];
  if (claimDiagnostics.status === "accepted") {
    return {
      executionBlocked: false,
      grantsClaimSuccess: false,
      reasonCodes,
      source: "claim_diagnostics",
    };
  }
  return {
    executionBlocked: true,
    grantsClaimSuccess: false,
    reasonCodes,
    source: "claim_diagnostics",
  };
}

function resolveRouteFact(
  route: AgentExecutionRouteEvidence | null | undefined
): AgentExecutionStatusProjection["facts"]["route"] {
  if (!route) {
    return {
      deviceId: null,
      lane: null,
      observedAt: null,
      online: false,
      reasonCodes: ["agent_execution.route_missing"],
      source: "missing",
    };
  }

  if (route.status === "online") {
    return {
      deviceId: route.deviceId?.trim() || null,
      lane: route.lane?.trim() || null,
      observedAt: route.observedAt?.trim() || null,
      online: true,
      reasonCodes: route.reasonCodes ?? [],
      source: route.source ?? "daemon_route",
    };
  }

  return {
    deviceId: route.deviceId?.trim() || null,
    lane: route.lane?.trim() || null,
    observedAt: route.observedAt?.trim() || null,
    online: false,
    reasonCodes: route.reasonCodes,
    source: route.source ?? "daemon_route",
  };
}

function resolveDisplayState(input: {
  bindingBlocked: boolean;
  bindingRoutable: boolean;
  claimBlocked: boolean;
  executionFamily: "native" | "workstation" | "unknown";
  localServiceReachable: boolean;
  profile: AgentExecutionStatusProjection["facts"]["profile"];
  routeOnline: boolean;
  runtimeReady: boolean;
  serviceExecutionCompatible: boolean;
}): AgentExecutionDisplayState {
  if (input.profile.source === "unavailable") {
    return "unknown";
  }
  if (!input.profile.active) {
    return "blocked";
  }
  if (input.bindingBlocked) {
    return "blocked";
  }
  if (input.bindingRoutable && !input.serviceExecutionCompatible) {
    return "blocked";
  }
  if (input.claimBlocked) {
    return "blocked";
  }
  if (input.executionFamily === "unknown") {
    return "unknown";
  }
  if (
    input.bindingRoutable &&
    (input.executionFamily === "native" || input.localServiceReachable) &&
    input.serviceExecutionCompatible &&
    input.runtimeReady &&
    input.routeOnline
  ) {
    return "ready";
  }
  return "not_ready";
}

function resolvePrimaryAction(input: {
  binding: AgentExecutionStatusProjection["facts"]["binding"];
  claim: AgentExecutionStatusProjection["facts"]["claim"];
  displayState: AgentExecutionDisplayState;
  executionFamily: "native" | "workstation" | "unknown";
  localService: AgentExecutionStatusProjection["facts"]["localService"];
  profile: AgentExecutionStatusProjection["facts"]["profile"];
  providerAccount: AgentExecutionStatusProjection["facts"]["providerAccount"];
  providerConversation: AgentExecutionStatusProjection["facts"]["providerConversation"];
  readinessImpact: AgentExecutionStatusProjection["facts"]["readinessImpact"];
  route: AgentExecutionStatusProjection["facts"]["route"];
  runtime: AgentExecutionStatusProjection["facts"]["runtime"];
  service: AgentExecutionStatusProjection["facts"]["service"];
}): AgentExecutionPrimaryAction {
  if (input.displayState === "ready") {
    return "none";
  }
  if (!input.profile.active || input.profile.source === "unavailable") {
    return "check_status";
  }
  // An unreadable target is not a workstation. Native binding failures also
  // cannot be repaired by connecting a local Service.
  if (input.executionFamily !== "workstation") {
    return "check_status";
  }
  if (!input.binding.routable) {
    return input.binding.source === "unavailable" ||
      input.binding.source === "not_checked"
      ? "check_status"
      : "reconnect_binding";
  }
  const serviceAction = resolveServicePrimaryAction(input);
  if (serviceAction) {
    return serviceAction;
  }
  return resolveRuntimeRoutePrimaryAction(input);
}

function resolveServicePrimaryAction(input: {
  binding: AgentExecutionStatusProjection["facts"]["binding"];
  claim: AgentExecutionStatusProjection["facts"]["claim"];
  displayState: AgentExecutionDisplayState;
  localService: AgentExecutionStatusProjection["facts"]["localService"];
  profile: AgentExecutionStatusProjection["facts"]["profile"];
  providerAccount: AgentExecutionStatusProjection["facts"]["providerAccount"];
  providerConversation: AgentExecutionStatusProjection["facts"]["providerConversation"];
  readinessImpact: AgentExecutionStatusProjection["facts"]["readinessImpact"];
  route: AgentExecutionStatusProjection["facts"]["route"];
  runtime: AgentExecutionStatusProjection["facts"]["runtime"];
  service: AgentExecutionStatusProjection["facts"]["service"];
}): AgentExecutionPrimaryAction | null {
  if (
    !input.service.executionCompatible ||
    hasServiceUpdateRequiredReason(input.service.reasonCodes)
  ) {
    return "update_service";
  }
  if (hasServiceUpdateRequiredReason(input.runtime.reasonCodes)) {
    return "update_service";
  }
  if (
    hasBindingReconnectReason(input.localService.reasonCodes) ||
    (input.claim.executionBlocked &&
      hasBindingReconnectReason(input.claim.reasonCodes))
  ) {
    return "reconnect_binding";
  }
  if (
    hasServiceConnectionReason(input.localService.reasonCodes) ||
    hasServiceConnectionReason(input.service.reasonCodes) ||
    (input.claim.executionBlocked &&
      hasServiceConnectionReason(input.claim.reasonCodes))
  ) {
    return "connect_service";
  }
  return null;
}

function resolveRuntimeRoutePrimaryAction(input: {
  binding: AgentExecutionStatusProjection["facts"]["binding"];
  claim: AgentExecutionStatusProjection["facts"]["claim"];
  displayState: AgentExecutionDisplayState;
  localService: AgentExecutionStatusProjection["facts"]["localService"];
  profile: AgentExecutionStatusProjection["facts"]["profile"];
  providerAccount: AgentExecutionStatusProjection["facts"]["providerAccount"];
  providerConversation: AgentExecutionStatusProjection["facts"]["providerConversation"];
  readinessImpact: AgentExecutionStatusProjection["facts"]["readinessImpact"];
  route: AgentExecutionStatusProjection["facts"]["route"];
  runtime: AgentExecutionStatusProjection["facts"]["runtime"];
  service: AgentExecutionStatusProjection["facts"]["service"];
}): AgentExecutionPrimaryAction {
  if (!(input.localService.reachable || input.route.online)) {
    return "run_prepare";
  }
  if (
    input.runtime.reasonCodes.some(
      (reason) =>
        reason === "usage_exhausted" ||
        reason === "model.retired" ||
        reason === "model.unavailable"
    )
  ) {
    return "check_status";
  }
  if (!input.runtime.ready) {
    return resolveRuntimeNotReadyPrimaryAction({
      localService: input.localService,
      runtime: input.runtime,
    });
  }
  if (!input.route.online) {
    return input.localService.refreshable ? "check_status" : "run_prepare";
  }
  if (input.claim.executionBlocked) {
    return resolveBlockedClaimPrimaryAction({
      claim: input.claim,
      localService: input.localService,
      runtime: input.runtime,
      service: input.service,
    });
  }
  return "check_status";
}

function resolveBlockedClaimPrimaryAction(input: {
  claim: AgentExecutionStatusProjection["facts"]["claim"];
  localService: AgentExecutionStatusProjection["facts"]["localService"];
  runtime: AgentExecutionStatusProjection["facts"]["runtime"];
  service: AgentExecutionStatusProjection["facts"]["service"];
}): AgentExecutionPrimaryAction {
  const claimAndRuntimeReasonCodes = [
    ...input.claim.reasonCodes,
    ...input.runtime.reasonCodes,
    ...input.service.reasonCodes,
  ];
  if (hasServiceUpdateRequiredReason(claimAndRuntimeReasonCodes)) {
    return "update_service";
  }
  if (hasServiceConnectionReason(input.claim.reasonCodes)) {
    return "connect_service";
  }
  if (
    hasRuntimeAgentControllerReportRefreshReason(claimAndRuntimeReasonCodes) &&
    input.localService.refreshable
  ) {
    return "check_status";
  }
  if (hasBindingReconnectReason(input.claim.reasonCodes)) {
    return "reconnect_binding";
  }
  if (hasSetupRepairReason(input.claim.reasonCodes)) {
    return "run_prepare";
  }
  return "run_prepare";
}

function hasBindingReconnectReason(reasonCodes: readonly string[]): boolean {
  return reasonCodes.some((reasonCode) => {
    return (
      reasonCode === "claim_eligibility.binding_capability_mismatch" ||
      reasonCode === "claim_eligibility.binding_owner_mismatch" ||
      reasonCode === "claim_eligibility.binding_runtime_mismatch" ||
      reasonCode === "claim_eligibility.owner_mismatch" ||
      reasonCode === "claim_eligibility.openmeld_service_runtime_id_mismatch" ||
      reasonCode === "local_service.identity_mismatch"
    );
  });
}

function hasServiceConnectionReason(reasonCodes: readonly string[]): boolean {
  return reasonCodes.some(
    (reasonCode) =>
      reasonCode === "local_service.not_connected_for_account" ||
      reasonCode === "service.current_runtime_session_missing" ||
      reasonCode === "daemon.session.not_found"
  );
}

function resolveRuntimeNotReadyPrimaryAction(input: {
  localService: AgentExecutionStatusProjection["facts"]["localService"];
  runtime: AgentExecutionStatusProjection["facts"]["runtime"];
}): AgentExecutionPrimaryAction {
  if (
    input.runtime.reasonCodes.some((reasonCode) =>
      reasonCode.startsWith("working_folder.")
    )
  ) {
    return "check_status";
  }
  if (
    hasRuntimeAgentControllerReportRefreshReason(input.runtime.reasonCodes) &&
    input.localService.refreshable
  ) {
    return "check_status";
  }
  return "run_prepare";
}

function hasRuntimeAgentControllerReportRefreshReason(
  reasonCodes: readonly string[]
): boolean {
  return reasonCodes.some(
    (reasonCode) =>
      reasonCode === "controller.interface.check_failed" ||
      reasonCode === "usage_checking" ||
      reasonCode === "runtime.agent_controller_report_stale" ||
      reasonCode === "runtime.agent_controller_report_missing" ||
      reasonCode === "runtime.projection_missing" ||
      reasonCode === "claim_eligibility.agent_controller_report_missing" ||
      reasonCode === "claim_eligibility.agent_controller_report_stale"
  );
}

export function isAgentExecutionRouteStatusUpdatingReasonCode(
  reasonCode: string
): boolean {
  return (
    reasonCode === "agent_execution.route_missing" ||
    reasonCode === "agent_execution.route_offline" ||
    reasonCode === "agent_execution.route_unavailable" ||
    reasonCode === "route.not_registered"
  );
}

export function isAgentExecutionLocalReadinessRefreshingReasonCode(
  reasonCode: string
): boolean {
  return hasRuntimeAgentControllerReportRefreshReason([reasonCode]);
}

export function isAgentExecutionSelfHealingReasonCode(
  reasonCode: string
): boolean {
  return (
    isAgentExecutionRouteStatusUpdatingReasonCode(reasonCode) ||
    isAgentExecutionLocalReadinessRefreshingReasonCode(reasonCode)
  );
}

export function isAgentExecutionSelfHealingReadiness(
  readiness: AgentExecutionSelfHealingReadinessInput
): boolean {
  const reasonCodes = getAgentExecutionReadinessReasonCodes(readiness);
  if (hasServiceUpdateRequiredReason(reasonCodes)) {
    return false;
  }
  return (
    readiness.primaryAction === "check_status" &&
    readiness.facts.localService.refreshable &&
    reasonCodes.some(isAgentExecutionSelfHealingReasonCode)
  );
}

export function isAgentExecutionReadyOrConnecting(
  readiness: Pick<
    AgentExecutionStatusProjection,
    "displayState" | "facts" | "primaryAction"
  >
): boolean {
  return readiness.displayState === "ready";
}

function getAgentExecutionReadinessReasonCodes(
  readiness: AgentExecutionSelfHealingReadinessInput
): readonly string[] {
  return [
    ...readiness.reasonCodes,
    ...readiness.facts.profile.reasonCodes,
    ...readiness.facts.binding.reasonCodes,
    ...readiness.facts.claim.reasonCodes,
    ...readiness.facts.localService.reasonCodes,
    ...readiness.facts.service.reasonCodes,
    ...readiness.facts.route.reasonCodes,
    ...readiness.facts.runtime.reasonCodes,
  ];
}

function hasSetupRepairReason(reasonCodes: readonly string[]): boolean {
  return reasonCodes.some((reasonCode) => {
    if (
      reasonCode === "claim_eligibility.binding_capability_mismatch" ||
      reasonCode === "claim_eligibility.binding_owner_mismatch" ||
      reasonCode === "claim_eligibility.binding_runtime_mismatch" ||
      reasonCode === "claim_eligibility.capability_missing" ||
      reasonCode === "claim_eligibility.capability_unavailable" ||
      reasonCode === "claim_eligibility.owner_mismatch" ||
      reasonCode === "claim_eligibility.agent_controller_report_disabled" ||
      reasonCode === "claim_eligibility.agent_controller_report_missing" ||
      reasonCode === "claim_eligibility.agent_controller_report_stale" ||
      reasonCode === "claim_eligibility.agent_controller_report_unavailable" ||
      reasonCode === "claim_eligibility.agent_controller_report_unknown" ||
      reasonCode === "claim_eligibility.runtime_conflict" ||
      reasonCode === "claim_eligibility.openmeld_service_runtime_id_mismatch" ||
      reasonCode === "claim_eligibility.openmeld_service_runtime_id_missing" ||
      reasonCode ===
        "claim_eligibility.openmeld_service_runtime_id_not_opaque" ||
      reasonCode ===
        "claim_eligibility.openmeld_service_runtime_identity_invalid" ||
      reasonCode === "claim_eligibility.runtime_missing" ||
      reasonCode === "claim_eligibility.runtime_unavailable" ||
      reasonCode === "dispatch.claim_eligibility.binding.conflict" ||
      reasonCode === "dispatch.claim_eligibility.binding.disabled_historical" ||
      reasonCode === "dispatch.claim_eligibility.binding.owner_mismatch"
    ) {
      return true;
    }

    return (
      reasonCode.startsWith("claim_eligibility.agent_controller_report_") ||
      reasonCode.startsWith("runtime.agent_controller_report")
    );
  });
}

function hasServiceUpdateRequiredReason(
  reasonCodes: readonly string[]
): boolean {
  return reasonCodes.some(
    (reasonCode) =>
      reasonCode === "service.update_required" ||
      reasonCode === "background_helper.update_required" ||
      reasonCode === "daemon.runtime_contract.mismatch"
  );
}

function hasOnlyAdvisoryServiceDriftReason(
  reasonCodes: readonly string[]
): boolean {
  return (
    reasonCodes.length > 0 &&
    reasonCodes.every((reasonCode) => reasonCode === "service.drifted")
  );
}

function uniqueReasonCodes(reasonCodes: readonly string[]): readonly string[] {
  return [...new Set(reasonCodes.filter((reasonCode) => reasonCode.trim()))];
}
