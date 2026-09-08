import { isAgentWakeAdmissionPreparationPendingReason } from "@openmeld/agent-runtime";
import {
  AGENT_REPLYING_END_PURPOSE,
  AGENT_REPLYING_PURPOSE,
  resolveMappedPublicAgentFailureReason,
} from "@openmeld/schemas";

export const DISPATCH_HINT_SYSTEM_PROFILE_ID = "openmeld-system";
export const DISPATCH_HINT_SYSTEM_PROFILE_NAME = "OpenMeld System";
export const DISPATCH_REPLYING_HINT_START_PURPOSE = AGENT_REPLYING_PURPOSE;
export const DISPATCH_REPLYING_HINT_END_PURPOSE = AGENT_REPLYING_END_PURPOSE;

const DISPATCH_REPLYING_HINT_SUFFIX = "is replying...";
const DISPATCH_TARGET_PROFILE_IDENTITY_RETRYABLE_ERROR_CODES = [
  "dispatch.target_profile_identity.auth_rpc_unavailable",
  "dispatch.target_profile_identity.auth_rpc_failed",
] as const;

const DISPATCH_TARGET_PROFILE_IDENTITY_NON_RETRYABLE_ERROR_CODES = [
  "dispatch.target_profile_identity.lookup_failed",
] as const;

const DISPATCH_HINT_ELIGIBLE_ERROR_CODES = new Set([
  "agent_profile_work_coordinator.continuation_needs_attention",
  "agent_profile_work_coordinator.queue_full",
  "daemon.profile.offline",
  "daemon.profile.configuration_not_synced",
  "daemon.delivery.timeout",
  "daemon.session.stale_lease",
  "daemon.session.reject_conflict",
  "stale_lease_result_rejected",
  "timeout",
  "timed_out_no_output",
  "timed_out_after_output",
  "controller.binding.missing",
  "controller.binding.disabled",
  "controller.binding.lookup_failed",
  "agent_profile_binding.lookup_failed",
  "agent_profile_binding.profile_owner_invalid",
  "agent_profile_binding.profile_owner_unavailable",
  "service.update_required",
  "controller.runtime.missing",
  "controller.client.upgrade_required",
  "config.invalid",
  "upstream_unreachable",
  "provider.process_terminated",
  "provider_exit_error",
  "upstream.5xx",
  "network.transient",
  "permission.denied.runtime",
  "interaction.permission_required",
  "interaction.question_required",
  "interaction.plan_required",
  "interaction.unsupported",
  "model.unavailable",
  "model.reasoning_unsupported",
  "auth.required",
  "usage_exhausted",
  "quota.exceeded",
  "rate_limited",
  "schema.invalid.runtime_response",
  "runtime.reply.metadata_missing.agent_controller_ref",
  "context.rebuild_failed",
  "context_not_found",
  ...DISPATCH_TARGET_PROFILE_IDENTITY_RETRYABLE_ERROR_CODES,
  ...DISPATCH_TARGET_PROFILE_IDENTITY_NON_RETRYABLE_ERROR_CODES,
]);

const DISPATCH_RAW_ERROR_HINT_CODES = new Set([
  "permission.denied.runtime",
  "auth.required",
  "quota.exceeded",
  "rate_limited",
]);

// Codes that are deliberately invisible to the Space: they describe internal
// bookkeeping outcomes (another dispatch already owns this Wake), not a user
// -facing failure. Silence must stay an explicit exception here — every other
// unknown code falls back to generic visible copy, because allowlist rot has
// already produced fully silent terminal failures in production.
const DISPATCH_FAILURE_COPY_SILENT_ERROR_CODES = new Set([
  "runtime.task.deduped",
]);

const formatDispatchActivityTargetLabel = (
  targetProfileLabel: string
): string => {
  const normalized = normalizeOptionalText(targetProfileLabel) ?? "agent";
  return normalized.startsWith("@") ? normalized : `@${normalized}`;
};

const resolveDispatchFailureCopy = (input: {
  errorCode: string;
  errorMessage?: string;
  targetProfileLabel: string;
}): {
  activityText: string | null;
  transcriptText: string | null;
} => {
  if (DISPATCH_FAILURE_COPY_SILENT_ERROR_CODES.has(input.errorCode)) {
    return {
      activityText: null,
      transcriptText: null,
    };
  }

  if (!DISPATCH_HINT_ELIGIBLE_ERROR_CODES.has(input.errorCode)) {
    // Fail-visible fallback for codes the allowlist does not know: generic
    // copy instead of silence, so a new or forgotten terminal code can never
    // make a Wake disappear without a receipt again.
    return {
      activityText: resolveKnownDispatchFailureActivityText(input),
      transcriptText: `${input.targetProfileLabel} couldn't reply. This Wake failed and will not retry automatically.`,
    };
  }

  if (DISPATCH_RAW_ERROR_HINT_CODES.has(input.errorCode)) {
    return {
      activityText: `${formatDispatchActivityTargetLabel(input.targetProfileLabel)} needs access to reply`,
      transcriptText:
        resolveMappedPublicAgentFailureReason(
          input.errorCode,
          input.targetProfileLabel
        ) ??
        `${input.targetProfileLabel} couldn't reply because its local agent returned an error. The Agent Profile owner can open Message Details to see the original response.`,
    };
  }

  return {
    activityText: resolveKnownDispatchFailureActivityText(input),
    transcriptText:
      resolveKnownDispatchFailureHintText(input) ??
      resolveMappedPublicAgentFailureReason(input.errorCode) ??
      `${input.targetProfileLabel} is temporarily unavailable. Ask the owner to run OpenMeld service status and retry if the issue persists.`,
  };
};

export const buildDispatchingActivityText = (
  targetProfileLabel: string
): string => {
  return `Dispatching to ${formatDispatchActivityTargetLabel(targetProfileLabel)}...`;
};

export const buildRetryingActivityText = (input: {
  errorCode?: string | null;
  targetProfileLabel: string;
}): string => {
  const targetLabel = formatDispatchActivityTargetLabel(
    input.targetProfileLabel
  );
  if (isAgentWakeAdmissionPreparationPendingReason(input.errorCode ?? "")) {
    return `Preparing ${targetLabel}. Your message is saved; it will run when ready.`;
  }
  switch (input.errorCode) {
    case "daemon.profile.pending_first_report":
      return `Waiting for ${targetLabel} to become ready...`;
    case "daemon.profile.offline":
    case "daemon.session.connection_replaced":
    case "daemon.session.not_found":
    case "daemon.session.stale_lease":
    case "stale_lease_result_rejected":
      return `Waiting for ${targetLabel} to reconnect...`;
    case "daemon.delivery.timeout":
      return `Still waiting for ${targetLabel}...`;
    case "daemon.profile.configuration_not_synced":
      return `Waiting for ${targetLabel} to apply the latest settings...`;
    default:
      return `Retrying ${targetLabel}...`;
  }
};

export const buildReplyingHintText = (targetProfileLabel: string): string => {
  return `${formatDispatchActivityTargetLabel(targetProfileLabel)} ${DISPATCH_REPLYING_HINT_SUFFIX}`;
};

export type DispatchFailureHintContext =
  | "preflight_terminal"
  | "execution_terminal";

// Exactly one channel owns the persistent Space-visible receipt per failure
// stage. Execution-stage terminal failures are published by the
// RuntimeCoordinator head finalization/publication pipeline; persisting them
// from the queue layer too would double-notify the Space. Preflight terminal
// failures settle before any RuntimeCoordinator head is accepted — often with
// no resolvable owner to route a head through at all — so the queue layer is
// the only channel that can leave a visible receipt, and it must persist one
// for every error code.
export const shouldPersistDispatchFailureHintToSpaceHistory = (input: {
  errorCode: string;
  failureContext: DispatchFailureHintContext;
}): boolean => {
  return input.failureContext === "preflight_terminal";
};

export const resolveDispatchFailureHintText = (input: {
  errorCode: string;
  errorMessage?: string;
  targetProfileLabel: string;
}): string | null => {
  return resolveDispatchFailureCopy(input).transcriptText;
};

export const resolveDispatchFailureActivityText = (input: {
  errorCode: string;
  errorMessage?: string;
  targetProfileLabel: string;
}): string | null => {
  return resolveDispatchFailureCopy(input).activityText;
};

const resolveKnownDispatchFailureHintText = (input: {
  errorCode: string;
  errorMessage?: string;
  targetProfileLabel: string;
}): string | null => {
  switch (input.errorCode) {
    case "agent_profile_work_coordinator.continuation_needs_attention":
      return `${input.targetProfileLabel}'s settings changed after this interrupted Wake was approved, so OpenMeld did not continue it. Review the interrupted Wake, then retry it or continue the queued Wakes.`;
    case "agent_profile_work_coordinator.queue_full":
      return `${input.targetProfileLabel}'s local work queue is full, so this Wake was not accepted. Wait for an earlier Wake to finish, then try again.`;
    case "daemon.profile.offline":
    case "daemon.session.not_found":
      return `${input.targetProfileLabel} is offline or reconnecting. OpenMeld service may be running, but this target profile has no active daemon route right now. Retry in a few seconds.`;
    case "daemon.profile.configuration_not_synced":
      return `${input.targetProfileLabel}'s local OpenMeld Service has not applied the latest Agent Profile settings yet. Keep it running and try again.`;
    case "daemon.delivery.timeout":
      return `${input.targetProfileLabel} cold-start timed out. Keep OpenMeld running and retry.`;
    case "timeout":
      return `${input.targetProfileLabel} was stopped by this computer's local adapter process timeout. Retry with a shorter request or adjust the local adapter timeout.`;
    case "timed_out_no_output":
      return `${input.targetProfileLabel} produced no runtime output before this computer's local adapter process timeout and was stopped. Check network/provider availability and retry.`;
    case "timed_out_after_output":
      return `${input.targetProfileLabel} started responding but hit this computer's local adapter process timeout before finishing. Retry with a shorter request or adjust the local adapter timeout.`;
    case "daemon.session.stale_lease":
    case "stale_lease_result_rejected":
      return `${input.targetProfileLabel} has stale daemon lease. Restart OpenMeld on active device and retry.`;
    case "daemon.session.reject_conflict":
      return `${input.targetProfileLabel} has duplicate online sessions. Ask the owner to keep only one OpenMeld Service runtime online and retry.`;
    case "controller.binding.missing":
      return `${input.targetProfileLabel} lacks a controller binding. Reconnect the agent controller and retry.`;
    case "controller.binding.disabled":
      return `${input.targetProfileLabel} is disabled in controller binding. Enable the controller and retry.`;
    case "controller.binding.lookup_failed":
      return `${input.targetProfileLabel} could not be routed because OpenMeld could not resolve its controller binding. Retry in a few seconds. If it keeps happening, ask the owner to run OpenMeld service status.`;
    case "agent_profile_binding.lookup_failed":
    case "agent_profile_binding.profile_owner_unavailable":
      return `${input.targetProfileLabel} could not be routed because OpenMeld could not resolve its local agent connection. Retry in a few seconds. If it keeps happening, reconnect the local agent.`;
    // Deleted Profile Identity Verdict: the target identity is gone (deleted
    // from Auth) or retired (no longer an active agent profile). Terminal
    // wording only — never a reconnect/update/repair/retry action, because
    // nothing on any computer can repair a dead identity. One copy covers
    // both sub-causes on purpose; they are the same verdict to the user.
    case "agent_profile_binding.profile_owner_invalid":
      return `${input.targetProfileLabel} no longer exists or was retired, so this Wake cannot be delivered.`;
    case "service.update_required":
      return `${input.targetProfileLabel} needs OpenMeld Service updated on this computer before it can reply.`;
    case "config.invalid":
      return `${input.targetProfileLabel} has invalid local runtime setup. Ask the owner to check the controller CLI settings, especially the selected model, then retry.`;
    case "controller.client.upgrade_required":
      return `${input.targetProfileLabel} is using an older local Codex install than the current model requires. Upgrade Codex on the target device, then retry.`;
    case "schema.invalid.runtime_response":
    case "runtime.reply.metadata_missing.agent_controller_ref":
      return `${input.targetProfileLabel} returned an invalid reply. Check OpenMeld runtime logs on the target device and retry.`;
    case "context.rebuild_failed":
      return `${input.targetProfileLabel} failed to rebuild conversation context. Restart OpenMeld on the target device and retry.`;
    case "context_not_found":
      return `${input.targetProfileLabel} could not reopen its saved local conversation. This was not a model-provider or network failure. Wake the agent again to start a fresh local conversation.`;
    case "provider.process_terminated":
      return `${input.targetProfileLabel}'s local provider process was stopped before it returned a reply. This does not mean the selected model is unavailable. Check OpenMeld runtime logs on the target device before trying again.`;
    case "provider_exit_error":
      return `${input.targetProfileLabel} exited before returning a valid reply. Check OpenMeld runtime logs on the target device and retry.`;
    case "dispatch.target_profile_identity.auth_rpc_unavailable":
    case "dispatch.target_profile_identity.auth_rpc_failed":
      return `OpenMeld could not reach the auth worker while resolving ${input.targetProfileLabel}. Retry in a few seconds. If it keeps happening, ask the owner to run OpenMeld service status.`;
    case "dispatch.target_profile_identity.lookup_failed":
      return `OpenMeld could not resolve ${input.targetProfileLabel} from the auth worker. Confirm the target profile still exists, then retry.`;
    default:
      return null;
  }
};

const resolveKnownDispatchFailureActivityText = (input: {
  errorCode: string;
  targetProfileLabel: string;
}): string => {
  const activityTargetLabel = formatDispatchActivityTargetLabel(
    input.targetProfileLabel
  );
  switch (input.errorCode) {
    case "agent_profile_work_coordinator.continuation_needs_attention":
      return `${activityTargetLabel} needs the interrupted Wake reviewed`;
    case "agent_profile_work_coordinator.queue_full":
      return `${activityTargetLabel}'s local work queue is full`;
    case "daemon.profile.offline":
    case "daemon.session.not_found":
      return `${activityTargetLabel} is offline right now`;
    case "daemon.delivery.timeout":
    case "timeout":
    case "timed_out_no_output":
    case "timed_out_after_output":
      return `${activityTargetLabel} timed out`;
    case "daemon.session.stale_lease":
    case "stale_lease_result_rejected":
    case "daemon.session.reject_conflict":
    case "controller.binding.missing":
    case "controller.binding.disabled":
    case "controller.binding.lookup_failed":
    case "agent_profile_binding.lookup_failed":
    case "agent_profile_binding.profile_owner_unavailable":
    case "controller.runtime.missing":
    case "service.update_required":
      return `Couldn't route ${activityTargetLabel} right now`;
    case "agent_profile_binding.profile_owner_invalid":
      return `${activityTargetLabel} no longer exists`;
    case "controller.client.upgrade_required":
      return `${activityTargetLabel} needs Codex upgraded on this device`;
    case "config.invalid":
      return `${activityTargetLabel} needs local runtime setup fixed`;
    case "interaction.permission_required":
    case "interaction.question_required":
    case "interaction.plan_required":
    case "interaction.unsupported":
      return `${activityTargetLabel} needs your input`;
    case "model.unavailable":
    case "model.reasoning_unsupported":
      return `${activityTargetLabel} needs agent settings updated`;
    case "upstream_unreachable":
    case "upstream.5xx":
    case "network.transient":
      return `Couldn't reach ${activityTargetLabel} right now`;
    case "schema.invalid.runtime_response":
    case "runtime.reply.metadata_missing.agent_controller_ref":
    case "context.rebuild_failed":
    case "provider.process_terminated":
    case "provider_exit_error":
      return `${activityTargetLabel} couldn't finish replying`;
    case "context_not_found":
      return `${activityTargetLabel} couldn't reopen its local conversation`;
    case "dispatch.target_profile_identity.auth_rpc_unavailable":
    case "dispatch.target_profile_identity.auth_rpc_failed":
      return `Couldn't reach OpenMeld auth for ${activityTargetLabel} right now`;
    case "dispatch.target_profile_identity.lookup_failed":
      return `Couldn't resolve ${activityTargetLabel} right now`;
    default:
      return `${activityTargetLabel} couldn't reply right now`;
  }
};

const normalizeText = (value: unknown): string => {
  return String(value ?? "").trim();
};

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
};
