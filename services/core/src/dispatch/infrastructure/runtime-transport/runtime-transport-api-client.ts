import type { CoreBindings } from "../../../lib/bindings";
import { CORE_LOG_EVENTS } from "../../../shared/observability/log-events";
import {
  RUNTIME_TRANSPORT_DELIVER_TIMEOUT_MS,
  RUNTIME_TRANSPORT_LOOKUP_TIMEOUT_MS,
  RUNTIME_TRANSPORT_WAIT_TIMEOUT_FALLBACK_MS,
  RUNTIME_TRANSPORT_WAIT_TIMEOUT_GRACE_MS,
  RUNTIME_TRANSPORT_WAIT_TIMEOUT_MAX_MS,
} from "../../../strategy-constants";
import { resolveRuntimeTransportOwnerShard } from "./runtime-transport-shard";

export type RuntimeTransportApiPath =
  | "/computer-power"
  | "/session-history"
  | "/lookup-route"
  | "/lookup-routes-batch"
  | "/lookup-owner-service"
  | "/diagnostics/disconnect-rates"
  | "/computer-file-access/read-policy"
  | "/computer-file-access/update-policy"
  | "/local-folder-picker/select-folders"
  | "/local-agent-control/installations"
  | "/local-agent-control/fork-session"
  | "/local-agent-control/refresh-catalog"
  | "/local-agent-control/set-enabled"
  | "/local-agent-control/set-profile-workspace"
  | "/local-agent-control/read-profile-workspace"
  | "/local-agent-control/manage-profile-folders"
  | "/local-agent-control/read-profile-folder-projection"
  | "/openmeld-tools-control"
  | "/local-project-control/connect-candidate"
  | "/local-project-control/connect-declared-path"
  | "/local-project-control/discover-projects"
  | "/local-project-control/remove-connection"
  | "/local-project-control/remove-missing-connections"
  | "/local-project-control/set-default-connection"
  | "/deliver-dispatch"
  | "/runtime-coordinator/decide"
  | "/runtime-coordinator/head/accept"
  | "/runtime-coordinator/head/no-execution"
  | "/runtime-coordinator/head/pre-agent-stop"
  | "/runtime-coordinator/head/waiting"
  | "/runtime-coordinator/head/trace"
  | "/runtime-coordinator/interaction/read"
  | "/runtime-coordinator/interaction/read-revision"
  | "/runtime-coordinator/execution-input/resolve"
  | "/runtime-coordinator/execution-input"
  | "/runtime-coordinator/interaction/respond"
  | "/runtime-coordinator/pre-execution-handoff"
  | "/runtime-coordinator/wake-stop"
  | "/runtime-coordinator/wake-stop/publication-eligibility"
  | "/route-catalog-changed"
  | "/wait-dispatch-result";

export const callRuntimeTransportApi = async (input: {
  env: CoreBindings;
  ownerUserId: string;
  path: RuntimeTransportApiPath;
  query?: Record<string, string>;
  body: unknown;
}): Promise<unknown> => {
  const shard = resolveRuntimeTransportOwnerShard(input.env, input.ownerUserId);
  const requestUrl = new URL(`https://runtime-transport.internal${input.path}`);
  if (input.query) {
    requestUrl.search = new URLSearchParams(input.query).toString();
  }
  const requestTimeoutMs = resolveRuntimeTransportApiTimeoutMs({
    path: input.path,
    body: input.body,
  });
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, requestTimeoutMs);

  let response: Response;
  try {
    response = await shard.fetch(requestUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input.body),
      signal: abortController.signal,
    });
  } catch {
    if (abortController.signal.aborted) {
      console.warn("[core.runtime_transport_client.request_timeout]", {
        event: CORE_LOG_EVENTS.runtimeTransportClientRequestTimeout,
        path: input.path,
        timeoutMs: requestTimeoutMs,
      });
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }

  const parsedBody = await parseJsonBody(response);
  if (response.ok) {
    return parsedBody;
  }

  if (parsedBody !== null) {
    return parsedBody;
  }

  return resolveRuntimeTransportApiFallbackResponse({
    body: input.body,
    path: input.path,
    status: response.status,
  });
};

const resolveRuntimeTransportApiFallbackResponse = (input: {
  body: unknown;
  path: RuntimeTransportApiPath;
  status: number;
}): unknown | null => {
  if (input.path === "/lookup-route" && input.status === 404) {
    return {
      online: false,
      reasonCode: "daemon.session.not_found",
    };
  }
  if (input.path === "/wait-dispatch-result" && input.status === 409) {
    return {
      state: "failed",
      reasonCode: "daemon.delivery.timeout",
    };
  }
  if (input.path === "/deliver-dispatch" && input.status === 409) {
    return {
      accepted: false,
      status: "rejected",
      reasonCode: "daemon.delivery.timeout",
    };
  }
  if (input.status < 500) {
    return null;
  }
  if (input.status === 503) {
    return resolveRuntimeTransportApiRestartingFallback({
      body: input.body,
      path: input.path,
    });
  }
  return resolveRuntimeTransportApiServerErrorFallback(input.path);
};

const resolveRuntimeTransportApiRestartingFallback = (input: {
  body: unknown;
  path: RuntimeTransportApiPath;
}): unknown => {
  if (input.path === "/local-folder-picker/select-folders") {
    return {
      code: "local.folder_picker.service_offline",
      message: "The current local OpenMeld Service is not connected.",
      status: "unavailable",
    };
  }
  if (input.path.startsWith("/computer-file-access/")) {
    return {
      status: "rejected",
      code: "computer.file_access.service_offline",
      message: "The current local OpenMeld Service is not connected.",
    };
  }
  if (input.path.startsWith("/local-project-control/")) {
    return {
      status: "rejected",
      code: "service_offline",
      message: "The current local OpenMeld Service is not connected.",
    };
  }
  if (input.path === "/local-agent-control/fork-session") {
    return null;
  }
  if (input.path === "/runtime-coordinator/head/accept") {
    return {
      ok: false,
      primaryDispatchId: null,
      reasonCode: "core.transport_restarting",
      status: "retry_later",
      targetWakeLifecycleId: resolveFallbackTargetWakeLifecycleId(input.body),
    };
  }
  if (input.path === "/runtime-coordinator/head/no-execution") {
    return {
      ok: false,
      primaryDispatchId: null,
      publicationIntentId: null,
      reasonCode: "core.transport_restarting",
      runtimeCoordinatorExecutionId: null,
      status: "retry_later",
      targetWakeLifecycleId: resolveFallbackTargetWakeLifecycleId(input.body),
    };
  }
  if (input.path === "/runtime-coordinator/head/pre-agent-stop") {
    return {
      ok: false,
      primaryDispatchId: null,
      publicationIntentId: null,
      reasonCode: "core.transport_restarting",
      runtimeCoordinatorExecutionId: null,
      status: "retry_later",
      targetWakeLifecycleId: resolveFallbackTargetWakeLifecycleId(input.body),
    };
  }
  if (input.path === "/runtime-coordinator/head/waiting") {
    return {
      ok: false,
      primaryDispatchId: null,
      reasonCode: "core.transport_restarting",
      runtimeCoordinatorExecutionId: null,
      status: "retry_later",
      targetWakeLifecycleId: resolveFallbackTargetWakeLifecycleId(input.body),
    };
  }
  if (input.path === "/runtime-coordinator/head/trace") {
    return {
      ok: false,
      readStatus: "authority_unavailable",
      reasonCode: "core.transport_restarting",
      targetWakeLifecycleId: "unknown",
    };
  }
  if (input.path === "/runtime-coordinator/decide") {
    return {
      ok: false,
      reasonCode: "core.transport_restarting",
      runtimeCoordinatorExecutionId:
        resolveFallbackRuntimeCoordinatorExecutionId(input.body),
      status: "retry_later",
    };
  }
  if (input.path === "/wait-dispatch-result") {
    return {
      state: "failed",
      reasonCode: "core.transport_restarting",
    };
  }
  if (input.path === "/deliver-dispatch") {
    return {
      accepted: false,
      status: "rejected",
      reasonCode: "core.transport_restarting",
    };
  }
  if (input.path === "/diagnostics/disconnect-rates") {
    return {
      ok: false,
      reasonCode: "core.transport_restarting",
      buckets: [],
      recentSessions: [],
    };
  }
  return {
    online: false,
    reasonCode: "core.transport_restarting",
  };
};

const resolveFallbackTargetWakeLifecycleId = (body: unknown): string => {
  if (body && typeof body === "object") {
    const identity = (body as { targetWakeLifecycleIdentity?: unknown })
      .targetWakeLifecycleIdentity;
    if (identity && typeof identity === "object") {
      const targetWakeLifecycleId = normalizeOptionalText(
        (identity as { targetWakeLifecycleId?: unknown }).targetWakeLifecycleId
      );
      if (targetWakeLifecycleId) {
        return targetWakeLifecycleId;
      }
    }
  }
  return "unknown";
};

const resolveFallbackRuntimeCoordinatorExecutionId = (
  body: unknown
): string => {
  if (body && typeof body === "object") {
    return (
      normalizeOptionalText(
        (body as { runtimeCoordinatorExecutionId?: unknown })
          .runtimeCoordinatorExecutionId
      ) ?? "unknown"
    );
  }
  return "unknown";
};

const resolveRuntimeTransportApiServerErrorFallback = (
  path: RuntimeTransportApiPath
): unknown => {
  if (path === "/local-folder-picker/select-folders") {
    return {
      code: "local.folder_picker.internal_error",
      message: "Folder selection is temporarily unavailable.",
      status: "unavailable",
    };
  }
  if (path.startsWith("/computer-file-access/")) {
    return {
      status: "rejected",
      code: "computer.file_access.internal_error",
      message: "Computer file access is temporarily unavailable.",
    };
  }
  if (path.startsWith("/local-project-control/")) {
    return {
      status: "rejected",
      code: "internal_error",
      message: "Local Project control is temporarily unavailable.",
    };
  }
  if (path === "/runtime-coordinator/head/accept") {
    return {
      ok: false,
      primaryDispatchId: null,
      reasonCode: "runtime_coordinator.head_accept_unavailable",
      status: "retry_later",
      targetWakeLifecycleId: "",
    };
  }
  if (path === "/runtime-coordinator/head/no-execution") {
    return {
      ok: false,
      primaryDispatchId: null,
      publicationIntentId: null,
      reasonCode: "runtime_coordinator.head_no_execution_unavailable",
      runtimeCoordinatorExecutionId: null,
      status: "retry_later",
      targetWakeLifecycleId: "",
    };
  }
  if (path === "/runtime-coordinator/head/pre-agent-stop") {
    return {
      ok: false,
      primaryDispatchId: null,
      publicationIntentId: null,
      reasonCode: "runtime_coordinator.pre_agent_stop_unavailable",
      runtimeCoordinatorExecutionId: null,
      status: "retry_later",
      targetWakeLifecycleId: "",
    };
  }
  if (path === "/runtime-coordinator/head/waiting") {
    return {
      ok: false,
      primaryDispatchId: null,
      reasonCode: "runtime_coordinator.head_waiting_unavailable",
      runtimeCoordinatorExecutionId: null,
      status: "retry_later",
      targetWakeLifecycleId: "",
    };
  }
  if (path === "/runtime-coordinator/head/trace") {
    return {
      ok: false,
      readStatus: "authority_unavailable",
      reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
      targetWakeLifecycleId: "unknown",
    };
  }
  if (path === "/wait-dispatch-result") {
    return {
      state: "failed",
      reasonCode: "daemon.delivery.timeout",
    };
  }
  if (path === "/deliver-dispatch") {
    return {
      accepted: false,
      status: "rejected",
      reasonCode: "daemon.delivery.timeout",
    };
  }
  if (path === "/diagnostics/disconnect-rates") {
    return {
      ok: false,
      reasonCode: "runtime_transport.disconnect_rates_unavailable",
      buckets: [],
      recentSessions: [],
    };
  }
  return {
    online: false,
    reasonCode: "daemon.delivery.timeout",
  };
};

const resolveRuntimeTransportApiTimeoutMs = (input: {
  path: RuntimeTransportApiPath;
  body: unknown;
}): number => {
  if (input.path === "/local-folder-picker/select-folders") {
    return 610_000;
  }
  if (input.path === "/session-history") {
    return 38_000;
  }
  if (input.path.startsWith("/local-project-control/")) {
    return 38_000;
  }
  if (input.path === "/local-agent-control/fork-session") {
    return 38_000;
  }
  if (
    input.path === "/lookup-route" ||
    input.path === "/lookup-owner-service" ||
    input.path === "/diagnostics/disconnect-rates"
  ) {
    return RUNTIME_TRANSPORT_LOOKUP_TIMEOUT_MS;
  }
  if (input.path === "/deliver-dispatch") {
    return RUNTIME_TRANSPORT_DELIVER_TIMEOUT_MS;
  }
  if (input.path === "/route-catalog-changed") {
    return RUNTIME_TRANSPORT_LOOKUP_TIMEOUT_MS;
  }
  if (input.path === "/runtime-coordinator/pre-execution-handoff") {
    return RUNTIME_TRANSPORT_LOOKUP_TIMEOUT_MS;
  }
  if (input.path === "/runtime-coordinator/head/accept") {
    return RUNTIME_TRANSPORT_LOOKUP_TIMEOUT_MS;
  }
  if (input.path === "/runtime-coordinator/head/no-execution") {
    return RUNTIME_TRANSPORT_LOOKUP_TIMEOUT_MS;
  }
  if (input.path === "/runtime-coordinator/head/pre-agent-stop") {
    return RUNTIME_TRANSPORT_LOOKUP_TIMEOUT_MS;
  }
  if (input.path === "/runtime-coordinator/head/waiting") {
    return RUNTIME_TRANSPORT_LOOKUP_TIMEOUT_MS;
  }
  if (input.path === "/runtime-coordinator/head/trace") {
    return RUNTIME_TRANSPORT_LOOKUP_TIMEOUT_MS;
  }
  if (input.path === "/runtime-coordinator/wake-stop") {
    return RUNTIME_TRANSPORT_LOOKUP_TIMEOUT_MS;
  }
  if (
    input.path === "/runtime-coordinator/interaction/read" ||
    input.path === "/runtime-coordinator/interaction/read-revision" ||
    input.path === "/runtime-coordinator/interaction/respond"
  ) {
    return RUNTIME_TRANSPORT_LOOKUP_TIMEOUT_MS;
  }

  const requestedWaitTimeoutMs = resolveRequestedWaitTimeoutMs(input.body);
  const withGrace =
    requestedWaitTimeoutMs + RUNTIME_TRANSPORT_WAIT_TIMEOUT_GRACE_MS;
  return Math.min(RUNTIME_TRANSPORT_WAIT_TIMEOUT_MAX_MS, withGrace);
};

const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const resolveRequestedWaitTimeoutMs = (value: unknown): number => {
  if (!value || typeof value !== "object") {
    return RUNTIME_TRANSPORT_WAIT_TIMEOUT_FALLBACK_MS;
  }

  const timeoutMs = (value as { timeoutMs?: unknown }).timeoutMs;
  if (!(typeof timeoutMs === "number" && Number.isFinite(timeoutMs))) {
    return RUNTIME_TRANSPORT_WAIT_TIMEOUT_FALLBACK_MS;
  }

  return Math.max(1, Math.trunc(timeoutMs));
};

const parseJsonBody = async (response: Response): Promise<unknown | null> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};
