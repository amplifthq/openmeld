import type {
  OpenMeldDaemonCancelRequestPayload,
  OpenMeldDaemonControlPlaneRequest,
  OpenMeldDaemonControlPlaneResponse,
  OpenMeldDaemonConversationExecutionStatusRequestPayload,
  OpenMeldDaemonHealthPayload,
  OpenMeldDaemonHistoryEntry,
  OpenMeldDaemonInterruptRequestPayload,
  OpenMeldDaemonRequestAgentActivitySyncRequestPayload,
  OpenMeldDaemonServiceUpdateReadinessPayload,
  OpenMeldDaemonSetLocalAgentEnabledRequestPayload,
  OpenMeldDaemonShutdownRequestPayload,
  OpenMeldDaemonStatusPayload,
  OpenMeldDaemonSyncRouteCatalogPayload,
  OpenMeldDaemonSyncRouteCatalogRequestPayload,
} from "@openmeld/schemas";
import {
  openMeldDaemonControlPlaneRequestSchema,
  openMeldDaemonControlPlaneResponseSchema,
} from "@openmeld/schemas";

const DEFAULT_SHUTDOWN_GRACE_PERIOD_MS = 5000;

type OpenMeldDaemonInterruptResponsePayload = Extract<
  OpenMeldDaemonControlPlaneResponse,
  { code: "service.interrupt" }
>["payload"];
type OpenMeldDaemonCancelResponsePayload = Extract<
  OpenMeldDaemonControlPlaneResponse,
  { code: "service.cancel" }
>["payload"];
type OpenMeldDaemonConversationExecutionStatusResponsePayload = Extract<
  OpenMeldDaemonControlPlaneResponse,
  { code: "service.conversation_execution_status" }
>["payload"];
type OpenMeldDaemonSyncRouteCatalogResponsePayload = Extract<
  OpenMeldDaemonControlPlaneResponse,
  { code: "service.sync_route_catalog" }
>["payload"];
type OpenMeldDaemonRequestAgentActivitySyncResponsePayload = Extract<
  OpenMeldDaemonControlPlaneResponse,
  { code: "service.agent_activity_sync_requested" }
>["payload"];
type OpenMeldDaemonSetLocalAgentEnabledResponsePayload = Extract<
  OpenMeldDaemonControlPlaneResponse,
  { code: "service.set_local_agent_enabled" }
>["payload"];
type OpenMeldDaemonShutdownResponsePayload = Extract<
  OpenMeldDaemonControlPlaneResponse,
  { code: "service.shutdown" }
>["payload"];
type OpenMeldDaemonServiceUpdateReadinessResponsePayload = Extract<
  OpenMeldDaemonControlPlaneResponse,
  { code: "service.update_readiness" }
>["payload"];

export type OpenMeldDaemonControlPlaneContext = {
  accountCheckedServiceControl?: boolean;
  healthPayload: OpenMeldDaemonHealthPayload;
  historyEntries: OpenMeldDaemonHistoryEntry[];
  interruptHandler?: (
    payload: OpenMeldDaemonInterruptRequestPayload
  ) =>
    | OpenMeldDaemonInterruptResponsePayload
    | Promise<OpenMeldDaemonInterruptResponsePayload>;
  cancelHandler?: (
    payload: OpenMeldDaemonCancelRequestPayload
  ) =>
    | OpenMeldDaemonCancelResponsePayload
    | Promise<OpenMeldDaemonCancelResponsePayload>;
  conversationExecutionStatusHandler?: (
    payload: OpenMeldDaemonConversationExecutionStatusRequestPayload
  ) =>
    | OpenMeldDaemonConversationExecutionStatusResponsePayload
    | Promise<OpenMeldDaemonConversationExecutionStatusResponsePayload>;
  syncRouteCatalogHandler?: (
    payload: OpenMeldDaemonSyncRouteCatalogRequestPayload
  ) =>
    | OpenMeldDaemonSyncRouteCatalogResponsePayload
    | Promise<OpenMeldDaemonSyncRouteCatalogResponsePayload>;
  requestAgentActivitySyncHandler?: (
    payload: OpenMeldDaemonRequestAgentActivitySyncRequestPayload
  ) =>
    | OpenMeldDaemonRequestAgentActivitySyncResponsePayload
    | Promise<OpenMeldDaemonRequestAgentActivitySyncResponsePayload>;
  setLocalAgentEnabledHandler?: (
    payload: OpenMeldDaemonSetLocalAgentEnabledRequestPayload
  ) =>
    | OpenMeldDaemonSetLocalAgentEnabledResponsePayload
    | Promise<OpenMeldDaemonSetLocalAgentEnabledResponsePayload>;
  shutdownHandler?: (
    payload: OpenMeldDaemonShutdownRequestPayload,
    lifecycle?: {
      onAdmitted: () => void;
    }
  ) =>
    | OpenMeldDaemonShutdownResponsePayload
    | Promise<OpenMeldDaemonShutdownResponsePayload>;
  serviceUpdateReadinessHandler?: () =>
    | OpenMeldDaemonServiceUpdateReadinessPayload
    | Promise<OpenMeldDaemonServiceUpdateReadinessPayload>;
  shutdownIfIdleHandler?: (
    payload: Pick<OpenMeldDaemonShutdownRequestPayload, "gracePeriodMs">,
    lifecycle?: { onAdmitted: () => void }
  ) =>
    | OpenMeldDaemonShutdownResponsePayload
    | Promise<OpenMeldDaemonShutdownResponsePayload>;
  statusPayload: OpenMeldDaemonStatusPayload;
};

export function parseControlPlaneRequest(
  input: unknown
): OpenMeldDaemonControlPlaneRequest {
  const parsed = openMeldDaemonControlPlaneRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("invalid daemon control-plane request");
  }
  return parsed.data;
}

export async function buildControlPlaneResponse(input: {
  context: OpenMeldDaemonControlPlaneContext;
  lifecycle?: {
    onAuthenticated?: () => void;
    onShutdownAdmitted?: () => void;
  };
  request: unknown;
}): Promise<OpenMeldDaemonControlPlaneResponse> {
  const request = parseControlPlaneRequest(input.request);
  const requestMeta = {
    ...(request.requestId ? { requestId: request.requestId } : {}),
    v: request.v,
  };

  switch (request.command) {
    case "status":
      return buildStatusControlPlaneResponse({
        payload: input.context.statusPayload,
        requestMeta,
      });
    case "health":
      return buildHealthControlPlaneResponse({
        payload: input.context.healthPayload,
        requestMeta,
      });
    case "history":
      return buildHistoryControlPlaneResponse({
        payload: {
          entries: input.context.historyEntries,
        },
        requestMeta,
      });
    case "interrupt":
      return await buildInterruptControlPlaneResponse({
        context: input.context,
        payload: request.payload,
        requestMeta,
      });
    case "cancel":
      return await buildCancelControlPlaneResponse({
        context: input.context,
        payload: request.payload,
        requestMeta,
      });
    case "conversation_execution_status":
      return await buildConversationExecutionStatusControlPlaneResponse({
        context: input.context,
        payload: request.payload,
        requestMeta,
      });
    case "sync_route_catalog":
      return await buildSyncRouteCatalogControlPlaneResponse({
        context: input.context,
        payload: request.payload,
        requestMeta,
      });
    case "request_agent_activity_sync":
      return await buildRequestAgentActivitySyncControlPlaneResponse({
        context: input.context,
        payload: request.payload,
        requestMeta,
      });
    case "set_local_agent_enabled":
      return await buildSetLocalAgentEnabledControlPlaneResponse({
        context: input.context,
        payload: request.payload,
        requestMeta,
      });
    case "shutdown":
      return await buildShutdownControlPlaneResponse({
        context: input.context,
        lifecycle: input.lifecycle,
        payload: request.payload,
        requestMeta,
      });
    case "shutdown_if_idle":
      return await buildIdleShutdownControlPlaneResponse({
        context: input.context,
        lifecycle: input.lifecycle,
        payload: request.payload,
        requestMeta,
      });
    case "account_control_capabilities":
      return openMeldDaemonControlPlaneResponseSchema.parse({
        ...requestMeta,
        code: "service.account_control_capabilities",
        payload: {
          supported: input.context.accountCheckedServiceControl === true,
        },
      });
    case "service_update_readiness":
      return await buildServiceUpdateReadinessControlPlaneResponse({
        context: input.context,
        requestMeta,
      });
    default:
      throw new Error("unsupported daemon control-plane command");
  }
}

function buildStatusControlPlaneResponse(input: {
  payload: OpenMeldDaemonStatusPayload;
  requestMeta: {
    requestId?: string;
    v: OpenMeldDaemonControlPlaneRequest["v"];
  };
}): OpenMeldDaemonControlPlaneResponse {
  return parseControlPlaneResponse({
    ...input.requestMeta,
    code: "service.status",
    payload: input.payload,
  });
}

function buildHealthControlPlaneResponse(input: {
  payload: OpenMeldDaemonHealthPayload;
  requestMeta: {
    requestId?: string;
    v: OpenMeldDaemonControlPlaneRequest["v"];
  };
}): OpenMeldDaemonControlPlaneResponse {
  return parseControlPlaneResponse({
    ...input.requestMeta,
    code: "service.health",
    payload: input.payload,
  });
}

function buildHistoryControlPlaneResponse(input: {
  payload: {
    entries: OpenMeldDaemonHistoryEntry[];
  };
  requestMeta: {
    requestId?: string;
    v: OpenMeldDaemonControlPlaneRequest["v"];
  };
}): OpenMeldDaemonControlPlaneResponse {
  return parseControlPlaneResponse({
    ...input.requestMeta,
    code: "service.history",
    payload: input.payload,
  });
}

async function buildInterruptControlPlaneResponse(input: {
  context: OpenMeldDaemonControlPlaneContext;
  payload: OpenMeldDaemonInterruptRequestPayload;
  requestMeta: {
    requestId?: string;
    v: OpenMeldDaemonControlPlaneRequest["v"];
  };
}): Promise<OpenMeldDaemonControlPlaneResponse> {
  const payload = input.context.interruptHandler
    ? await input.context.interruptHandler(input.payload)
    : {
        accepted: false,
        note: "interrupt_not_implemented",
        target: input.payload.target,
      };
  return parseControlPlaneResponse({
    ...input.requestMeta,
    code: "service.interrupt",
    payload,
  });
}

async function buildCancelControlPlaneResponse(input: {
  context: OpenMeldDaemonControlPlaneContext;
  payload: OpenMeldDaemonCancelRequestPayload;
  requestMeta: {
    requestId?: string;
    v: OpenMeldDaemonControlPlaneRequest["v"];
  };
}): Promise<OpenMeldDaemonControlPlaneResponse> {
  const payload = input.context.cancelHandler
    ? await input.context.cancelHandler(input.payload)
    : {
        accepted: false,
        note: "cancel_not_implemented",
        target: input.payload.target,
      };
  return parseControlPlaneResponse({
    ...input.requestMeta,
    code: "service.cancel",
    payload,
  });
}

async function buildConversationExecutionStatusControlPlaneResponse(input: {
  context: OpenMeldDaemonControlPlaneContext;
  payload: OpenMeldDaemonConversationExecutionStatusRequestPayload;
  requestMeta: {
    requestId?: string;
    v: OpenMeldDaemonControlPlaneRequest["v"];
  };
}): Promise<OpenMeldDaemonControlPlaneResponse> {
  const payload: OpenMeldDaemonConversationExecutionStatusResponsePayload =
    input.context.conversationExecutionStatusHandler
      ? await input.context.conversationExecutionStatusHandler(input.payload)
      : {
          agentContextLookupKey: [
            input.payload.spaceId,
            input.payload.targetProfileId,
            encodeURIComponent(input.payload.agentControllerRef),
            input.payload.transportMode,
            "runtime-workspace-unresolved",
          ].join("|"),
          controllerLaunchStatus: "missing",
          executionState: null,
          localRuntimeContext: {
            agentContextLookupKey: [
              input.payload.spaceId,
              input.payload.targetProfileId,
              encodeURIComponent(input.payload.agentControllerRef),
              input.payload.transportMode,
              "runtime-workspace-unresolved",
            ].join("|"),
            runtimeWorkspaceFingerprint: null,
            status: "missing",
          },
          providerConversationProof: {
            agentControllerConversationId:
              input.payload.agentControllerConversationId,
            checkedAt: null,
            errorCode: null,
            errorMessage: null,
            errorType: null,
            expiresAt: null,
            intrusive: false,
            method: null,
            provider: null,
            status: "not_run",
            transportMode: input.payload.transportMode,
          },
          runtimeWorkspace: {
            configPath: ".",
            configuredWorkspacePath: null,
            fingerprint: null,
            path: null,
            reasonCode: "workspace.missing",
            reasonText:
              "Conversation execution status handler is not available on this device.",
            runtimeContext: null,
            status: "missing",
            workspaceMode: null,
          },
        };
  return parseControlPlaneResponse({
    ...input.requestMeta,
    code: "service.conversation_execution_status",
    payload,
  });
}

async function buildIdleShutdownControlPlaneResponse(input: {
  context: OpenMeldDaemonControlPlaneContext;
  lifecycle?: { onShutdownAdmitted?: () => void };
  payload: Extract<
    OpenMeldDaemonControlPlaneRequest,
    { command: "shutdown_if_idle" }
  >["payload"];
  requestMeta: Pick<OpenMeldDaemonControlPlaneRequest, "v" | "requestId">;
}): Promise<OpenMeldDaemonControlPlaneResponse> {
  if (!input.context.shutdownIfIdleHandler) {
    return parseControlPlaneResponse({
      ...input.requestMeta,
      code: "service.error",
      payload: {
        errorCode: "daemon.control.contract_mismatch",
        errorMessage:
          "This Service does not support an idle-only update switch.",
      },
    });
  }
  const payload = await input.context.shutdownIfIdleHandler(
    input.payload ?? { gracePeriodMs: DEFAULT_SHUTDOWN_GRACE_PERIOD_MS },
    input.lifecycle?.onShutdownAdmitted
      ? { onAdmitted: input.lifecycle.onShutdownAdmitted }
      : undefined
  );
  return parseControlPlaneResponse({
    ...input.requestMeta,
    code: "service.shutdown",
    payload,
  });
}

async function buildShutdownControlPlaneResponse(input: {
  context: OpenMeldDaemonControlPlaneContext;
  lifecycle?: {
    onShutdownAdmitted?: () => void;
  };
  payload: OpenMeldDaemonShutdownRequestPayload | undefined;
  requestMeta: {
    requestId?: string;
    v: OpenMeldDaemonControlPlaneRequest["v"];
  };
}): Promise<OpenMeldDaemonControlPlaneResponse> {
  const resolvedShutdownPayload = input.payload ?? {
    mode: "graceful",
    gracePeriodMs: DEFAULT_SHUTDOWN_GRACE_PERIOD_MS,
  };
  const payload = input.context.shutdownHandler
    ? await input.context.shutdownHandler(
        resolvedShutdownPayload,
        input.lifecycle?.onShutdownAdmitted
          ? { onAdmitted: input.lifecycle.onShutdownAdmitted }
          : undefined
      )
    : {
        accepted: false,
        mode: resolvedShutdownPayload.mode,
        gracePeriodMs: resolvedShutdownPayload.gracePeriodMs,
      };
  return parseControlPlaneResponse({
    ...input.requestMeta,
    code: "service.shutdown",
    payload,
  });
}

async function buildServiceUpdateReadinessControlPlaneResponse(input: {
  context: OpenMeldDaemonControlPlaneContext;
  requestMeta: {
    requestId?: string;
    v: OpenMeldDaemonControlPlaneRequest["v"];
  };
}): Promise<OpenMeldDaemonControlPlaneResponse> {
  const payload: OpenMeldDaemonServiceUpdateReadinessResponsePayload = input
    .context.serviceUpdateReadinessHandler
    ? await input.context.serviceUpdateReadinessHandler()
    : {
        acceptedWakeCount: 0,
        safeToSwitch: false,
        unacknowledgedResultCount: 0,
      };
  return parseControlPlaneResponse({
    ...input.requestMeta,
    code: "service.update_readiness",
    payload,
  });
}

async function buildSyncRouteCatalogControlPlaneResponse(input: {
  context: OpenMeldDaemonControlPlaneContext;
  payload: OpenMeldDaemonSyncRouteCatalogRequestPayload;
  requestMeta: {
    requestId?: string;
    v: OpenMeldDaemonControlPlaneRequest["v"];
  };
}): Promise<OpenMeldDaemonControlPlaneResponse> {
  const payload: OpenMeldDaemonSyncRouteCatalogPayload = input.context
    .syncRouteCatalogHandler
    ? await input.context.syncRouteCatalogHandler(input.payload)
    : {
        accepted: false,
        note: "sync_route_catalog_not_implemented",
        profileIds: [],
        syncStatus: "deferred",
      };
  return parseControlPlaneResponse({
    ...input.requestMeta,
    code: "service.sync_route_catalog",
    payload,
  });
}

async function buildRequestAgentActivitySyncControlPlaneResponse(input: {
  context: OpenMeldDaemonControlPlaneContext;
  payload: OpenMeldDaemonRequestAgentActivitySyncRequestPayload;
  requestMeta: {
    requestId?: string;
    v: OpenMeldDaemonControlPlaneRequest["v"];
  };
}): Promise<OpenMeldDaemonControlPlaneResponse> {
  const payload: OpenMeldDaemonRequestAgentActivitySyncResponsePayload = input
    .context.requestAgentActivitySyncHandler
    ? await input.context.requestAgentActivitySyncHandler(input.payload)
    : { accepted: false };
  return parseControlPlaneResponse({
    ...input.requestMeta,
    code: "service.agent_activity_sync_requested",
    payload,
  });
}

async function buildSetLocalAgentEnabledControlPlaneResponse(input: {
  context: OpenMeldDaemonControlPlaneContext;
  payload: OpenMeldDaemonSetLocalAgentEnabledRequestPayload;
  requestMeta: {
    requestId?: string;
    v: OpenMeldDaemonControlPlaneRequest["v"];
  };
}): Promise<OpenMeldDaemonControlPlaneResponse> {
  const payload: OpenMeldDaemonSetLocalAgentEnabledResponsePayload = input
    .context.setLocalAgentEnabledHandler
    ? await input.context.setLocalAgentEnabledHandler(input.payload)
    : {
        accepted: false,
        agentId: input.payload.agentId,
        changed: false,
        enabled: input.payload.enabled,
        message:
          "Local agent enablement control is not available on this OpenMeld Service.",
        reasonCode: "set_local_agent_enabled_not_implemented",
        reportSyncStatus: "failed",
        status: "rejected",
      };
  return parseControlPlaneResponse({
    ...input.requestMeta,
    code: "service.set_local_agent_enabled",
    payload,
  });
}

function parseControlPlaneResponse(
  input: OpenMeldDaemonControlPlaneResponse
): OpenMeldDaemonControlPlaneResponse {
  const parsed = openMeldDaemonControlPlaneResponseSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("invalid daemon control-plane response");
  }
  return parsed.data;
}
