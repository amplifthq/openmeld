import type { AgentTargetState } from "../agents/registry";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
} from "../runtime/cli-entry-command";
import {
  formatSpaceMemberCommandRecoveryCopy,
  REPLY_READINESS_COPY,
  resolveReplyReadinessAvailabilityReasonCopy,
} from "../system/reply-readiness-copy";
import type { ServiceParticipationReadiness } from "../system/service-participation-readiness";
import { normalizeOptionalString } from "./command-http-errors";
import { sanitizeSingleLinePromptText } from "./command-input-normalizers";

export type SpaceMembershipProfileKind = "human" | "agent";

export type SpaceMemberCandidate = {
  openMeldProfile?: OpenMeldProfile;
  profileId: string;
  profileHandle?: string;
  profileName: string;
  profileKind: SpaceMembershipProfileKind;
  targetMentionLabel?: string | null;
  ownerProfileName?: string;
  ownerUserId?: string;
  ownerName?: string;
  agentControllerRef?: string;
  controllerEnabled?: boolean;
  localTargetAgentId?: string | null;
  localTargetDisplayName?: string | null;
  localTargetLaunchStatus?: AgentTargetState["launchStatus"] | null;
  localTargetSelectable?: boolean;
  localParticipationBindingConfirmed?: boolean;
  localParticipationReadiness?: ServiceParticipationReadiness | null;
  localParticipationChecked?: boolean;
  localParticipationReasonCodes?: string[];
  localParticipationReasonText?: string | null;
  alreadyJoined: boolean;
  needsActivation: boolean;
  organizationDirectoryProfile?: boolean;
  isOrganizationCenterAgent?: boolean;
};

type SpaceMemberRecoveryNextAction =
  | {
      command: string;
      kind: "command";
    }
  | {
      instruction: string;
      kind: "instruction";
    };

const SPACE_MEMBER_PROFILE_CONNECTION_REASON_CODES: ReadonlySet<string> =
  new Set(["profile.unbound", "agent_profile_binding.missing"]);

const SPACE_MEMBER_PROFILE_RECONNECT_REASON_CODES: ReadonlySet<string> =
  new Set([
    "agent_profile_binding.owner_mismatch",
    "agent_profile_binding.runtime_mismatch",
    "agent_profile_binding.capability_mismatch",
    "claim_eligibility.binding_capability_mismatch",
    "claim_eligibility.binding_owner_mismatch",
    "claim_eligibility.binding_runtime_mismatch",
    "claim_eligibility.owner_mismatch",
    "claim_eligibility.openmeld_service_runtime_id_mismatch",
    "local_service.identity_mismatch",
  ]);

const SPACE_MEMBER_SERVICE_STATUS_REASON_CODES: ReadonlySet<string> = new Set([
  "agent_profile_binding.local_service_not_connected",
  "agent_profile_binding.execution_readiness_pending",
  "route.offline",
  "route.not_registered",
  "service.gateway_chain_unhealthy",
  "dispatch.storage_not_ready",
]);

const SPACE_MEMBER_LOCAL_AGENT_REPAIR_REASON_CODES: ReadonlySet<string> =
  new Set([
    "controller.launch.needs_repair",
    "controller.launch.choice_required",
    "workspace.missing",
    "workspace.invalid",
    "controller.bootstrap.failed",
    "controller.gateway.unhealthy",
  ]);

export function resolveSpaceMemberJoinOnlyNextAction(
  candidate: Pick<
    SpaceMemberCandidate,
    | "controllerEnabled"
    | "agentControllerRef"
    | "localParticipationReadiness"
    | "localParticipationReasonCodes"
    | "localTargetAgentId"
    | "profileId"
  >
): SpaceMemberRecoveryNextAction {
  if (candidate.localParticipationReadiness === "not_running") {
    return {
      command: buildSpaceMemberProfileStatusCommand(candidate.profileId),
      kind: "command",
    };
  }
  if (candidate.localParticipationReadiness === "not_installed") {
    return {
      command: buildSpaceMemberProfileStatusCommand(candidate.profileId),
      kind: "command",
    };
  }
  if (
    candidate.localParticipationReadiness === "needs_repair" ||
    hasSpaceMemberReasonCode(
      candidate,
      SPACE_MEMBER_LOCAL_AGENT_REPAIR_REASON_CODES
    )
  ) {
    return {
      command: buildSpaceMemberRepairCommand({
        agentId: candidate.localTargetAgentId,
        profileId: candidate.profileId,
      }),
      kind: "command",
    };
  }
  if (
    hasSpaceMemberReasonCode(
      candidate,
      SPACE_MEMBER_SERVICE_STATUS_REASON_CODES
    )
  ) {
    const profileConnectionAction =
      resolveSpaceMemberProfileConnectionAction(candidate);
    if (profileConnectionAction) {
      return profileConnectionAction;
    }
    return {
      command: buildSpaceMemberProfileStatusCommand(candidate.profileId),
      kind: "command",
    };
  }
  const profileConnectionAction =
    resolveSpaceMemberProfileConnectionAction(candidate);
  if (profileConnectionAction) {
    return profileConnectionAction;
  }
  return {
    instruction: REPLY_READINESS_COPY.spaceMember.checkProfileInstruction,
    kind: "instruction",
  };
}

export function resolveSpaceMemberCandidateStatusLabel(
  candidate: SpaceMemberCandidate
): string | null {
  const statuses = resolveSpaceMemberCandidateStatusBadges(candidate);
  if (statuses.length === 0) {
    return null;
  }
  return statuses.join(" · ");
}

const TRAILING_PERIOD_RE = /\.$/u;

export function resolveSpaceMemberCandidateStatusBadges(
  candidate: SpaceMemberCandidate
): string[] {
  if (candidate.profileKind !== "agent") {
    return [];
  }
  if (candidate.localParticipationChecked !== true) {
    return [];
  }
  if (isSpaceMemberCandidateBackgroundReplyReady(candidate)) {
    return [REPLY_READINESS_COPY.spaceMember.connectedBadge];
  }
  if (isSpaceMemberCandidateRepairableLocalParticipationCandidate(candidate)) {
    return [REPLY_READINESS_COPY.spaceMember.needsRepairBadge];
  }
  return [
    resolveSpaceMemberJoinOnlyReason(candidate).replace(TRAILING_PERIOD_RE, ""),
    REPLY_READINESS_COPY.spaceMember.joinsOnlyBadge,
  ];
}

export function isSpaceMemberCandidateBackgroundReplyReady(
  candidate: Pick<
    SpaceMemberCandidate,
    | "profileKind"
    | "agentControllerRef"
    | "controllerEnabled"
    | "localTargetSelectable"
    | "localParticipationReadiness"
  >
): boolean {
  return (
    candidate.profileKind === "agent" &&
    candidate.controllerEnabled === true &&
    typeof candidate.agentControllerRef === "string" &&
    candidate.agentControllerRef.trim().length > 0 &&
    candidate.localTargetSelectable === true &&
    candidate.localParticipationReadiness === "ready"
  );
}

export function isSpaceMemberCandidateRepairableLocalParticipationCandidate(
  candidate: Pick<
    SpaceMemberCandidate,
    | "profileKind"
    | "agentControllerRef"
    | "controllerEnabled"
    | "localTargetAgentId"
    | "localTargetLaunchStatus"
    | "localParticipationReadiness"
  >
): boolean {
  return (
    candidate.profileKind === "agent" &&
    candidate.controllerEnabled === true &&
    typeof candidate.agentControllerRef === "string" &&
    candidate.agentControllerRef.trim().length > 0 &&
    ((typeof candidate.localTargetAgentId === "string" &&
      candidate.localTargetAgentId.trim().length > 0 &&
      candidate.localTargetLaunchStatus === "needs_repair") ||
      candidate.localParticipationReadiness === "needs_repair")
  );
}

export function resolveSpaceMemberJoinOnlyReason(
  candidate: Pick<
    SpaceMemberCandidate,
    | "controllerEnabled"
    | "agentControllerRef"
    | "localParticipationReadiness"
    | "localParticipationReasonText"
  >
): string {
  if (
    candidate.controllerEnabled !== true ||
    typeof candidate.agentControllerRef !== "string" ||
    candidate.agentControllerRef.trim().length === 0
  ) {
    return resolveReplyReadinessAvailabilityReasonCopy("profile.unbound");
  }
  if (candidate.localParticipationReadiness === "not_running") {
    return resolveReplyReadinessAvailabilityReasonCopy("service.not_running");
  }
  if (candidate.localParticipationReadiness === "not_installed") {
    return resolveReplyReadinessAvailabilityReasonCopy("service.not_installed");
  }
  const reasonText = normalizeOptionalString(
    candidate.localParticipationReasonText
  );
  if (reasonText) {
    const sanitizedReasonText = sanitizeSingleLinePromptText(reasonText);
    if (sanitizedReasonText) {
      return sanitizedReasonText.endsWith(".")
        ? sanitizedReasonText
        : `${sanitizedReasonText}.`;
    }
  }
  return REPLY_READINESS_COPY.spaceMember.incompleteReason;
}

function resolveSpaceMemberProfileConnectionAction(
  candidate: Pick<
    SpaceMemberCandidate,
    "controllerEnabled" | "agentControllerRef" | "localParticipationReasonCodes"
  >
): SpaceMemberRecoveryNextAction | null {
  const reasonCodes = candidate.localParticipationReasonCodes ?? [];
  if (
    reasonCodes.some((reasonCode) =>
      SPACE_MEMBER_PROFILE_RECONNECT_REASON_CODES.has(reasonCode)
    )
  ) {
    return {
      instruction: REPLY_READINESS_COPY.spaceMember.reconnectProfileInstruction,
      kind: "instruction",
    };
  }
  if (
    candidate.controllerEnabled !== true ||
    typeof candidate.agentControllerRef !== "string" ||
    candidate.agentControllerRef.trim().length === 0 ||
    reasonCodes.some((reasonCode) =>
      SPACE_MEMBER_PROFILE_CONNECTION_REASON_CODES.has(reasonCode)
    )
  ) {
    return {
      instruction:
        REPLY_READINESS_COPY.spaceMember.selectProfileAgentInstruction,
      kind: "instruction",
    };
  }
  if (reasonCodes.includes("controller.binding.disabled")) {
    return {
      instruction:
        REPLY_READINESS_COPY.spaceMember.turnOnProfileAgentInstruction,
      kind: "instruction",
    };
  }
  return null;
}

function hasSpaceMemberReasonCode(
  candidate: Pick<SpaceMemberCandidate, "localParticipationReasonCodes">,
  reasonCodes: ReadonlySet<string>
): boolean {
  return (candidate.localParticipationReasonCodes ?? []).some((reasonCode) =>
    reasonCodes.has(reasonCode)
  );
}

export function formatSpaceMemberRecoveryNextAction(
  action: SpaceMemberRecoveryNextAction
): string {
  if (action.kind === "instruction") {
    return action.instruction;
  }
  if (action.command === "openmeld agents list") {
    return formatInlineOpenMeldCliCommands(
      REPLY_READINESS_COPY.spaceMember.agentsListRepairInstruction
    );
  }
  return formatSpaceMemberCommandRecoveryCopy(
    formatOpenMeldCliCommand(action.command)
  );
}

export function resolveSpaceMemberTerminalProfileLabel(
  profileName: unknown
): string {
  const normalizedProfileName = normalizeOptionalString(profileName);
  return (
    sanitizeSingleLinePromptText(normalizedProfileName) ||
    REPLY_READINESS_COPY.spaceMember.fallbackProfileLabel
  );
}

export function resolveSpaceMemberTerminalLocalTargetLabel(input: {
  displayName?: string | null;
  agentId?: string | null;
}): string {
  const displayName = sanitizeSingleLinePromptText(input.displayName);
  if (displayName) {
    return displayName;
  }
  const agentId = sanitizeSingleLinePromptText(input.agentId);
  if (agentId) {
    return agentId;
  }
  return REPLY_READINESS_COPY.spaceMember.fallbackLocalTargetLabel;
}

function buildSpaceMemberProfileStatusCommand(profileId: string): string {
  const sanitizedProfileId = sanitizeSingleLinePromptText(profileId);
  return sanitizedProfileId
    ? `openmeld service status --profile ${sanitizedProfileId}`
    : "openmeld service status";
}

export function buildSpaceMemberRepairCommand(input: {
  agentId?: string | null;
  profileId: string;
}): string {
  const sanitizedAgentId = sanitizeSingleLinePromptText(input.agentId);
  if (sanitizedAgentId) {
    return `openmeld agents repair --agent ${sanitizedAgentId}`;
  }
  return "openmeld agents list";
}
