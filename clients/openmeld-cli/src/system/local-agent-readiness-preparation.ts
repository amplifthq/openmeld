import {
  buildAgentControllerRef,
  parseAgentControllerRef,
} from "@openmeld/agent-runtime";
import { resolveAgentTargetState } from "../agents/registry";
import { resolveRegistryRuntimeAdapterContractByAgentControllerRef } from "../agents/registry-source";
import {
  type AgentsEnableResult,
  type AgentsRepairResult,
  runAgentsEnable,
  runAgentsRepair,
} from "../commands/agents";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import {
  createDefaultRuntimeAgentControllerSettings,
  type RuntimeAgentTransportMode,
} from "../config/runtime-config";
import { syncDeviceRuntimeStateProjection } from "../local-service/reporting/device-runtime-state-sync";
import { resolveLocalAgentControllerReportInput } from "../local-service/reporting/local-agent-controller-report-resolution";
import {
  type RuntimeAgentControllerReportSubmission,
  submitRuntimeAgentControllerReport,
} from "../local-service/reporting/runtime-agent-controller-reporting-submission";
import type { SelectedAgentControllerReportResult } from "../local-service/reporting/selected-agent-controller-reporting";
import {
  persistAgentTransportSelection,
  resolveAgentProfileSetup,
} from "../profile/agent-setup-flow";
import { resolveAgentProfilePrimaryAgentControllerReport } from "./agent-profile-primary-binding";
import { resolveCurrentReplyReadinessSnapshot } from "./current-reply-readiness-snapshot";
import {
  type AgentProfileRuntimeBindingEnsureResult,
  ensureAgentProfileRuntimeBinding,
} from "./ensure-agent-profile-runtime-binding";
import {
  type ProfileWorkspaceStateSyncResult,
  syncProfileWorkspaceState,
} from "./profile-workspace-state";

type LocalAgentReadinessPreparationStatus =
  | "prepared"
  | "unchanged"
  | "cancelled";

export type LocalAgentReadinessPreparationResult = {
  preparedConnections: PreparedAgentProfileConnection[];
  status: LocalAgentReadinessPreparationStatus;
  profiles: OpenMeldProfile[];
};

export type PreparedAgentProfileConnection = {
  agentProfileBindingEnsure: AgentProfileRuntimeBindingEnsureResult;
  profileId: string;
  runtimeReport: SelectedAgentControllerReportResult;
};

type ProfileReadinessSnapshot = Awaited<
  ReturnType<typeof resolveProfileReadinessSnapshot>
>;

export async function prepareLocalAgentReadiness(input: {
  explicitLocalAgentSelections?: ReadonlyMap<string, string>;
  profiles: readonly OpenMeldProfile[];
  interactive: boolean;
  view?: string;
}): Promise<LocalAgentReadinessPreparationResult> {
  const nextProfiles: OpenMeldProfile[] = [];
  const preparedConnections: PreparedAgentProfileConnection[] = [];
  let preparedAny = false;

  for (const profile of input.profiles) {
    if (profile.profileKind !== "agent") {
      nextProfiles.push(profile);
      continue;
    }

    const result = await prepareSingleAgentProfile({
      profile,
      explicitLocalAgentId: input.explicitLocalAgentSelections?.get(
        profile.openMeldProfileId
      ),
      interactive: input.interactive,
      view: input.view,
    });
    if (result.status === "cancelled") {
      return {
        preparedConnections,
        status: "cancelled",
        profiles: nextProfiles,
      };
    }
    if (result.status === "prepared") {
      preparedAny = true;
    }
    if (result.preparedConnection) {
      preparedConnections.push(result.preparedConnection);
    }
    nextProfiles.push(result.profile);
  }

  return {
    preparedConnections,
    status: preparedAny ? "prepared" : "unchanged",
    profiles: nextProfiles,
  };
}

async function prepareSingleAgentProfile(input: {
  explicitLocalAgentId?: string;
  profile: OpenMeldProfile;
  interactive: boolean;
  view?: string;
}): Promise<{
  preparedConnection?: PreparedAgentProfileConnection;
  status: LocalAgentReadinessPreparationStatus;
  profile: OpenMeldProfile;
}> {
  const profile = input.profile;
  let prepared = false;
  let preparedConnection: PreparedAgentProfileConnection | undefined;
  let snapshot = await resolveProfileReadinessSnapshot(profile);
  if (input.explicitLocalAgentId) {
    preparedConnection = await bindAgentProfileToExplicitLocalAgent({
      localAgentId: input.explicitLocalAgentId,
      profile,
    });
    prepared = true;
    snapshot = await resolveProfileReadinessSnapshot(profile);
  }
  const initialReasonCodes = collectPreparationReasonCodes(snapshot);

  if (
    !input.explicitLocalAgentId &&
    needsControllerSetup({ profile, reasonCodes: initialReasonCodes })
  ) {
    if (!input.interactive) {
      return {
        status: "unchanged",
        profile,
      };
    }

    const setupResult = await resolveAgentProfileSetup({
      interactive: true,
      useAutoSelectionWhenNonInteractive: false,
      selectControllerMessage:
        "Choose which local agent this profile should use on this device.",
      selectTransportModeMessage:
        "How should this profile connect to its local agent?",
      selectResponsePolicyMessage: "When should this profile auto-reply?",
      skipControllerOptionLabel: "Skip for now",
      allowBackToCaller: false,
    });
    if (setupResult.status === "cancelled" || setupResult.status === "back") {
      return {
        status: "cancelled",
        profile,
      };
    }
    if (setupResult.status === "configured") {
      preparedConnection = await prepareAgentProfileConnection({
        agentControllerRef: setupResult.agentControllerRef,
        profile,
        transportMode: setupResult.transportMode,
      });
      prepared = true;
      snapshot = await resolveProfileReadinessSnapshot(profile);
    }
  }

  const launchPreparation = await prepareLocalAgentLaunchIfNeeded({
    interactive: input.interactive,
    profile,
    reasonCodes: collectPreparationReasonCodes(snapshot),
    view: input.view,
  });
  if (launchPreparation.status === "cancelled") {
    return {
      status: "cancelled",
      profile,
    };
  }
  if (launchPreparation.status === "prepared") {
    prepared = true;
    snapshot = launchPreparation.snapshot;
  }

  const readinessRepair = await repairProfileReadinessState({
    profile,
    reasonCodes: collectPreparationReasonCodes(snapshot),
    view: input.view,
  });
  if (readinessRepair.prepared) {
    prepared = true;
  }

  return {
    ...(preparedConnection ? { preparedConnection } : {}),
    status: prepared ? "prepared" : "unchanged",
    profile,
  };
}

async function bindAgentProfileToExplicitLocalAgent(input: {
  localAgentId: string;
  profile: OpenMeldProfile;
}): Promise<PreparedAgentProfileConnection> {
  const target = await resolveAgentTargetState(input.localAgentId);
  if (!canBindExplicitLocalAgentForNewProfileSelection(target)) {
    const displayName = target?.displayName ?? input.localAgentId;
    throw new Error(
      target?.lifecycleStatus === "suspended"
        ? `OpenMeld no longer offers ${displayName} for new Agent Profiles.`
        : `OpenMeld cannot use ${displayName} for new Agent Profiles on this computer.`
    );
  }

  const agentControllerRef = buildAgentControllerRef({
    kind: "builtin",
    id: input.localAgentId,
  });

  return await prepareAgentProfileConnection({
    agentControllerRef,
    confirmLocalExecutionEvidence: false,
    profile: input.profile,
    transportMode: resolveDefaultTransportModeForLocalAgent({
      agentControllerRef,
      localAgentId: input.localAgentId,
    }),
    writeMode: "reconnect",
  });
}

async function prepareAgentProfileConnection(input: {
  agentControllerRef: string;
  confirmLocalExecutionEvidence?: boolean;
  profile: OpenMeldProfile;
  transportMode: RuntimeAgentTransportMode;
  writeMode?: "ensure" | "reconnect";
}): Promise<PreparedAgentProfileConnection> {
  const agentController = parseAgentControllerRef(input.agentControllerRef);
  if (!agentController) {
    throw new Error(
      `OpenMeld local agent setup returned an invalid Agent Controller reference: ${input.agentControllerRef}`
    );
  }
  await persistAgentTransportSelection({
    agentControllerRef: agentController.ref,
    transportMode: input.transportMode,
  });
  const reportInput = await resolveLocalAgentControllerReportInput({
    agentControllerRef: agentController.ref,
    diagnosticProfileId: input.profile.openMeldProfileId,
    requireEnabled: false,
  });
  const runtimeReportSubmission =
    await submitRuntimeAgentControllerReport(reportInput);
  const agentProfileBindingEnsure = await ensureAgentProfileRuntimeBinding({
    ...(input.confirmLocalExecutionEvidence === undefined
      ? {}
      : {
          confirmLocalExecutionEvidence: input.confirmLocalExecutionEvidence,
        }),
    profile: input.profile,
    runtimeReportSubmission,
    ...(input.writeMode ? { writeMode: input.writeMode } : {}),
  });
  return {
    agentProfileBindingEnsure,
    profileId: input.profile.openMeldProfileId,
    runtimeReport: buildSelectedAgentControllerReportResult({
      agentControllerRef: agentController.ref,
      agentId: agentController.id,
      reportInput,
      runtimeReportSubmission,
    }),
  };
}

function buildSelectedAgentControllerReportResult(input: {
  agentControllerRef: string;
  agentId: string;
  reportInput: {
    localParticipationState: SelectedAgentControllerReportResult["localParticipationState"];
    reasonCodes: readonly string[];
  };
  runtimeReportSubmission: RuntimeAgentControllerReportSubmission;
}): SelectedAgentControllerReportResult {
  return {
    agentId: input.agentId,
    agentControllerRef: input.agentControllerRef,
    localParticipationState: input.reportInput.localParticipationState,
    reasonCodes: [...input.reportInput.reasonCodes],
    runtimeReportSubmission: input.runtimeReportSubmission,
  };
}

function canBindExplicitLocalAgentForNewProfileSelection(
  target: Awaited<ReturnType<typeof resolveAgentTargetState>>
): boolean {
  return (
    target?.targetKind === "builtin" &&
    target.lifecycleStatus !== "suspended" &&
    target.selectable
  );
}

function resolveDefaultTransportModeForLocalAgent(input: {
  agentControllerRef: string;
  localAgentId: string;
}): RuntimeAgentTransportMode {
  const runtimeAdapterContract =
    resolveRegistryRuntimeAdapterContractByAgentControllerRef(
      input.agentControllerRef
    );
  return (
    runtimeAdapterContract?.defaultTransportMode ??
    runtimeAdapterContract?.transportModes[0] ??
    createDefaultRuntimeAgentControllerSettings(input.localAgentId)
      .transportMode
  );
}

async function prepareLocalAgentLaunchIfNeeded(input: {
  interactive: boolean;
  profile: OpenMeldProfile;
  reasonCodes: readonly string[];
  view?: string;
}): Promise<
  | {
      status: "cancelled" | "unchanged";
    }
  | {
      snapshot: ProfileReadinessSnapshot;
      status: "prepared";
    }
> {
  if (needsLocalAgentLaunchChoice(input.reasonCodes)) {
    const enableResult = await runAgentsEnable({
      agent: [await requireProfileLocalAgentId(input.profile, "enable")],
      interactive: input.interactive,
      view: input.view,
    });
    if (enableResult.status === "cancelled") {
      return { status: "cancelled" };
    }
    assertLocalAgentLaunchPreparationCompleted({
      profileId: input.profile.openMeldProfileId,
      result: enableResult,
    });
    return {
      snapshot: await resolveProfileReadinessSnapshot(input.profile),
      status: "prepared",
    };
  }

  if (needsLocalAgentLaunchRepair(input.reasonCodes)) {
    const repairResult = await runAgentsRepair({
      agent: [await requireProfileLocalAgentId(input.profile, "repair")],
      interactive: input.interactive,
      view: input.view,
    });
    if (repairResult.status === "cancelled") {
      return { status: "cancelled" };
    }
    assertLocalAgentLaunchPreparationCompleted({
      profileId: input.profile.openMeldProfileId,
      result: repairResult,
    });
    return {
      snapshot: await resolveProfileReadinessSnapshot(input.profile),
      status: "prepared",
    };
  }

  return { status: "unchanged" };
}

async function repairProfileReadinessState(input: {
  profile: OpenMeldProfile;
  reasonCodes: readonly string[];
  view?: string;
}): Promise<{ prepared: boolean }> {
  let prepared = false;

  if (input.reasonCodes.includes("projection.missing")) {
    await syncDeviceRuntimeStateProjection({
      mode: "repair",
    });
    prepared = true;
  }

  if (
    input.reasonCodes.includes("workspace.missing") ||
    input.reasonCodes.includes("workspace.invalid")
  ) {
    const workspaceSync = await syncProfileWorkspaceState({
      mode: "repair",
      profileIds: [input.profile.openMeldProfileId],
    });
    if (
      didWorkspaceRepairPrepareProfile({
        profileId: input.profile.openMeldProfileId,
        workspaceSync,
      })
    ) {
      prepared = true;
    }
  }

  return { prepared };
}

function needsControllerSetup(input: {
  profile: OpenMeldProfile;
  reasonCodes: readonly string[];
}): boolean {
  return (
    input.reasonCodes.includes("agent_profile_binding.missing") ||
    input.reasonCodes.includes("agent_profile_binding.owner_missing") ||
    input.reasonCodes.includes("profile.unbound") ||
    input.reasonCodes.includes("controller.binding.disabled")
  );
}

function needsLocalAgentLaunchChoice(reasonCodes: readonly string[]): boolean {
  return reasonCodes.includes("controller.launch.choice_required");
}

function needsLocalAgentLaunchRepair(reasonCodes: readonly string[]): boolean {
  return (
    !needsLocalAgentLaunchChoice(reasonCodes) &&
    reasonCodes.includes("controller.launch.needs_repair")
  );
}

async function resolveProfileLocalAgentId(
  profile: OpenMeldProfile
): Promise<string | null> {
  const executionTarget = await resolveAgentProfilePrimaryAgentControllerReport(
    {
      profile,
    }
  ).catch(() => null);
  return executionTarget?.localAgentId ?? null;
}

async function requireProfileLocalAgentId(
  profile: OpenMeldProfile,
  action: "enable" | "repair"
): Promise<string> {
  const agentId = await resolveProfileLocalAgentId(profile);
  if (agentId) {
    return agentId;
  }

  if (action === "enable") {
    throw new Error(
      "OpenMeld found more than one local agent install for this profile, but could not identify which local agent the profile uses. Run `openmeld agents enable --agent <agent-id>` and choose one install before running setup again."
    );
  }

  throw new Error(
    "OpenMeld found that this profile's local agent needs repair, but could not identify which local agent the profile uses. Run `openmeld agents repair --agent <agent-id>` before running setup again."
  );
}

function assertLocalAgentLaunchPreparationCompleted(input: {
  profileId: string;
  result: AgentsEnableResult | AgentsRepairResult;
}): void {
  if (input.result.status === "back") {
    throw new Error(
      "OpenMeld local agent preparation cannot continue until you choose one local agent install."
    );
  }

  const blockingError = input.result.summary.errors[0] ?? null;
  if (!blockingError) {
    return;
  }

  throw new Error(
    formatLocalAgentLaunchPreparationFailure({
      error: blockingError,
      profileId: input.profileId,
    })
  );
}

function formatLocalAgentLaunchPreparationFailure(input: {
  error: AgentsEnableResult["summary"]["errors"][number];
  profileId: string;
}): string {
  if (input.error.code === "controller.launch.choice_required") {
    const commands = resolveLocalAgentChoiceCommands({
      agentId: input.error.agentId,
      nextSteps: input.error.nextSteps,
      installChoices: input.error.installChoices,
    });
    const reason =
      normalizeOptionalText(input.error.reason) ||
      `OpenMeld found more than one ${input.error.agentId} install on this computer.`;
    if (commands.length > 0) {
      return `${reason} Run one of these commands first: ${formatCommandChoiceList(commands)}. Then run \`openmeld setup --profile ${input.profileId}\` again.`;
    }
    return `${reason} Run \`openmeld agents enable --agent ${input.error.agentId}\` in an interactive Terminal and choose one install. Then run \`openmeld setup --profile ${input.profileId}\` again.`;
  }

  if (input.error.code === "controller.launch.needs_repair") {
    return `OpenMeld could not connect ${input.error.agentId} on this computer. Run \`openmeld agents repair --agent ${input.error.agentId}\`, then run \`openmeld setup --profile ${input.profileId}\` again. Detail: ${input.error.reason}`;
  }

  const nextStep = input.error.nextSteps?.[0] ?? null;
  if (nextStep) {
    return `OpenMeld could not connect ${input.error.agentId} on this computer. Run \`${nextStep}\`, then run \`openmeld setup --profile ${input.profileId}\` again. Detail: ${input.error.reason}`;
  }

  return `OpenMeld could not connect ${input.error.agentId} on this computer. Detail: ${input.error.reason}`;
}

function resolveLocalAgentChoiceCommands(input: {
  agentId: string;
  installChoices?: AgentsEnableResult["summary"]["errors"][number]["installChoices"];
  nextSteps?: readonly string[];
}): string[] {
  if (input.nextSteps && input.nextSteps.length > 0) {
    return [...input.nextSteps];
  }

  return (input.installChoices ?? []).map(
    (installChoice) =>
      `openmeld agents enable --agent ${input.agentId} --install ${installChoice.installId}`
  );
}

function formatCommandChoiceList(commands: readonly string[]): string {
  return commands.map((command) => `\`${command}\``).join(" or ");
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

async function resolveProfileReadinessSnapshot(profile: OpenMeldProfile) {
  return await resolveCurrentReplyReadinessSnapshot({
    checkGatewayChain: false,
    ownerUserId: profile.ownerUserId,
    profile,
  });
}

function collectPreparationReasonCodes(
  snapshot: Awaited<ReturnType<typeof resolveProfileReadinessSnapshot>>
): string[] {
  const reasonCodes: string[] = [];
  for (const reasonCode of snapshot.deviceReplyReadiness.reasonCodes) {
    if (!reasonCodes.includes(reasonCode)) {
      reasonCodes.push(reasonCode);
    }
  }
  for (const reasonCode of snapshot.agentReplyReadiness?.reasonCodes ?? []) {
    if (!reasonCodes.includes(reasonCode)) {
      reasonCodes.push(reasonCode);
    }
  }
  return reasonCodes;
}

function didWorkspaceRepairPrepareProfile(input: {
  profileId: string;
  workspaceSync: ProfileWorkspaceStateSyncResult;
}): boolean {
  if (input.workspaceSync.status === "skipped") {
    return false;
  }

  if (!input.workspaceSync.projectedProfileIds.includes(input.profileId)) {
    return false;
  }

  return !(
    input.workspaceSync.invalidWorkspaceProfileIds.includes(input.profileId) ||
    input.workspaceSync.missingWorkspaceProfileIds.includes(input.profileId)
  );
}
