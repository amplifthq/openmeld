import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import type { PrepareSessionSnapshot } from "@openmeld/schemas/types";
import { resolveAuthenticationGuidance } from "../auth/auth-guidance";
import { getCurrentAuthOwnerUserId } from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import { resolveOpenMeldProfileOrNull } from "../config/resolve-openmeld-profile";
import { resolveCurrentDaemonExpectedVersion } from "../local-service/lifecycle/current-daemon-version";
import {
  classifyDaemonServiceRunStartability,
  classifyDaemonServiceWakeability,
} from "../local-service/lifecycle/daemon-service-anomaly-groups";
import { inspectDaemonServiceInventory } from "../local-service/lifecycle/daemon-service-inventory";
import { submitProfileRuntimeAgentControllerReport } from "../local-service/reporting/runtime-agent-controller-reporting-submission";
import type { SelectedAgentControllerReportResult } from "../local-service/reporting/selected-agent-controller-reporting";
import { resolveOpenClawLocalDiagnosticsValue } from "../provider-hosts/openclaw/diagnostics";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import { resolveRuntimeContext } from "../runtime/context";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { createPresenter } from "../runtime/presenter/index";
import { assessActionParticipationCandidate } from "../system/action-participation-planner";
import { resolveCurrentReplyReadinessSnapshot } from "../system/current-reply-readiness-snapshot";
import {
  type AgentProfileRuntimeBindingEnsureResult,
  ensureAgentProfileRuntimeBinding,
} from "../system/ensure-agent-profile-runtime-binding";
import {
  type PreparedAgentProfileConnection,
  prepareLocalAgentReadiness,
} from "../system/local-agent-readiness-preparation";
import { runDaemonServiceParticipationGate } from "../system/local-service-participation-gate";
import type { ReplyReadinessReasonCode } from "../system/reply-readiness";
import { buildReplyReadinessGuidance } from "../system/reply-readiness-guidance";
import {
  formatServiceParticipationReadinessLabel,
  resolveServiceParticipationReadiness,
} from "../system/service-participation-readiness";
import { renderOpenMeldLogo, renderOpenMeldTagline } from "../ui/brand";
import { renderInfoCard } from "../ui/info-card";
import { runAgentsRepair } from "./agents";
import { runAuthLogin } from "./auth";
import {
  runComputerAuthorizationHandoff,
  runOneTimeTokenComputerHandoff,
} from "./computer-auth-handoff";
import {
  type PrepareSessionExecutorResult,
  type PrepareSessionLocalAgentSelection,
  runPrepareSessionExecutor,
} from "./prepare-session-executor";
import {
  runDaemonBackgroundStartForDecision,
  runDaemonInstall,
  runDaemonReinstall,
} from "./service";

const LOCAL_AGENT_CONNECTION_CARD_TITLE = "Local Agent Connection";
const RETIRED_HUMAN_PROFILE_SETUP_MESSAGE =
  "This OpenMeld Web setup command is retired. Run `openmeld setup` to set up this computer, or open the org-scoped Connect page in OpenMeld Web and copy a fresh setup command.";
const HUMAN_PROFILE_SETUP_TARGET_MESSAGE =
  "`openmeld setup --profile` expects an Agent Profile, not a Human Profile. Run `openmeld setup` to set up this computer, or copy a fresh setup command from the org-scoped Connect page in OpenMeld Web.";
type AgentProfile = Awaited<ReturnType<typeof resolveOpenMeldProfileOrNull>> & {
  profileKind: "agent";
};
type HumanProfile = Awaited<ReturnType<typeof resolveOpenMeldProfileOrNull>> & {
  profileKind: "human";
};

export type SetupLocalAgentConnectionCompletionFacts = {
  openMeldServiceRuntimeIdentity: {
    deviceId: string;
    runtimeLane: string;
  } | null;
  runtimeReports: readonly SelectedAgentControllerReportResult[];
  selectedLocalAgentIds: readonly string[];
};

export type SetupLocalAgentConnectionResult =
  | {
      completionFacts?: SetupLocalAgentConnectionCompletionFacts;
      setupSessionSnapshot: PrepareSessionSnapshot | null;
      status: "completed";
    }
  | {
      reason:
        | "cancelled"
        | "setup_session_not_completed"
        | "target_selection_required";
      status: "not_completed";
    };

export async function runSetupLocalAgentConnection(input: {
  profile?: string;
  humanProfile?: string;
  agent?: string[];
  deviceCode?: string;
  localAgent?: string[];
  localAgents?: string;
  ott?: string;
  resetThisComputer?: boolean;
  startSession?: string;
  view?: string;
}): Promise<SetupLocalAgentConnectionResult> {
  // OPENMELD_SETUP_TO_WAKE_PATH: SHARED_EXECUTOR setup-local-agent-connection
  // Public guidance must point humans and agents to `openmeld setup`. This executor
  // remains because tokenized setup and profile-specific setup still share the
  // same local service/session/reporting implementation underneath.
  const runtime = await resolveRuntimeContext({
    profile: input.profile,
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  const interactive = canUseInteractivePrompts(runtime);

  assertValidSetupLocalAgentConnectionInput(input);
  emitSetupLocalAgentConnectionHeader({
    presenter,
    view: runtime.resolvedView,
  });

  if (input.humanProfile) {
    throw new Error(RETIRED_HUMAN_PROFILE_SETUP_MESSAGE);
  }

  const deviceCode = normalizeOptionalString(input.deviceCode);
  if (input.startSession && deviceCode) {
    return buildPrepareSessionSetupResult(
      await runComputerAuthorizationHandoff({
        deviceCode,
        interactive,
        localAgentSelection: resolvePrepareSessionLocalAgentSelection(input),
        presenter,
        runtime,
        startSession: input.startSession,
        view: input.view,
      })
    );
  }

  const oneTimeToken = normalizeOptionalString(input.ott);
  if (input.startSession && oneTimeToken) {
    return buildPrepareSessionSetupResult(
      await runOneTimeTokenComputerHandoff({
        oneTimeToken,
        interactive,
        localAgentSelection: resolvePrepareSessionLocalAgentSelection(input),
        presenter,
        runtime,
        startSession: input.startSession,
        view: input.view,
      })
    );
  }

  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT local-auth
  // OTT establishes the durable local CLI account session that OpenMeld Service uses
  // after setup. It must not become a Space Action or Wake execution authority.
  await maybeLogInWithOneTimeToken({
    ott: input.ott,
    view: input.view,
  });

  const { profile: explicitProfile, resolved: explicitProfileResolved } =
    await resolveExplicitSetupProfile(input.profile);

  if (!input.startSession) {
    const gateResult = await runSetupLocalAgentConnectionServiceGate({
      interactive,
      presenter,
      runtime,
      view: input.view,
    });
    if (gateResult === "cancelled") {
      return {
        reason: "cancelled",
        status: "not_completed",
      };
    }
  }

  if (input.startSession) {
    // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT shared-setup-command-entry
    // This is the common local entry after a user or agent runs the tokenized
    // setup command. Web can recommend it, but it must remain understandable
    // and executable without Agent-only assumptions.
    const sessionResult = await runPrepareSessionExecutor({
      gatewayUrl: await resolveBaseUrl(),
      startSession: input.startSession,
      runtime,
      presenter,
      interactive,
      localAgentSelection: resolvePrepareSessionLocalAgentSelection(input),
      view: input.view,
    });
    return buildPrepareSessionSetupResult(sessionResult);
  }

  if (input.agent && input.agent.length > 0) {
    await runAgentsRepair({
      agent: input.agent,
      interactive,
      view: input.view,
    });
    return {
      setupSessionSnapshot: null,
      status: "completed",
    };
  }

  const profile = explicitProfileResolved
    ? explicitProfile
    : await resolveOpenMeldProfileOrNull({
        openMeldProfileId: input.profile,
        allowUnauthenticated: true,
        allowDefaultFallback: false,
        persistSelection: false,
      });
  if (isHumanProfile(profile)) {
    throw new Error(HUMAN_PROFILE_SETUP_TARGET_MESSAGE);
  }
  if (!isAgentProfile(profile)) {
    emitSetupLocalAgentConnectionTargetSelectionRequired({
      presenter,
      view: runtime.resolvedView,
      profileName: profile?.profileName ?? null,
    });
    return {
      reason: "target_selection_required",
      status: "not_completed",
    };
  }
  const agentProfile = profile;
  const explicitLocalAgentId = resolveStandaloneProfileLocalAgentId(input);

  const result = await prepareLocalAgentReadiness({
    profiles: [agentProfile],
    interactive,
    ...(explicitLocalAgentId
      ? {
          explicitLocalAgentSelections: new Map([
            [agentProfile.openMeldProfileId, explicitLocalAgentId],
          ]),
        }
      : {}),
    view: input.view,
  });
  if (result.status === "cancelled") {
    return {
      reason: "cancelled",
      status: "not_completed",
    };
  }

  const preparedProfileCandidate = result.profiles.find(
    (candidate) =>
      candidate.openMeldProfileId === agentProfile.openMeldProfileId
  );
  const preparedProfile = isAgentProfile(preparedProfileCandidate)
    ? preparedProfileCandidate
    : agentProfile;

  const serviceReadinessResult =
    await maybeCompleteServiceReadinessAfterPreparation({
      interactive,
      profile: preparedProfile,
      runtime,
      view: input.view,
    });
  if (serviceReadinessResult === "cancelled") {
    return {
      reason: "cancelled",
      status: "not_completed",
    };
  }
  const completionFacts = await emitSetupLocalAgentConnectionReadinessResult({
    presenter,
    preparedConnection: result.preparedConnections?.find(
      (connection) => connection.profileId === preparedProfile.openMeldProfileId
    ),
    profile: preparedProfile,
    view: runtime.resolvedView,
  });
  return {
    completionFacts,
    setupSessionSnapshot: null,
    status: "completed",
  };
}

async function resolveExplicitSetupProfile(
  profileId: string | undefined
): Promise<{
  profile: Awaited<ReturnType<typeof resolveOpenMeldProfileOrNull>> | null;
  resolved: boolean;
}> {
  const normalizedProfileId = normalizeOptionalString(profileId);
  if (!normalizedProfileId) {
    return { profile: null, resolved: false };
  }
  const profile = await resolveOpenMeldProfileOrNull({
    openMeldProfileId: normalizedProfileId,
    allowUnauthenticated: true,
    allowDefaultFallback: false,
    persistSelection: false,
  });
  if (isHumanProfile(profile)) {
    throw new Error(HUMAN_PROFILE_SETUP_TARGET_MESSAGE);
  }
  return { profile, resolved: true };
}

function resolveIncompletePrepareSessionSetupResult(
  sessionResult: Extract<
    PrepareSessionExecutorResult,
    { status: "not_completed" }
  >
): Extract<SetupLocalAgentConnectionResult, { status: "not_completed" }> {
  return {
    reason:
      sessionResult.reason === "user_cancelled"
        ? "cancelled"
        : "setup_session_not_completed",
    status: "not_completed",
  };
}

function buildPrepareSessionSetupResult(
  sessionResult: PrepareSessionExecutorResult
): SetupLocalAgentConnectionResult {
  return sessionResult.status === "completed"
    ? buildCompletedSetupSessionResult(sessionResult)
    : resolveIncompletePrepareSessionSetupResult(sessionResult);
}

function buildCompletedSetupSessionResult(
  sessionResult: Extract<PrepareSessionExecutorResult, { status: "completed" }>
): Extract<SetupLocalAgentConnectionResult, { status: "completed" }> {
  return {
    ...(sessionResult.completionFacts
      ? { completionFacts: sessionResult.completionFacts }
      : {}),
    setupSessionSnapshot: sessionResult.snapshot,
    status: "completed",
  };
}

function emitSetupLocalAgentConnectionHeader(input: {
  presenter: ReturnType<typeof createPresenter>;
  view: Awaited<ReturnType<typeof resolveRuntimeContext>>["resolvedView"];
}): void {
  if (input.view !== "human") {
    return;
  }

  input.presenter.line({
    code: "setup.local_agent_connection.header.logo_spacing",
    text: "",
  });
  for (const line of renderOpenMeldLogo().split("\n")) {
    input.presenter.line({
      code: "setup.local_agent_connection.header.logo",
      text: line,
    });
  }
  for (const line of renderOpenMeldTagline().split("\n")) {
    input.presenter.line({
      code: "setup.local_agent_connection.header.tagline",
      text: line,
    });
  }
  input.presenter.line({
    code: "setup.local_agent_connection.header.logo_spacing",
    text: "",
  });
}

type SetupLocalAgentConnectionInputFacts = {
  hasHumanProfile: boolean;
  hasLocalAgentIds: boolean;
  hasLocalAgentPreparation: boolean;
  hasPrepareSessionLocalAgentMode: boolean;
  hasProfile: boolean;
  hasStartSession: boolean;
  localAgentMode: string | null;
};

function assertValidSetupLocalAgentConnectionInput(input: {
  profile?: string;
  humanProfile?: string;
  agent?: string[];
  deviceCode?: string;
  localAgent?: string[];
  localAgents?: string;
  ott?: string;
  resetThisComputer?: boolean;
  startSession?: string;
}): void {
  const facts = resolveSetupLocalAgentConnectionInputFacts(input);

  if (normalizeOptionalString(input.deviceCode) && !facts.hasStartSession) {
    throw new Error("--device-code requires --start-session.");
  }
  if (
    normalizeOptionalString(input.deviceCode) &&
    normalizeOptionalString(input.ott)
  ) {
    throw new Error("use either --device-code or --ott, not both");
  }

  if (
    facts.hasStartSession &&
    (facts.hasProfile ||
      facts.hasHumanProfile ||
      facts.hasLocalAgentPreparation)
  ) {
    throw new Error(
      "--start-session cannot be combined with --profile, --human-profile, or --agent."
    );
  }

  if (!facts.hasStartSession && facts.hasPrepareSessionLocalAgentMode) {
    throw new Error("--local-agents requires --start-session.");
  }

  assertValidLocalAgentSelectionInput({
    facts,
    localAgent: input.localAgent,
  });

  if (
    facts.hasPrepareSessionLocalAgentMode &&
    facts.localAgentMode !== "all" &&
    facts.localAgentMode !== "none"
  ) {
    throw new Error("--local-agents must be either all or none.");
  }

  if (
    facts.hasHumanProfile &&
    (facts.hasProfile || facts.hasLocalAgentPreparation)
  ) {
    throw new Error(
      "--human-profile cannot be combined with --profile or --agent."
    );
  }

  if (facts.hasProfile && facts.hasLocalAgentPreparation) {
    throw new Error("use either --profile <id> or --agent <id...>, not both");
  }
}

function resolveStandaloneProfileLocalAgentId(input: {
  localAgent?: string[];
  profile?: string;
}): string | null {
  if (!normalizeOptionalString(input.profile)) {
    return null;
  }
  return normalizeLocalAgentIds(input.localAgent)[0] ?? null;
}

function normalizeLocalAgentIds(localAgent: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (localAgent ?? [])
        .map((agentId) => normalizeOptionalString(agentId))
        .filter((agentId): agentId is string => agentId !== null)
    )
  );
}

function resolvePrepareSessionLocalAgentSelection(input: {
  localAgent?: string[];
  localAgents?: string;
}): PrepareSessionLocalAgentSelection | undefined {
  const localAgentMode = normalizeOptionalString(input.localAgents);
  if (localAgentMode === "all" || localAgentMode === "none") {
    return { mode: localAgentMode };
  }
  const localAgentIds = normalizeLocalAgentIds(input.localAgent);
  if (localAgentIds.length > 0) {
    return {
      localAgentIds,
      mode: "specific",
    };
  }
  return undefined;
}

async function runSetupLocalAgentConnectionServiceGate(input: {
  interactive: boolean;
  presenter: ReturnType<typeof createPresenter>;
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  view?: string;
}): Promise<"continue" | "cancelled"> {
  // Same-account re-login must not reinstall a healthy service; only a real
  // owner mismatch (alignment check) may trigger the refresh.
  const expectedOwnerUserId = await getCurrentAuthOwnerUserId();
  const gateResult = await runDaemonServiceParticipationGate({
    intent: "start",
    presenter: input.presenter,
    resolvedView: input.runtime.resolvedView,
    allowPrompt: input.interactive,
    autoRepair: true,
    gatewayUrl: await resolveBaseUrl().catch(() => undefined),
    forcePrompt: true,
    ...(expectedOwnerUserId ? { expectedOwnerUserId } : {}),
    view: input.view,
  });

  if (gateResult.status === "aligned") {
    return "continue";
  }

  if (gateResult.status === "cancelled") {
    return "cancelled";
  }

  if (gateResult.errorMessage) {
    throw new Error(gateResult.errorMessage);
  }

  throw new Error(
    "OpenMeld Service is still reconnecting. Run `openmeld setup` again after OpenMeld Service finishes refreshing."
  );
}

async function maybeLogInWithOneTimeToken(input: {
  ott?: string;
  view?: string;
}): Promise<void> {
  const oneTimeToken = normalizeOptionalString(input.ott);
  if (!oneTimeToken) {
    return;
  }

  const result = await runAuthLogin({
    ott: oneTimeToken,
    view: input.view,
    agentOverviewHandled: true,
  });
  if (result !== "completed") {
    throw new Error(
      "OpenMeld sign-in was cancelled before local preparation ran."
    );
  }
}

function resolveSetupLocalAgentConnectionInputFacts(input: {
  profile?: string;
  humanProfile?: string;
  agent?: string[];
  localAgent?: string[];
  localAgents?: string;
  startSession?: string;
}): SetupLocalAgentConnectionInputFacts {
  const localAgentMode = normalizeOptionalString(input.localAgents);
  return {
    hasHumanProfile:
      typeof input.humanProfile === "string" &&
      input.humanProfile.trim().length > 0,
    hasLocalAgentIds:
      Array.isArray(input.localAgent) && input.localAgent.length > 0,
    hasLocalAgentPreparation:
      Array.isArray(input.agent) && input.agent.length > 0,
    hasPrepareSessionLocalAgentMode: localAgentMode !== null,
    hasProfile:
      typeof input.profile === "string" && input.profile.trim().length > 0,
    hasStartSession:
      typeof input.startSession === "string" &&
      input.startSession.trim().length > 0,
    localAgentMode,
  };
}

function assertValidLocalAgentSelectionInput(input: {
  facts: SetupLocalAgentConnectionInputFacts;
  localAgent?: string[];
}): void {
  const { facts } = input;
  if (!(facts.hasStartSession || facts.hasProfile) && facts.hasLocalAgentIds) {
    throw new Error("--local-agent requires --start-session or --profile.");
  }

  if (facts.hasPrepareSessionLocalAgentMode && facts.hasLocalAgentIds) {
    throw new Error(
      "use either --local-agents <all|none> or --local-agent <id...>, not both"
    );
  }

  if (!(facts.hasProfile && facts.hasLocalAgentIds)) {
    return;
  }

  const localAgentIds = normalizeLocalAgentIds(input.localAgent);
  if (localAgentIds.length !== 1) {
    throw new Error("--profile setup accepts exactly one --local-agent <id>.");
  }
}

async function maybeCompleteServiceReadinessAfterPreparation(input: {
  interactive: boolean;
  profile: AgentProfile;
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  view?: string;
}): Promise<"completed" | "cancelled"> {
  if (!input.interactive || input.runtime.resolvedView !== "human") {
    return "completed";
  }

  const snapshot = await resolveCurrentReplyReadinessSnapshot({
    checkGatewayChain: true,
    includeDaemonRouteObservation: true,
    openClawDiagnosticsMode: "repair",
    ownerUserId: input.profile.ownerUserId,
    profile: input.profile,
  });
  const reasonCodes = collectReadinessReasonCodes(snapshot);
  if (reasonCodes.length === 0) {
    return "completed";
  }

  const inventory = await inspectDaemonServiceInventory({
    expectedVersion: resolveCurrentDaemonExpectedVersion(),
    intent: "status_cleanup",
  });
  const wakeability = classifyDaemonServiceWakeability({
    inventory,
  });
  const startability = classifyDaemonServiceRunStartability({
    inventory,
  });
  const hasBlockingServiceDrift = wakeability.blocksWake;
  const serviceRunWouldBeBlocked = startability.blocksStart;
  const scheduleBackgroundUpdate = shouldScheduleSetupServiceUpdate({
    inventory,
    serviceRunWouldBeBlocked,
    wakeability,
  });

  if (
    hasBlockingServiceDrift ||
    serviceRunWouldBeBlocked ||
    reasonCodes.includes("service.drifted")
  ) {
    const refreshOutcome = await runDaemonReinstall(
      {
        agentOverviewHandled: true,
        ...(scheduleBackgroundUpdate
          ? { displayAction: "update" as const }
          : {}),
        gatewayUrl: await resolveBaseUrl(),
        profile: input.profile.openMeldProfileId,
        view: input.view,
      },
      {
        skipConfirm: true,
        startAfterInstallMode: "always",
        suppressAgentOverview: true,
      }
    );
    if (!refreshOutcome.ok && refreshOutcome.result === "cancelled") {
      return "cancelled";
    }
    if (!refreshOutcome.ok) {
      throw new Error(
        `OpenMeld Service refresh did not complete: ${refreshOutcome.result}`
      );
    }
    return "completed";
  }

  if (reasonCodes.includes("service.not_installed")) {
    await runDaemonInstall(
      {
        agentOverviewHandled: true,
        gatewayUrl: await resolveBaseUrl(),
        profile: input.profile.openMeldProfileId,
        view: input.view,
      },
      {
        suppressAgentOverview: true,
      }
    );
    const runResult = await runDaemonBackgroundStartForDecision({
      gatewayUrl: await resolveBaseUrl(),
      profile: input.profile.openMeldProfileId,
      view: input.view,
    });
    return runResult === "cancelled" ? "cancelled" : "completed";
  }

  if (reasonCodes.includes("service.not_running")) {
    const runResult = await runDaemonBackgroundStartForDecision({
      gatewayUrl: await resolveBaseUrl(),
      profile: input.profile.openMeldProfileId,
      view: input.view,
    });
    if (runResult === "cancelled") {
      return "cancelled";
    }
  }
  return "completed";
}

function shouldScheduleSetupServiceUpdate(input: {
  inventory: Awaited<ReturnType<typeof inspectDaemonServiceInventory>>;
  serviceRunWouldBeBlocked: boolean;
  wakeability: ReturnType<typeof classifyDaemonServiceWakeability>;
}): boolean {
  const hasVersionDrift = input.inventory.anomalies.some(
    (anomaly) =>
      anomaly.code === "version_outdated" ||
      anomaly.code === "bundle_version_drift"
  );
  return (
    hasVersionDrift &&
    input.wakeability.executionEvidenceSafe &&
    !input.wakeability.blocksWake &&
    !input.serviceRunWouldBeBlocked
  );
}

function collectReadinessReasonCodes(input: {
  agentReplyReadiness?: {
    reasonCodes?: readonly ReplyReadinessReasonCode[];
  } | null;
  deviceReplyReadiness: {
    reasonCodes: readonly ReplyReadinessReasonCode[];
  };
}): ReplyReadinessReasonCode[] {
  const reasonCodes: ReplyReadinessReasonCode[] = [];
  for (const reasonCode of input.deviceReplyReadiness.reasonCodes) {
    if (!reasonCodes.includes(reasonCode)) {
      reasonCodes.push(reasonCode);
    }
  }
  for (const reasonCode of input.agentReplyReadiness?.reasonCodes ?? []) {
    if (!reasonCodes.includes(reasonCode)) {
      reasonCodes.push(reasonCode);
    }
  }
  return reasonCodes;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function isHumanProfile(profile: unknown): profile is HumanProfile {
  return (
    profile !== null &&
    typeof profile === "object" &&
    "profileKind" in profile &&
    profile.profileKind === "human"
  );
}

async function emitSetupLocalAgentConnectionReadinessResult(input: {
  presenter: ReturnType<typeof createPresenter>;
  preparedConnection?: PreparedAgentProfileConnection;
  profile: AgentProfile;
  view: "human" | "agent";
}): Promise<SetupLocalAgentConnectionCompletionFacts> {
  const snapshot = await resolveCurrentReplyReadinessSnapshot({
    checkGatewayChain: true,
    includeDaemonRouteObservation: true,
    openClawDiagnosticsMode: "repair",
    ownerUserId: input.profile.ownerUserId,
    profile: input.profile,
  });
  const serviceReadiness = resolveServiceParticipationReadiness({
    deviceReplyReadiness: snapshot.deviceReplyReadiness,
    inventory: snapshot.inventory,
    runtimeStatus: snapshot.displayRuntimeStatus ?? snapshot.runtimeStatus,
  });
  const assessment = assessActionParticipationCandidate({
    profileId: input.profile.openMeldProfileId,
    profileName: input.profile.profileName,
    profileKind: input.profile.profileKind,
    localParticipationReadiness: serviceReadiness.serviceReadiness,
    localParticipationReasonCodes: snapshot.deviceReplyReadiness.reasonCodes,
  });
  const localParticipationState =
    input.preparedConnection?.runtimeReport.localParticipationState ??
    assessment.localParticipationState;
  const localParticipationReasonCodes =
    input.preparedConnection?.runtimeReport.reasonCodes ??
    assessment.reasonCodes;
  const localAgentReadiness = resolveLocalAgentReadinessSummary(
    localParticipationState
  );
  const baseGuidance = snapshot.agentReplyReadiness
    ? buildReplyReadinessGuidance({
        openClawLocalDiagnostics: resolveOpenClawLocalDiagnosticsValue(
          snapshot.openClawLocalDiagnostics
        ),
        profile: input.profile,
        replyReadiness: snapshot.agentReplyReadiness,
      })
    : {
        primaryReasonCode: null,
        summary:
          "OpenMeld still needs more local evidence before it can confirm this Agent Profile can reply from this computer.",
        nextSteps: [formatOpenMeldCliCommand("openmeld service status")],
      };
  const runtimeReportSubmission = input.preparedConnection
    ? input.preparedConnection.runtimeReport.runtimeReportSubmission
    : await submitProfileRuntimeAgentControllerReport({
        localParticipationState,
        profile: input.profile,
        reasonCodes: localParticipationReasonCodes,
      });
  const agentProfileBindingEnsure =
    input.preparedConnection?.agentProfileBindingEnsure ??
    (await ensureAgentProfileRuntimeBinding({
      profile: input.profile,
      runtimeReportSubmission,
    }));
  const formalAgentConnection = resolveFormalAgentConnectionProjection(
    agentProfileBindingEnsure
  );
  const guidance = resolveSetupLocalAgentConnectionGuidance({
    baseGuidance,
    formalAgentConnection,
    profileId: input.profile.openMeldProfileId,
    runtimeReportSubmission,
    serviceReadiness: serviceReadiness.serviceReadiness,
  });
  const agentConnectionReadiness = resolveAgentConnectionReadinessVerdict({
    formalAgentConnection,
    guidance,
  });
  const completionFacts = buildSetupLocalAgentConnectionCompletionFacts({
    formalAgentConnection,
    localParticipationState,
    reasonCodes: localParticipationReasonCodes,
    runtimeReportSubmission,
  });

  if (input.view === "human") {
    renderInfoCard({
      presenter: input.presenter,
      title: LOCAL_AGENT_CONNECTION_CARD_TITLE,
      codePrefix: "setup.local_agent_connection.card",
      sanitize: true,
      rows: [
        { label: "Profile Name", value: input.profile.profileName },
        {
          label: "Local setup on this computer",
          value: localAgentReadiness.label,
        },
        {
          label: "OpenMeld Service",
          value: formatServiceParticipationReadinessLabel(serviceReadiness),
        },
        {
          label: "Agent connection",
          value: formalAgentConnection.label,
        },
        {
          label: "Server connection report",
          value: formatRuntimeReportSubmission(runtimeReportSubmission),
        },
        {
          label: "Why",
          value: guidance.summary,
        },
        {
          label: "Do This",
          value:
            guidance.nextSteps[0] ??
            "Nothing else is needed on this computer right now.",
        },
        ...(guidance.nextSteps[1]
          ? [{ label: "Then", value: guidance.nextSteps[1] }]
          : []),
      ],
    });
    return completionFacts;
  }

  const payload = buildSetupLocalAgentConnectionAgentPayload({
    agentConnectionReadiness,
    agentProfileBindingEnsure,
    formalAgentConnection,
    guidance,
    localAgentReadiness,
    profile: input.profile,
    runtimeReportSubmission,
    serviceReadiness,
  });
  input.presenter.data({
    code: "setup.local_agent_connection.result",
    payload,
  });
  input.presenter.line({
    code: "setup.local_agent_connection.summary",
    text: `profile ${input.profile.openMeldProfileId}: agent_connection=${agentConnectionReadiness.status}, can_reply_from_this_computer=${agentConnectionReadiness.canReplyFromThisComputer ? "true" : "false"}, local_agent_readiness_evidence=${localAgentReadiness.status}, openmeld_service=${serviceReadiness.serviceReadiness}, next_action=${agentConnectionReadiness.nextAction ?? "none"}`,
  });
  return completionFacts;
}

function buildSetupLocalAgentConnectionCompletionFacts(input: {
  formalAgentConnection: ReturnType<
    typeof resolveFormalAgentConnectionProjection
  >;
  localParticipationState: SelectedAgentControllerReportResult["localParticipationState"];
  reasonCodes: readonly string[];
  runtimeReportSubmission: SelectedAgentControllerReportResult["runtimeReportSubmission"];
}): SetupLocalAgentConnectionCompletionFacts {
  const capability = parseAgentControllerRef(
    input.runtimeReportSubmission.agentControllerRef
  );
  const localParticipationState =
    input.formalAgentConnection.status === "ready"
      ? input.localParticipationState
      : "needs_openmeld_service";
  const reasonCodes =
    input.formalAgentConnection.status === "ready"
      ? input.reasonCodes
      : input.formalAgentConnection.reasonCodes;
  const runtimeReports: SelectedAgentControllerReportResult[] = capability
    ? [
        {
          agentId: capability.id,
          agentControllerRef: capability.ref,
          localParticipationState,
          reasonCodes,
          runtimeReportSubmission: input.runtimeReportSubmission,
        },
      ]
    : [];

  return {
    openMeldServiceRuntimeIdentity:
      input.runtimeReportSubmission.deviceId &&
      input.runtimeReportSubmission.lane
        ? {
            deviceId: input.runtimeReportSubmission.deviceId,
            runtimeLane: input.runtimeReportSubmission.lane,
          }
        : null,
    runtimeReports,
    selectedLocalAgentIds: capability ? [capability.id] : [],
  };
}

function emitSetupLocalAgentConnectionTargetSelectionRequired(input: {
  presenter: ReturnType<typeof createPresenter>;
  view: "human" | "agent";
  profileName: string | null;
}): void {
  const nextSteps: [string, string] = [
    "Open OpenMeld Web and use Connect local agent for the Agent Profile.",
    "For direct agent setup, copy the exact setup command from that Agent Profile page.",
  ];
  const whyText = input.profileName
    ? `OpenMeld connected this computer, but ${input.profileName} is a person profile. To connect one specific Agent Profile directly, run setup with that Agent Profile.`
    : "OpenMeld connected this computer, but no Agent Profile was selected for direct agent setup.";
  const payload = {
    profile: null,
    localAgentReadiness: {
      status: "selection_required",
      label: "Selection required",
    },
    openMeldService: null,
    guidance: {
      summary: whyText,
      nextSteps,
    },
  };

  if (input.view === "human") {
    renderInfoCard({
      presenter: input.presenter,
      title: LOCAL_AGENT_CONNECTION_CARD_TITLE,
      codePrefix: "setup.local_agent_connection.card",
      sanitize: true,
      rows: [
        {
          label: "Local agent connection on this computer",
          value: "Selection required",
        },
        {
          label: "Why",
          value: whyText,
        },
        { label: "Do This", value: nextSteps[0] },
        { label: "Then", value: nextSteps[1] },
      ],
    });
    return;
  }

  input.presenter.data({
    code: "setup.local_agent_connection.result",
    payload,
  });
  input.presenter.line({
    code: "setup.local_agent_connection.summary",
    text: "local agent connection: selection_required",
    data: payload,
  });
}

function resolveLocalAgentReadinessSummary(
  state: ReturnType<
    typeof assessActionParticipationCandidate
  >["localParticipationState"]
): {
  status: "ready" | "needs_attention" | "membership_only";
  label: string;
} {
  switch (state) {
    case "ready":
    case "needs_openmeld_service":
      return {
        status: "ready",
        label: "Local setup evidence is available on this computer.",
      };
    case "membership_only":
      return {
        status: "membership_only",
        label:
          "Membership only - this profile can join a space now, but it still can't wake or reply from this computer.",
      };
    default:
      return {
        status: "needs_attention",
        label:
          "Needs attention - OpenMeld still has local agent connection work to finish on this computer.",
      };
  }
}

function buildSetupLocalAgentConnectionAgentPayload(input: {
  agentConnectionReadiness: ReturnType<
    typeof resolveAgentConnectionReadinessVerdict
  >;
  agentProfileBindingEnsure: AgentProfileRuntimeBindingEnsureResult;
  formalAgentConnection: ReturnType<
    typeof resolveFormalAgentConnectionProjection
  >;
  guidance: ReturnType<typeof resolveSetupLocalAgentConnectionGuidance>;
  localAgentReadiness: ReturnType<typeof resolveLocalAgentReadinessSummary>;
  profile: AgentProfile;
  runtimeReportSubmission: Awaited<
    ReturnType<typeof submitProfileRuntimeAgentControllerReport>
  >;
  serviceReadiness: ReturnType<typeof resolveServiceParticipationReadiness>;
}): Record<string, unknown> {
  const reportDetail = input.runtimeReportSubmission as {
    reason?: string | null;
    openMeldServiceRuntimeId?: string | null;
  };
  const capability = parseAgentControllerRef(
    input.runtimeReportSubmission.agentControllerRef
  );

  return {
    profile: {
      profileId: input.profile.openMeldProfileId,
      profileName: input.profile.profileName,
      profileKind: input.profile.profileKind,
    },
    localAgent: capability
      ? {
          agentId: capability.id,
          agentControllerRef: capability.ref,
        }
      : null,
    connection: {
      status: input.agentConnectionReadiness.status,
      canBeWokenInSpaces: input.agentConnectionReadiness.canBeWokenInSpaces,
      canReplyFromThisComputer:
        input.agentConnectionReadiness.canReplyFromThisComputer,
      summary: input.agentConnectionReadiness.summary,
      nextAction: input.agentConnectionReadiness.nextAction,
      reasonCodes: [...input.agentConnectionReadiness.reasonCodes],
    },
    localAgentReadiness: {
      status: input.localAgentReadiness.status,
      label: input.localAgentReadiness.label,
    },
    openMeldService: {
      status: input.serviceReadiness.serviceReadiness,
      label: formatServiceParticipationReadinessLabel(input.serviceReadiness),
      nextSteps: input.serviceReadiness.nextSteps,
    },
    serverConnectionReport: {
      status: input.runtimeReportSubmission.status,
      openMeldServiceRuntimeId: reportDetail.openMeldServiceRuntimeId ?? null,
      reason: reportDetail.reason ?? null,
    },
    binding: {
      status: input.agentProfileBindingEnsure.status,
      label: input.formalAgentConnection.label,
      routable: input.agentProfileBindingEnsure.routable,
      reasonCodes: [...input.formalAgentConnection.reasonCodes],
    },
    guidance: {
      summary: input.guidance.summary,
      nextSteps: input.guidance.nextSteps,
    },
    detailsCommand: formatOpenMeldCliCommand(
      `openmeld service status --profile ${input.profile.openMeldProfileId} --view agent`
    ),
  };
}

function resolveFormalAgentConnectionProjection(
  result: AgentProfileRuntimeBindingEnsureResult
): {
  status: "not_ready" | "ready";
  label: string;
  reasonCodes: string[];
} {
  if (result.status === "accepted" && result.routable) {
    return {
      label: "Connected to this computer.",
      reasonCodes: result.reasonCodes,
      status: "ready",
    };
  }

  const primaryReasonCode = result.reasonCodes[0] ?? null;
  if (primaryReasonCode && isConnectionMismatchReason(primaryReasonCode)) {
    return {
      label: "Reconnect needed - this agent is not connected to this computer.",
      reasonCodes: result.reasonCodes,
      status: "not_ready",
    };
  }
  if (
    primaryReasonCode &&
    isLocalServiceConnectionUnavailableReason(primaryReasonCode)
  ) {
    return {
      label:
        "OpenMeld Service check needed - this computer has not checked in yet.",
      reasonCodes: result.reasonCodes,
      status: "not_ready",
    };
  }
  if (
    primaryReasonCode &&
    isConnectionVerificationPendingReason(primaryReasonCode)
  ) {
    return {
      label:
        "Still checking - OpenMeld has not confirmed this agent on this computer yet.",
      reasonCodes: result.reasonCodes,
      status: "not_ready",
    };
  }

  return {
    label:
      "Setup incomplete - OpenMeld could not finish connecting this agent to this computer.",
    reasonCodes: result.reasonCodes,
    status: "not_ready",
  };
}

function resolveAgentConnectionReadinessVerdict(input: {
  formalAgentConnection: ReturnType<
    typeof resolveFormalAgentConnectionProjection
  >;
  guidance: {
    nextSteps: string[];
    primaryReasonCode: string | null;
    summary: string;
  };
}): {
  canBeWokenInSpaces: boolean;
  canReplyFromThisComputer: boolean;
  nextAction: string | null;
  reasonCodes: string[];
  status: "not_ready" | "ready";
  summary: string;
} {
  if (input.formalAgentConnection.status !== "ready") {
    return {
      canBeWokenInSpaces: false,
      canReplyFromThisComputer: false,
      nextAction: input.guidance.nextSteps[0] ?? null,
      reasonCodes: input.formalAgentConnection.reasonCodes,
      status: "not_ready",
      summary:
        "This Agent Profile cannot reply from this computer in Spaces yet.",
    };
  }

  return {
    canBeWokenInSpaces: true,
    canReplyFromThisComputer: true,
    nextAction: null,
    reasonCodes: input.formalAgentConnection.reasonCodes,
    status: "ready",
    summary:
      "This Agent Profile is connected and can reply from this computer when it is woken in a Space.",
  };
}

function resolveSetupLocalAgentConnectionGuidance(input: {
  baseGuidance: {
    primaryReasonCode: string | null;
    summary: string;
    nextSteps: string[];
  };
  formalAgentConnection: ReturnType<
    typeof resolveFormalAgentConnectionProjection
  >;
  profileId: string;
  runtimeReportSubmission: Awaited<
    ReturnType<typeof submitProfileRuntimeAgentControllerReport>
  >;
  serviceReadiness: string;
}): {
  primaryReasonCode: string | null;
  summary: string;
  nextSteps: string[];
} {
  if (
    input.serviceReadiness !== "ready" ||
    input.baseGuidance.primaryReasonCode ===
      "controller.launch.choice_required" ||
    input.baseGuidance.primaryReasonCode === "controller.launch.needs_repair"
  ) {
    return input.baseGuidance;
  }

  if (input.formalAgentConnection.status === "ready") {
    return {
      primaryReasonCode: null,
      summary: "This agent is connected to this computer.",
      nextSteps: [],
    };
  }

  if (input.runtimeReportSubmission.reason === "auth_gateway_mismatch") {
    const authGuidance = resolveAuthenticationGuidance({
      action: "connecting this Agent",
      authBaseUrl: input.runtimeReportSubmission.authBaseUrl,
      gatewayUrl: input.runtimeReportSubmission.gatewayUrl,
      reason: "mismatch",
    });
    return {
      primaryReasonCode: input.runtimeReportSubmission.reasonCodes[0] ?? null,
      summary: `${authGuidance.title}: ${authGuidance.summary}`,
      nextSteps: [
        formatOpenMeldCliCommand("openmeld login"),
        formatOpenMeldCliCommand(`openmeld setup --profile ${input.profileId}`),
      ],
    };
  }

  const connectionMismatchGuidance = resolveAgentConnectionMismatchGuidance(
    input.formalAgentConnection.reasonCodes
  );
  if (connectionMismatchGuidance) {
    return connectionMismatchGuidance;
  }
  const serviceConnectionGuidance = resolveLocalServiceConnectionGuidance(
    input.formalAgentConnection.reasonCodes
  );
  if (serviceConnectionGuidance) {
    return serviceConnectionGuidance;
  }

  return {
    primaryReasonCode: input.formalAgentConnection.reasonCodes[0] ?? null,
    summary: "OpenMeld could not finish setup for this agent on this computer.",
    nextSteps: [
      "Open this Agent in OpenMeld Web and run setup for this computer.",
      `${formatOpenMeldCliCommand(
        "openmeld service status"
      )} checks OpenMeld Service on this computer.`,
    ],
  };
}

function resolveAgentConnectionMismatchGuidance(
  reasonCodes: readonly string[]
): {
  primaryReasonCode: string | null;
  summary: string;
  nextSteps: string[];
} | null {
  const primaryReasonCode = reasonCodes[0] ?? null;
  if (!primaryReasonCode) {
    return null;
  }
  if (isOwnerMismatchReason(primaryReasonCode)) {
    return {
      primaryReasonCode,
      summary:
        "This agent is connected to a different OpenMeld account or computer setup.",
      nextSteps: [
        "Open this Agent in OpenMeld Web and reconnect it to this computer.",
        `If you are signed into the wrong OpenMeld account, run ${formatOpenMeldCliCommand(
          "openmeld login"
        )} first.`,
      ],
    };
  }
  if (isComputerConnectionMismatchReason(primaryReasonCode)) {
    return {
      primaryReasonCode,
      summary: "This agent is connected to a different computer setup.",
      nextSteps: [
        "Open this Agent in OpenMeld Web and reconnect it to this computer.",
        "Then retry Wake from the Space.",
      ],
    };
  }
  return null;
}

function resolveLocalServiceConnectionGuidance(
  reasonCodes: readonly string[]
): {
  primaryReasonCode: string | null;
  summary: string;
  nextSteps: string[];
} | null {
  const primaryReasonCode = reasonCodes[0] ?? null;
  if (!primaryReasonCode) {
    return null;
  }
  if (isLocalServiceConnectionUnavailableReason(primaryReasonCode)) {
    return {
      primaryReasonCode,
      summary:
        "OpenMeld Service on this computer has not checked in for this agent yet.",
      nextSteps: [
        formatOpenMeldCliCommand("openmeld service status"),
        "After OpenMeld Service is running, open this Agent in OpenMeld Web and run setup for this computer.",
      ],
    };
  }
  if (isConnectionVerificationPendingReason(primaryReasonCode)) {
    return {
      primaryReasonCode,
      summary:
        "OpenMeld is still checking whether this agent is connected to this computer.",
      nextSteps: [
        formatOpenMeldCliCommand("openmeld service status"),
        "Retry Wake after the service check is healthy.",
      ],
    };
  }
  return null;
}

function isOwnerMismatchReason(reasonCode: string): boolean {
  return (
    reasonCode === "agent_profile_binding.owner_mismatch" ||
    reasonCode === "claim_eligibility.binding_owner_mismatch" ||
    reasonCode === "claim_eligibility.owner_mismatch" ||
    reasonCode === "dispatch.claim_eligibility.binding.owner_mismatch"
  );
}

function isComputerConnectionMismatchReason(reasonCode: string): boolean {
  return (
    reasonCode === "agent_profile_binding.primary_conflict" ||
    reasonCode === "local_service.identity_mismatch" ||
    reasonCode === "claim_eligibility.binding_runtime_mismatch" ||
    reasonCode === "claim_eligibility.openmeld_service_runtime_id_mismatch" ||
    reasonCode === "claim_eligibility.runtime_conflict" ||
    reasonCode === "dispatch.claim_eligibility.binding.conflict"
  );
}

function isConnectionMismatchReason(reasonCode: string): boolean {
  return (
    isOwnerMismatchReason(reasonCode) ||
    isComputerConnectionMismatchReason(reasonCode)
  );
}

function isLocalServiceConnectionUnavailableReason(
  reasonCode: string
): boolean {
  return (
    reasonCode === "agent_profile_binding.local_service_not_connected" ||
    reasonCode === "service.not_running" ||
    reasonCode === "service.not_installed"
  );
}

function isConnectionVerificationPendingReason(reasonCode: string): boolean {
  return reasonCode === "agent_profile_binding.execution_readiness_pending";
}

function formatRuntimeReportSubmission(
  submission: Awaited<
    ReturnType<typeof submitProfileRuntimeAgentControllerReport>
  >
): string {
  switch (submission.status) {
    case "submitted":
      return "Submitted.";
    case "unavailable":
      return "Not submitted yet.";
    case "failed":
      return "Could not submit. Local setup is still recorded separately.";
    default:
      return "Unknown.";
  }
}

function isAgentProfile(profile: unknown): profile is AgentProfile {
  return (
    typeof profile === "object" &&
    profile !== null &&
    "profileKind" in profile &&
    profile.profileKind === "agent"
  );
}
