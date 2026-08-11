import {
  resolvePublicAgentAvailabilityCopy,
  resolvePublicAgentFailureRecovery,
} from "@openmeld/schemas";
import type {
  ReplyReadinessLevel,
  ReplyReadinessReasonCode,
} from "@openmeld/schemas/types";

type CliOnlyReplyReadinessReasonCode =
  | "controller.binding.disabled"
  | "local_agents.none_needed"
  | "profile.inactive"
  | "profile.not_selected"
  | "projection.missing"
  | "runtime.adapter.unsupported"
  | "service.account_mismatch"
  | "service.auth_missing"
  | "service.auth_stale"
  | "service.gateway_chain_unhealthy";

type SharedRecoveryOnlyReplyReadinessReasonCode =
  | "controller.launch.choice_required"
  | "controller.launch.needs_repair"
  | "dispatch.storage_not_ready"
  | "workspace.invalid"
  | "workspace.missing";

const DEFAULT_CLI_GUIDANCE_SUMMARY =
  "This profile can't reply until local setup is fixed.";

// These codes describe CLI-only local inspection facts. Every other
// ReplyReadinessReasonCode is shared with the public schemas dictionary.
const CLI_ONLY_AVAILABILITY_COPY = {
  "controller.binding.disabled":
    "The local agent connection is turned off for this profile.",
  "local_agents.none_needed":
    "No local agents on this device need OpenMeld Service right now.",
  "profile.inactive": "This profile is not active.",
  "profile.not_selected":
    "Choose an Agent Profile to check local reply routes.",
  "projection.missing":
    "OpenMeld is still setting up this device. Run `openmeld doctor --repair`.",
  "runtime.adapter.unsupported":
    "The local agent controller setup is not supported.",
  "service.account_mismatch":
    "OpenMeld Service is signed in to a different OpenMeld account.",
  "service.auth_missing": "OpenMeld Service is not signed in.",
  "service.auth_stale": "OpenMeld Service needs a fresh sign-in.",
  "service.gateway_chain_unhealthy":
    "The OpenMeld gateway authentication chain is unavailable.",
} as const satisfies Record<CliOnlyReplyReadinessReasonCode, string>;

const CLI_ONLY_GUIDANCE_COPY = {
  "controller.binding.disabled": "This profile's agent is turned off.",
  "local_agents.none_needed":
    "This device does not need OpenMeld Service until you choose local agents to bring into a space.",
  "profile.inactive": "Choose an active agent profile first.",
  "profile.not_selected": DEFAULT_CLI_GUIDANCE_SUMMARY,
  "projection.missing": "OpenMeld is still setting up this device.",
  "runtime.adapter.unsupported":
    "This agent setup can't reply from this device.",
  "service.account_mismatch": DEFAULT_CLI_GUIDANCE_SUMMARY,
  "service.auth_missing": DEFAULT_CLI_GUIDANCE_SUMMARY,
  "service.auth_stale": DEFAULT_CLI_GUIDANCE_SUMMARY,
  "service.gateway_chain_unhealthy":
    "OpenMeld can't reach the gateway for this device yet.",
} as const satisfies Record<CliOnlyReplyReadinessReasonCode, string>;

export const REPLY_READINESS_COPY = {
  agentReadyReason: "This profile can reply from Space when mentioned",
  canReplyLabel: "Can reply",
  deviceReadyReason:
    "This device is ready for Space replies from local agent profiles",
  localAgentRecoveryTargetLabel: "A local agent",
  manualSpaceParticipation:
    "You can still join the space and send messages yourself.",
  spaceMember: {
    agentsListRepairInstruction:
      "Use `openmeld agents list` to find the local agent that needs repair.",
    checkProfileInstruction:
      "Open Local Agents in OpenMeld Web and check this profile.",
    connectedBadge: "Local setup connected",
    fallbackLocalTargetLabel: "this local agent",
    fallbackProfileLabel: "This agent",
    incompleteReason: "Local setup on this device is still incomplete.",
    joinsOnlyBadge: "Joins only for now",
    needsRepairBadge: "Needs repair",
    reconnectProfileInstruction:
      "Open this Agent in OpenMeld Web and reconnect it to the right local agent on this device.",
    selectProfileAgentInstruction:
      "Open this Agent in OpenMeld Web and choose the local agent that should handle work from the Space.",
    turnOnProfileAgentInstruction:
      "Open this Agent in OpenMeld Web and turn on its local agent connection.",
  },
  guidance: {
    readyMentionInstruction:
      'Send a message with an exact mention like "@Name(wake)".',
    readySummary:
      'This agent can reply in a space when you mention it with "@Name(wake)".',
    selectProfileAgentInstruction:
      "Open this Agent in OpenMeld Web and choose a local agent.",
    turnOnProfileAgentInstruction:
      "Open this Agent in OpenMeld Web and turn on its local agent connection.",
  },
} as const;

const REPLY_READINESS_LABEL_PREFIX = {
  blocked: "Blocked",
  degraded: "Limited",
  unknown: "Unknown",
} as const satisfies Record<Exclude<ReplyReadinessLevel, "ready">, string>;

export function resolveReplyReadinessAvailabilityReasonCopy(
  reasonCode: ReplyReadinessReasonCode
): string {
  // Availability surfaces describe the current local device, so they must use
  // the shared availabilitySummary tense rather than recovery instructions.
  const sharedAvailability =
    resolvePublicAgentAvailabilityCopy(reasonCode)?.availabilitySummary;
  if (sharedAvailability) {
    return adaptSharedCopyToLocalDevice(sharedAvailability);
  }
  if (isCliOnlyReplyReadinessReasonCode(reasonCode)) {
    return CLI_ONLY_AVAILABILITY_COPY[reasonCode];
  }
  throw new Error(
    `Shared availability copy is missing for CLI reply-readiness reason code: ${reasonCode}`
  );
}

export function resolveReplyReadinessStatusReasonCopy(
  reasonCode: ReplyReadinessReasonCode
): string {
  // These codes are local check failures, not simple availability facts, and
  // the shared dictionary intentionally exposes only their recovery body. The
  // readiness reason slot therefore uses that shared failure/recovery domain.
  if (isSharedRecoveryOnlyReplyReadinessReasonCode(reasonCode)) {
    return resolveSharedRecoveryBody(reasonCode);
  }
  return resolveReplyReadinessAvailabilityReasonCopy(reasonCode);
}

export function resolveReplyReadinessGuidanceSummaryCopy(
  reasonCode: ReplyReadinessReasonCode,
  context: { targetLabel?: string } = {}
): string {
  // Guidance explains a failure and its repair path, so the shared recovery
  // body is the canonical source rather than the present-tense availability.
  if (isCliOnlyReplyReadinessReasonCode(reasonCode)) {
    return CLI_ONLY_GUIDANCE_COPY[reasonCode];
  }
  return resolveSharedRecoveryBody(reasonCode, context.targetLabel);
}

export function resolveReplyReadinessReconnectingReasonCopy(): string {
  return requireSharedAvailabilitySummary("local_service.reconnecting");
}

export function formatReplyReadinessUnavailableLabelCopy(
  level: Exclude<ReplyReadinessLevel, "ready">,
  reasonText: string
): string {
  return `${REPLY_READINESS_LABEL_PREFIX[level]} (${reasonText})`;
}

export function formatManualSpaceParticipationReasonCopy(
  availabilityReason: string
): string {
  return `${availabilityReason} ${REPLY_READINESS_COPY.manualSpaceParticipation}`;
}

export function formatSpaceMemberCommandRecoveryCopy(
  formattedCommand: string
): string {
  return `Use \`${formattedCommand}\` to check the local reply path.`;
}

function resolveSharedRecoveryBody(
  reasonCode: ReplyReadinessReasonCode,
  targetLabel = "This profile"
): string {
  const recovery = resolvePublicAgentFailureRecovery({
    errorCode: reasonCode,
    includeUnknown: false,
    targetLabel,
  });
  if (!recovery) {
    throw new Error(
      `Shared recovery copy is missing for CLI reply-readiness reason code: ${reasonCode}`
    );
  }
  return adaptSharedCopyToLocalDevice(recovery.body);
}

function requireSharedAvailabilitySummary(reasonCode: string): string {
  const availabilitySummary =
    resolvePublicAgentAvailabilityCopy(reasonCode)?.availabilitySummary;
  if (!availabilitySummary) {
    throw new Error(
      `Shared availability copy is missing for CLI reply-readiness reason code: ${reasonCode}`
    );
  }
  return adaptSharedCopyToLocalDevice(availabilitySummary);
}

function isCliOnlyReplyReadinessReasonCode(
  reasonCode: ReplyReadinessReasonCode
): reasonCode is CliOnlyReplyReadinessReasonCode {
  return Object.hasOwn(CLI_ONLY_AVAILABILITY_COPY, reasonCode);
}

function isSharedRecoveryOnlyReplyReadinessReasonCode(
  reasonCode: ReplyReadinessReasonCode
): reasonCode is SharedRecoveryOnlyReplyReadinessReasonCode {
  return SHARED_RECOVERY_ONLY_REASON_CODES.has(reasonCode);
}

const SHARED_RECOVERY_ONLY_REASON_CODES: ReadonlySet<ReplyReadinessReasonCode> =
  new Set([
    "controller.launch.choice_required",
    "controller.launch.needs_repair",
    "dispatch.storage_not_ready",
    "workspace.invalid",
    "workspace.missing",
  ] satisfies readonly SharedRecoveryOnlyReplyReadinessReasonCode[]);

function adaptSharedCopyToLocalDevice(copy: string): string {
  // Shared copy speaks about another agent's computer. The CLI runs on the
  // inspected machine, so only the subject is adapted; the sentence and
  // recovery meaning remain owned by @openmeld/schemas.
  return copy
    .replaceAll("its computer", "this device")
    .replaceAll("this computer", "this device");
}
