import {
  computeDispatchRetryDelaySeconds,
  DISPATCH_OFFLINE_RETRY_BACKOFF_SECONDS,
  DISPATCH_OFFLINE_RETRY_MAX_ATTEMPTS,
  shouldRetryDispatchAttempt,
} from "./dispatch-runtime-constants";

const DISPATCH_OFFLINE_RETRY_ERROR_CODES = new Set([
  "daemon.session.connection_replaced",
  "daemon.service.draining",
  "daemon.profile.offline",
  "daemon.profile.configuration_not_synced",
  "daemon.delivery.timeout",
  "daemon.session.not_found",
  "runtime_coordinator.head_execution_link_unavailable",
  "runtime_coordinator.execution_token_unavailable",
  "stale_lease_result_rejected",
]);

export const RUNTIME_TASK_DEDUPED_ERROR_CODE = "runtime.task.deduped";
export const RUNTIME_TASK_DEDUPED_CORRELATION_LOST_ERROR_CODE =
  "dispatch.result.correlation_lost";

const DISPATCH_ATTEMPT_TIMEOUT_ERROR_CODES = new Set([
  "daemon.delivery.timeout",
  "daemon.delivery.start_timeout",
  "daemon.delivery.execution_stalled",
  "daemon.delivery.finalization_timeout",
  "timeout",
  "timed_out_no_output",
  "timed_out_after_output",
]);

const DISPATCH_TARGET_PROFILE_IDENTITY_RETRYABLE_ERROR_CODES = [
  "dispatch.target_profile_identity.auth_rpc_unavailable",
  "dispatch.target_profile_identity.auth_rpc_failed",
] as const;

const DISPATCH_TARGET_PROFILE_IDENTITY_NON_RETRYABLE_ERROR_CODES = [
  "dispatch.target_profile_identity.lookup_failed",
] as const;

const RETRYABLE_DISPATCH_ERROR_CODES = new Set([
  "daemon.session.connection_replaced",
  "daemon.service.draining",
  "daemon.profile.offline",
  "daemon.profile.configuration_not_synced",
  "daemon.delivery.timeout",
  "daemon.delivery.execution_stalled",
  "daemon.delivery.finalization_timeout",
  "daemon.delivery.start_timeout",
  "daemon.session.not_found",
  "runtime_coordinator.head_execution_link_unavailable",
  "runtime_coordinator.execution_token_unavailable",
  "stale_lease_result_rejected",
  "network.transient",
  "upstream_unreachable",
  "upstream.5xx",
  "agent_profile_binding.lookup_failed",
  "agent_profile_binding.profile_owner_unavailable",
  "organization_binding_authorization.lookup_failed",
  "organization_binding_authorization.space_org_unavailable",
  ...DISPATCH_TARGET_PROFILE_IDENTITY_RETRYABLE_ERROR_CODES,
]);

const NON_RETRYABLE_DISPATCH_ERROR_CODES = new Set([
  "claim_eligibility.",
  "openmeld.space_action.repair_failed",
  "auth.required",
  "quota.exceeded",
  "rate_limited",
  "daemon.session.stale_lease",
  "daemon.session.reject_conflict",
  "controller.binding.missing",
  "controller.binding.lookup_failed",
  "agent_profile_binding.missing",
  "agent_profile_binding.disabled",
  "agent_profile_binding.profile_owner_invalid",
  "agent_profile_binding.owner_mismatch",
  "organization_binding_authorization.required",
  "service.update_required",
  "controller.client.upgrade_required",
  "controller.kind.unsupported",
  "controller.ref.invalid",
  "controller.runtime.missing",
  "center_agent_model_catalog_invalid",
  "center_agent_model_unavailable",
  "center_agent_model_unknown",
  "dispatch.policy.unsupported",
  "runtime.reply.empty_output",
  "runtime.reply.metadata_missing.agent_controller_ref",
  "context.rebuild_failed",
  "config.invalid",
  "schema.invalid",
  "schema.invalid.runtime_response",
  "permission.denied",
  "permission.denied.runtime",
  "space.not_found",
  "unsupported_version",
  "dispatch.snapshot.oversize",
  "runtime.task.local_owner_conflict",
  "runtime_coordinator.execution_token_scope_mismatch",
  "timeout",
  "timed_out_no_output",
  "timed_out_after_output",
  "provider.process_terminated",
  "provider_exit_error",
  ...DISPATCH_TARGET_PROFILE_IDENTITY_NON_RETRYABLE_ERROR_CODES,
]);

// A missing table/column/index is a schema/migration fault, never transient.
// The release flow migrates before Core deploys, so if a dispatch query ever
// raises one it must fail loud and terminal rather than burn the retry budget.
// This is the fail-loud half of removing the per-batch hot-path storage probe:
// the probe no longer guards the Wake path, so the real query is the detector.
const D1_SCHEMA_ERROR_MESSAGE_FRAGMENTS = [
  "no such table",
  "no such column",
  "no such index",
] as const;

export const DISPATCH_STORAGE_SCHEMA_MISSING_ERROR_CODE =
  "dispatch.storage.schema_missing";

export const isD1SchemaError = (errorMessage: string): boolean => {
  const normalized = errorMessage.toLowerCase();
  return D1_SCHEMA_ERROR_MESSAGE_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment)
  );
};

export type DispatchErrorCategory = "retryable" | "non_retryable" | "unknown";

export const isRuntimeTaskDedupedErrorCode = (value: unknown): boolean => {
  return (
    typeof value === "string" &&
    value.trim().toLowerCase() === RUNTIME_TASK_DEDUPED_ERROR_CODE
  );
};

export const isDispatchAttemptTimeoutErrorCode = (value: unknown): boolean => {
  return (
    typeof value === "string" &&
    DISPATCH_ATTEMPT_TIMEOUT_ERROR_CODES.has(value.trim().toLowerCase())
  );
};

export const classifyDispatchError = (
  error: unknown,
  errorMessage: string
): DispatchErrorCategory => {
  if (isD1SchemaError(errorMessage)) {
    return "non_retryable";
  }
  const directCode = toErrorCode(error);
  if (directCode) {
    if (matchesErrorCode(directCode, RETRYABLE_DISPATCH_ERROR_CODES)) {
      return "retryable";
    }
    if (matchesErrorCode(directCode, NON_RETRYABLE_DISPATCH_ERROR_CODES)) {
      return "non_retryable";
    }
  }

  if (matchesErrorCode(errorMessage, RETRYABLE_DISPATCH_ERROR_CODES)) {
    return "retryable";
  }
  if (matchesErrorCode(errorMessage, NON_RETRYABLE_DISPATCH_ERROR_CODES)) {
    return "non_retryable";
  }
  return "unknown";
};

export const resolveDispatchErrorCode = (
  error: unknown,
  errorMessage: string
): string => {
  if (isD1SchemaError(errorMessage)) {
    return DISPATCH_STORAGE_SCHEMA_MISSING_ERROR_CODE;
  }
  const directCode = toErrorCode(error);
  if (directCode) {
    return directCode;
  }

  for (const code of RETRYABLE_DISPATCH_ERROR_CODES) {
    if (errorMessage.includes(code)) {
      return code;
    }
  }
  for (const code of NON_RETRYABLE_DISPATCH_ERROR_CODES) {
    if (errorMessage.includes(code)) {
      return code;
    }
  }
  return "dispatch.execution_failed";
};

export const shouldRetryDispatchAttemptForErrorCode = (input: {
  attempt: number;
  errorCode: string;
}): boolean => {
  if (isOfflineRetryErrorCode(input.errorCode)) {
    return input.attempt < DISPATCH_OFFLINE_RETRY_MAX_ATTEMPTS;
  }
  return shouldRetryDispatchAttempt(input.attempt);
};

export const resolveDispatchRetryDelaySeconds = (input: {
  attempt: number;
  errorCode: string;
}): number => {
  return computeDispatchRetryDelaySeconds({
    attempt: input.attempt,
    ...(isOfflineRetryErrorCode(input.errorCode)
      ? {
          backoffSeconds: DISPATCH_OFFLINE_RETRY_BACKOFF_SECONDS,
        }
      : {}),
  });
};

export const isOfflineRetryErrorCode = (errorCode: string): boolean => {
  return matchesErrorCode(errorCode, DISPATCH_OFFLINE_RETRY_ERROR_CODES);
};

const toErrorCode = (error: unknown): string | null => {
  if (!(error && typeof error === "object")) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") {
    return null;
  }
  const normalized = code.trim();
  return normalized.length > 0 ? normalized : null;
};

const matchesErrorCode = (value: string, codeSet: Set<string>): boolean => {
  for (const code of codeSet) {
    if (value === code || value.includes(code)) {
      return true;
    }
  }
  return false;
};
