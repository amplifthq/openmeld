import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  computerFileAccessPolicyResultSchema,
  localFolderPickerResultSchema,
  localProjectControlConnectResultSchema,
  localProjectControlDiscoverProjectsResultSchema,
  localProjectControlRemoveConnectionResultSchema,
  localProjectControlRemoveMissingConnectionsResultSchema,
  localProjectControlSetDefaultConnectionResultSchema,
  type PluginConnectionExecutionSource,
  type PluginConnectionExecutionSourceRequest,
  pluginConnectionExecutionSourceRequestSchema,
  pluginConnectionExecutionSourceResponseSchema,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  runtimeTransportAgentProfileExecutionStateRequestSchema,
  runtimeTransportAgentProfileExecutionStateResponseSchema,
  runtimeTransportAgentProfileExecutionTargetMutationAcquireResponseSchema,
  runtimeTransportAgentProfileExecutionTargetMutationReleaseResponseSchema,
  runtimeTransportAgentProfileExecutionTargetMutationRequestSchema,
  runtimeTransportAgentProfileLegacyConversationMutationRequestSchema,
  runtimeTransportAgentProfileOperationalContextsRequestSchema,
  runtimeTransportAgentProfileOperationalContextsResponseSchema,
  runtimeTransportComputerFileAccessReadRequestSchema,
  runtimeTransportComputerFileAccessUpdateRequestSchema,
  runtimeTransportDeletedAgentProfileWakeCancellationRequestSchema,
  runtimeTransportDeletedAgentProfileWakeCancellationResponseSchema,
  runtimeTransportDisconnectRatesResponseSchema,
  runtimeTransportForkAgentSessionRequestSchema,
  runtimeTransportForkAgentSessionResultSchema,
  runtimeTransportLocalFolderPickerRequestSchema,
  runtimeTransportLocalProjectControlConnectCandidateRequestSchema,
  runtimeTransportLocalProjectControlConnectDeclaredPathRequestSchema,
  runtimeTransportLocalProjectControlDiscoverProjectsRequestSchema,
  runtimeTransportLocalProjectControlRemoveConnectionRequestSchema,
  runtimeTransportLocalProjectControlRemoveMissingConnectionsRequestSchema,
  runtimeTransportLocalProjectControlSetDefaultConnectionRequestSchema,
  runtimeTransportLookupOwnerServiceRequestSchema,
  runtimeTransportLookupOwnerServiceResponseSchema,
  runtimeTransportLookupRouteRequestSchema,
  runtimeTransportLookupRouteResponseSchema,
  runtimeTransportLookupRoutesBatchRequestSchema,
  runtimeTransportLookupRoutesBatchResponseSchema,
  runtimeTransportManageLocalAgentInstallationRequestSchema,
  runtimeTransportManageLocalAgentInstallationResponseSchema,
  runtimeTransportManageProfileFoldersRequestSchema,
  runtimeTransportManageProfileFoldersResponseSchema,
  runtimeTransportNotifyRouteCatalogChangedRequestSchema,
  runtimeTransportNotifyRouteCatalogChangedResponseSchema,
  runtimeTransportOpenMeldToolsControlRequestSchema,
  runtimeTransportOpenMeldToolsControlResponseSchema,
  runtimeTransportReadProfileFolderProjectionRequestSchema,
  runtimeTransportReadProfileFolderProjectionResponseSchema,
  runtimeTransportReadProfileWorkspaceRequestSchema,
  runtimeTransportReadProfileWorkspaceResponseSchema,
  runtimeTransportRefreshLocalAgentCatalogRequestSchema,
  runtimeTransportRefreshLocalAgentCatalogResponseSchema,
  runtimeTransportSetLocalAgentEnabledRequestSchema,
  runtimeTransportSetLocalAgentEnabledResponseSchema,
  runtimeTransportSetProfileWorkspaceRequestSchema,
  runtimeTransportSetProfileWorkspaceResponseSchema,
} from "@openmeld/schemas";
import type {
  ComputerFileAccessErrorResponse,
  ComputerFileAccessPolicyResponse,
  ComputerFileAccessReadRequest,
  ComputerFileAccessUpdateRequest,
  DaemonServiceLane,
  LocalFolderPickerRequest,
  LocalFolderPickerResult,
  LocalProjectControlConnectCandidateDaemonRequest,
  LocalProjectControlConnectDeclaredPathDaemonRequest,
  LocalProjectControlConnectResponse,
  LocalProjectControlDiscoverProjectsDaemonRequest,
  LocalProjectControlDiscoverProjectsResponse,
  LocalProjectControlErrorResponse,
  LocalProjectControlRemoveConnectionRequest,
  LocalProjectControlRemoveConnectionResponse,
  LocalProjectControlRemoveMissingConnectionsRequest,
  LocalProjectControlRemoveMissingConnectionsResponse,
  LocalProjectControlSetDefaultConnectionRequest,
  LocalProjectControlSetDefaultConnectionResponse,
  OpenMeldToolsControlRequest,
  RuntimeTransportAgentProfileExecutionStateResponse,
  RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse,
  RuntimeTransportAgentProfileExecutionTargetMutationReleaseResponse,
  RuntimeTransportAgentProfileOperationalContextsResponse,
  RuntimeTransportDeletedAgentProfileWakeCancellationResponse,
  RuntimeTransportDisconnectRatesResponse,
  RuntimeTransportForkAgentSessionResult,
  RuntimeTransportLookupOwnerServiceResponse,
  RuntimeTransportLookupRouteResponse,
  RuntimeTransportLookupRoutesBatchResponse,
  RuntimeTransportManageLocalAgentInstallationResponse,
  RuntimeTransportNotifyRouteCatalogChangedResponse,
  RuntimeTransportOpenMeldToolsControlResponse,
  RuntimeTransportRefreshLocalAgentCatalogResponse,
  RuntimeTransportSetLocalAgentEnabledResponse,
  RuntimeTransportSetProfileWorkspaceResponse,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../../lib/bindings";
import { readForgottenDeviceRecord } from "../../../start/infrastructure/postgresql/forgotten-device-repo";
import { callRuntimeTransportApi } from "./runtime-transport-api-client";
import { resolveRuntimeTransportOwnerShard } from "./runtime-transport-shard";

export const cancelRuntimeTransportDeletedAgentProfileWakes = async (input: {
  env: CoreBindings;
  ownerUserId: string;
  targetProfileId: string;
}): Promise<RuntimeTransportDeletedAgentProfileWakeCancellationResponse> => {
  const parsedRequest =
    runtimeTransportDeletedAgentProfileWakeCancellationRequestSchema.safeParse({
      ownerUserId: input.ownerUserId,
      targetProfileId: input.targetProfileId,
    });
  if (!parsedRequest.success) {
    return {
      executionStopOutcomes: [],
      headStopOutcomes: [],
      status: "unavailable",
      targetProfileId: input.targetProfileId,
    };
  }
  try {
    const shard = resolveRuntimeTransportOwnerShard(
      input.env,
      input.ownerUserId
    );
    const parsedResponse =
      runtimeTransportDeletedAgentProfileWakeCancellationResponseSchema.safeParse(
        await shard.rpcCancelDeletedAgentProfileWakes(parsedRequest.data)
      );
    if (parsedResponse.success) {
      return parsedResponse.data;
    }
    console.warn(
      "[core.runtime_coordinator.deleted_profile_wake_cancellation_response_invalid]",
      {
        error: parsedResponse.error.message,
        ownerUserId: input.ownerUserId,
        targetProfileId: input.targetProfileId,
      }
    );
  } catch (error) {
    console.warn(
      "[core.runtime_coordinator.deleted_profile_wake_cancellation_failed]",
      {
        error: error instanceof Error ? error.message : String(error),
        ownerUserId: input.ownerUserId,
        targetProfileId: input.targetProfileId,
      }
    );
  }
  return {
    executionStopOutcomes: [],
    headStopOutcomes: [],
    status: "unavailable",
    targetProfileId: input.targetProfileId,
  };
};

export const acquireRuntimeTransportAgentProfileExecutionTargetMutation =
  async (input: {
    env: CoreBindings;
    operationId: string;
    ownerUserId: string;
    targetProfileId: string;
  }): Promise<RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse> => {
    return await acquireRuntimeTransportAgentProfileMutation({
      ...input,
      mutation: { rpcMethod: "rpcAcquireAgentProfileControllerMutation" },
    });
  };

export const acquireRuntimeTransportAgentProfileFutureWorkSettingsMutation =
  async (input: {
    env: CoreBindings;
    operationId: string;
    ownerUserId: string;
    targetProfileId: string;
  }): Promise<RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse> => {
    return await acquireRuntimeTransportAgentProfileMutation({
      ...input,
      mutation: {
        rpcMethod: "rpcAcquireAgentProfileFutureWorkSettingsMutation",
      },
    });
  };

export const acquireRuntimeTransportAgentProfileLegacyConversationMutation =
  (input: {
    agentControllerRef: string;
    env: CoreBindings;
    operationId: string;
    ownerUserId: string;
    targetProfileId: string;
  }): Promise<RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse> =>
    acquireRuntimeTransportAgentProfileMutation({
      ...input,
      mutation: {
        agentControllerRef: input.agentControllerRef,
        rpcMethod: "rpcAcquireAgentProfileLegacyConversationMutation",
      },
    });

type RuntimeTransportOwnerShard = ReturnType<
  typeof resolveRuntimeTransportOwnerShard
>;

type AgentProfileMutationAcquireRequest =
  | {
      rpcMethod:
        | "rpcAcquireAgentProfileControllerMutation"
        | "rpcAcquireAgentProfileFutureWorkSettingsMutation";
    }
  | {
      agentControllerRef: string;
      rpcMethod: "rpcAcquireAgentProfileLegacyConversationMutation";
    };

const resolveAgentProfileMutationAcquire = (input: {
  mutation: AgentProfileMutationAcquireRequest;
  operationId: string;
  ownerUserId: string;
  targetProfileId: string;
}): ((shard: RuntimeTransportOwnerShard) => Promise<unknown>) | null => {
  const request = {
    operationId: input.operationId,
    ownerUserId: input.ownerUserId,
    targetProfileId: input.targetProfileId,
  };
  const mutation = input.mutation;
  if (
    mutation.rpcMethod === "rpcAcquireAgentProfileLegacyConversationMutation"
  ) {
    const parsed =
      runtimeTransportAgentProfileLegacyConversationMutationRequestSchema.safeParse(
        { ...request, agentControllerRef: mutation.agentControllerRef }
      );
    return parsed.success
      ? (shard) =>
          shard.rpcAcquireAgentProfileLegacyConversationMutation(parsed.data)
      : null;
  }
  const parsed =
    runtimeTransportAgentProfileExecutionTargetMutationRequestSchema.safeParse(
      request
    );
  return parsed.success
    ? (shard) => shard[mutation.rpcMethod](parsed.data)
    : null;
};

const acquireRuntimeTransportAgentProfileMutation = async (input: {
  env: CoreBindings;
  mutation: AgentProfileMutationAcquireRequest;
  operationId: string;
  ownerUserId: string;
  targetProfileId: string;
}): Promise<RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse> => {
  const acquire = resolveAgentProfileMutationAcquire(input);
  if (!acquire) {
    return {
      reasonCode:
        "runtime_coordinator.execution_target_mutation_request_invalid",
      status: "unavailable",
    };
  }
  try {
    const shard = resolveRuntimeTransportOwnerShard(
      input.env,
      input.ownerUserId
    );
    const parsedResponse =
      runtimeTransportAgentProfileExecutionTargetMutationAcquireResponseSchema.safeParse(
        await acquire(shard)
      );
    if (parsedResponse.success) {
      return parsedResponse.data;
    }
    console.warn(
      "[core.runtime_coordinator.execution_target_mutation_acquire_response_invalid]",
      {
        error: parsedResponse.error.message,
        operationId: input.operationId,
        ownerUserId: input.ownerUserId,
        targetProfileId: input.targetProfileId,
      }
    );
  } catch (error) {
    console.warn(
      "[core.runtime_coordinator.execution_target_mutation_acquire_failed]",
      {
        error: error instanceof Error ? error.message : String(error),
        operationId: input.operationId,
        ownerUserId: input.ownerUserId,
        targetProfileId: input.targetProfileId,
      }
    );
  }
  return {
    reasonCode: "runtime_coordinator.execution_state_unavailable",
    status: "unavailable",
  };
};

export const releaseRuntimeTransportAgentProfileExecutionTargetMutation =
  async (input: {
    env: CoreBindings;
    operationId: string;
    ownerUserId: string;
    targetProfileId: string;
  }): Promise<RuntimeTransportAgentProfileExecutionTargetMutationReleaseResponse> => {
    const request =
      runtimeTransportAgentProfileExecutionTargetMutationRequestSchema.parse({
        operationId: input.operationId,
        ownerUserId: input.ownerUserId,
        targetProfileId: input.targetProfileId,
      });
    const shard = resolveRuntimeTransportOwnerShard(
      input.env,
      input.ownerUserId
    );
    return runtimeTransportAgentProfileExecutionTargetMutationReleaseResponseSchema.parse(
      await shard.rpcReleaseAgentProfileControllerMutation(request)
    );
  };

export async function readRuntimeTransportPluginConnectionExecutionSource(
  env: CoreBindings,
  input: PluginConnectionExecutionSourceRequest
): Promise<PluginConnectionExecutionSource | null> {
  const request = pluginConnectionExecutionSourceRequestSchema.safeParse(input);
  if (!request.success) {
    return null;
  }
  const shard = resolveRuntimeTransportOwnerShard(
    env,
    request.data.ownerUserId
  );
  const response = await shard.rpcReadPluginConnectionExecutionSource(
    request.data
  );
  const parsed =
    pluginConnectionExecutionSourceResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(
      "runtime_coordinator.plugin_connection_source_response_invalid"
    );
  }
  return parsed.data.source;
}

export const readRuntimeTransportAgentProfileExecutionState = async (input: {
  env: CoreBindings;
  ownerUserId: string;
  targetProfileId: string;
}): Promise<RuntimeTransportAgentProfileExecutionStateResponse> => {
  const parsedRequest =
    runtimeTransportAgentProfileExecutionStateRequestSchema.safeParse({
      ownerUserId: input.ownerUserId,
      targetProfileId: input.targetProfileId,
    });
  if (!parsedRequest.success) {
    return {
      reasonCode: "runtime_coordinator.execution_state_request_invalid",
      status: "unavailable",
    };
  }
  try {
    const shard = resolveRuntimeTransportOwnerShard(
      input.env,
      input.ownerUserId
    );
    const response = await shard.rpcReadAgentProfileExecutionState(
      parsedRequest.data
    );
    const parsedResponse =
      runtimeTransportAgentProfileExecutionStateResponseSchema.safeParse(
        response
      );
    if (parsedResponse.success) {
      return parsedResponse.data;
    }
    console.warn(
      "[core.runtime_coordinator.execution_state_response_invalid]",
      {
        error: parsedResponse.error.message,
        ownerUserId: input.ownerUserId,
        targetProfileId: input.targetProfileId,
      }
    );
  } catch (error) {
    console.warn("[core.runtime_coordinator.execution_state_read_failed]", {
      error: error instanceof Error ? error.message : String(error),
      ownerUserId: input.ownerUserId,
      targetProfileId: input.targetProfileId,
    });
  }
  return {
    reasonCode: "runtime_coordinator.execution_state_unavailable",
    status: "unavailable",
  };
};

export const readRuntimeTransportAgentProfileOperationalContexts =
  async (input: {
    env: CoreBindings;
    includeWorkReferences: boolean;
    ownerUserId: string;
    targetProfileIds: readonly string[];
  }): Promise<RuntimeTransportAgentProfileOperationalContextsResponse> => {
    const fallback =
      (): RuntimeTransportAgentProfileOperationalContextsResponse => ({
        contexts: input.targetProfileIds.map((targetProfileId) => ({
          operationalContext: {
            reasonCode: "runtime_coordinator.operational_context_unavailable",
            status: "checking",
          },
          targetProfileId,
        })),
      });
    const parsedRequest =
      runtimeTransportAgentProfileOperationalContextsRequestSchema.safeParse({
        includeWorkReferences: input.includeWorkReferences,
        ownerUserId: input.ownerUserId,
        targetProfileIds: input.targetProfileIds,
      });
    if (!parsedRequest.success) {
      return fallback();
    }
    try {
      const shard = resolveRuntimeTransportOwnerShard(
        input.env,
        input.ownerUserId
      );
      const response = await shard.rpcReadAgentProfileOperationalContexts(
        parsedRequest.data
      );
      const parsedResponse =
        runtimeTransportAgentProfileOperationalContextsResponseSchema.safeParse(
          response
        );
      if (parsedResponse.success) {
        return parsedResponse.data;
      }
      console.warn(
        "[core.runtime_coordinator.operational_context_response_invalid]",
        {
          error: parsedResponse.error.message,
          ownerUserId: input.ownerUserId,
          targetProfileCount: input.targetProfileIds.length,
        }
      );
    } catch (error) {
      console.warn(
        "[core.runtime_coordinator.operational_context_read_failed]",
        {
          error: error instanceof Error ? error.message : String(error),
          ownerUserId: input.ownerUserId,
          targetProfileCount: input.targetProfileIds.length,
        }
      );
    }
    return fallback();
  };

export const lookupRuntimeTransportRoute = async (input: {
  blockForgottenDevices?: boolean;
  env: CoreBindings;
  ownerUserId: string;
  profileId: string;
}): Promise<RuntimeTransportLookupRouteResponse> => {
  const parsedRequest = runtimeTransportLookupRouteRequestSchema.safeParse({
    v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    ownerUserId: input.ownerUserId,
    profileId: input.profileId,
  });
  if (!parsedRequest.success) {
    return {
      online: false,
      reasonCode: "daemon.session.not_found",
    };
  }

  // Read failures (missing transport binding, shard resolution errors) must
  // propagate: downstream readiness maps a thrown lookup to
  // unavailable/lookup_failed. Swallowing them into a not_found answer forges
  // stable offline evidence out of an errored read (contract: Offline
  // requires stable evidence).
  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/lookup-route",
    body: parsedRequest.data,
  });

  const parsed = runtimeTransportLookupRouteResponseSchema.safeParse(response);
  if (!parsed.success) {
    return {
      online: false,
      reasonCode: "daemon.session.not_found",
    };
  }

  if (input.blockForgottenDevices === true && parsed.data.online) {
    return await blockForgottenRuntimeTransportRoute({
      env: input.env,
      ownerUserId: input.ownerUserId,
      profileId: input.profileId,
      route: parsed.data,
    });
  }

  return parsed.data;
};

export const lookupRuntimeTransportRoutesBatch = async (input: {
  blockForgottenDevices?: boolean;
  env: CoreBindings;
  ownerUserId: string;
  profileIds: readonly string[];
}): Promise<RuntimeTransportLookupRoutesBatchResponse | null> => {
  // Single DO round trip for a whole readiness batch. Returns null on any
  // failure so callers fall back to per-profile lookups (fail-open).
  const parsedRequest =
    runtimeTransportLookupRoutesBatchRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: input.ownerUserId,
      profileIds: [...input.profileIds],
    });
  if (!parsedRequest.success) {
    return null;
  }

  let response: unknown;
  try {
    response = await callRuntimeTransportApi({
      env: input.env,
      ownerUserId: input.ownerUserId,
      path: "/lookup-routes-batch",
      body: parsedRequest.data,
    });
  } catch {
    return null;
  }

  const parsed =
    runtimeTransportLookupRoutesBatchResponseSchema.safeParse(response);
  if (!parsed.success) {
    return null;
  }
  if (input.blockForgottenDevices !== true) {
    return parsed.data;
  }

  // Forgotten-device filtering with one D1 read per distinct device instead
  // of one per profile.
  const forgottenByDeviceId = new Map<string, boolean>();
  const routes: RuntimeTransportLookupRoutesBatchResponse["routes"] = {};
  for (const [profileId, route] of Object.entries(parsed.data.routes)) {
    if (!route.online) {
      routes[profileId] = route;
      continue;
    }
    let forgotten = forgottenByDeviceId.get(route.deviceId);
    if (forgotten === undefined) {
      forgotten = await readForgottenDeviceFlagFailOpen({
        env: input.env,
        ownerUserId: input.ownerUserId,
        deviceId: route.deviceId,
        source: "daemon_routes_batch_lookup",
      });
      forgottenByDeviceId.set(route.deviceId, forgotten);
    }
    routes[profileId] = forgotten
      ? { online: false, reasonCode: "daemon.profile.offline" }
      : route;
  }
  return { routes };
};

export const lookupRuntimeTransportOwnerService = async (input: {
  blockForgottenDevices?: boolean;
  env: CoreBindings;
  ownerUserId: string;
}): Promise<RuntimeTransportLookupOwnerServiceResponse> => {
  const parsedRequest =
    runtimeTransportLookupOwnerServiceRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: input.ownerUserId,
    });
  if (!parsedRequest.success) {
    throw new Error("Invalid Runtime Transport owner-Service request.");
  }

  // Same pass-through contract as lookupRuntimeTransportRoute: errored reads
  // are not offline evidence and must reach the caller's failure mapping.
  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/lookup-owner-service",
    body: parsedRequest.data,
  });

  const parsed =
    runtimeTransportLookupOwnerServiceResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("Invalid Runtime Transport owner-Service response.");
  }

  if (input.blockForgottenDevices === true && parsed.data.online) {
    return await blockForgottenRuntimeTransportOwnerService({
      env: input.env,
      ownerUserId: input.ownerUserId,
      response: parsed.data,
    });
  }

  return parsed.data;
};

export const setRuntimeTransportLocalAgentEnabled = async (input: {
  deviceId: string;
  enabled: boolean;
  env: CoreBindings;
  agentId: string;
  ownerUserId: string;
  runtimeLane: DaemonServiceLane;
}): Promise<RuntimeTransportSetLocalAgentEnabledResponse> => {
  const parsedRequest =
    runtimeTransportSetLocalAgentEnabledRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: input.ownerUserId,
      deviceId: input.deviceId,
      lane: input.runtimeLane,
      agentId: input.agentId,
      enabled: input.enabled,
    });
  if (!parsedRequest.success) {
    return {
      status: "rejected",
      reasonCode: "local_agent_control.invalid_request",
      message:
        parsedRequest.error.issues[0]?.message ??
        "invalid local agent control request",
    };
  }

  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/local-agent-control/set-enabled",
    body: parsedRequest.data,
  });

  const parsed =
    runtimeTransportSetLocalAgentEnabledResponseSchema.safeParse(response);
  if (!parsed.success) {
    return {
      status: "rejected",
      reasonCode: "local_agent_control.invalid_response",
      message:
        "Runtime Transport returned an invalid local agent control response.",
    };
  }
  return parsed.data;
};

export const manageRuntimeTransportLocalAgentInstallation = async (input: {
  deviceId: string;
  env: CoreBindings;
  ownerUserId: string;
  request: import("@openmeld/schemas/types").OpenMeldDaemonManageLocalAgentInstallationRequestPayload;
  runtimeLane: DaemonServiceLane;
}): Promise<RuntimeTransportManageLocalAgentInstallationResponse> => {
  const parsedRequest =
    runtimeTransportManageLocalAgentInstallationRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: input.ownerUserId,
      deviceId: input.deviceId,
      lane: input.runtimeLane,
      request: input.request,
    });
  if (!parsedRequest.success) {
    return {
      status: "rejected",
      reasonCode: "local_agent_control.invalid_request",
      message:
        parsedRequest.error.issues[0]?.message ??
        "invalid local agent installation request",
    };
  }

  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/local-agent-control/installations",
    body: parsedRequest.data,
  });

  const parsed =
    runtimeTransportManageLocalAgentInstallationResponseSchema.safeParse(
      response
    );
  if (!parsed.success) {
    return {
      status: "rejected",
      reasonCode: "local_agent_control.invalid_response",
      message:
        "Runtime Transport returned an invalid local agent installation response.",
    };
  }
  return parsed.data;
};

export const controlRuntimeTransportOpenMeldTools = async (input: {
  deviceId: string;
  env: CoreBindings;
  ownerUserId: string;
  request: OpenMeldToolsControlRequest;
  runtimeLane: DaemonServiceLane;
}): Promise<RuntimeTransportOpenMeldToolsControlResponse> => {
  const parsedRequest =
    runtimeTransportOpenMeldToolsControlRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      deviceId: input.deviceId,
      lane: input.runtimeLane,
      ownerUserId: input.ownerUserId,
      request: input.request,
      requestId: crypto.randomUUID(),
    });
  if (!parsedRequest.success) {
    return {
      message:
        parsedRequest.error.issues[0]?.message ??
        "Invalid OpenMeld Tools request.",
      reasonCode: "openmeld_tools_control.invalid_request",
      status: "rejected",
    };
  }

  const response = await callRuntimeTransportApi({
    body: parsedRequest.data,
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/openmeld-tools-control",
  });
  const parsed =
    runtimeTransportOpenMeldToolsControlResponseSchema.safeParse(response);
  if (!parsed.success) {
    return {
      message: "OpenMeld Service returned an invalid update response.",
      reasonCode: "openmeld_tools_control.invalid_response",
      status: "rejected",
    };
  }
  return parsed.data;
};

export const forkRuntimeTransportAgentSession = async (input: {
  agentControllerRef: string;
  deviceId: string;
  env: CoreBindings;
  operationId: string;
  organizationId: string;
  ownerUserId: string;
  profileName: string;
  projectId: string;
  runtimeLane: DaemonServiceLane;
  sourceNativeSessionId: string;
}): Promise<RuntimeTransportForkAgentSessionResult> => {
  const request = runtimeTransportForkAgentSessionRequestSchema.parse({
    v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    agentControllerRef: input.agentControllerRef,
    deviceId: input.deviceId,
    lane: input.runtimeLane,
    operationId: input.operationId,
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
    profileName: input.profileName,
    projectId: input.projectId,
    sourceNativeSessionId: input.sourceNativeSessionId,
  });
  const response = await callRuntimeTransportApi({
    body: request,
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/local-agent-control/fork-session",
  });
  const parsed =
    runtimeTransportForkAgentSessionResultSchema.safeParse(response);
  if (parsed.success) {
    return parsed.data;
  }
  return runtimeTransportForkAgentSessionResultSchema.parse({
    agentControllerRef: input.agentControllerRef,
    message: "OpenMeld could not confirm the local Agent Session Fork result.",
    operationId: input.operationId,
    organizationId: input.organizationId,
    profileName: input.profileName,
    projectId: input.projectId,
    reasonCode: "agent_session_fork.transport_unavailable",
    sourceNativeSessionId: input.sourceNativeSessionId,
    status: "outcome_unknown",
  });
};

export const readRuntimeTransportProfileWorkspace = async (input: {
  deviceId: string;
  env: CoreBindings;
  ownerUserId: string;
  runtimeLane: DaemonServiceLane;
  targetProfileId: string;
}): Promise<
  import("@openmeld/schemas/types").RuntimeTransportReadProfileWorkspaceResponse
> => {
  const parsedRequest =
    runtimeTransportReadProfileWorkspaceRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: input.ownerUserId,
      deviceId: input.deviceId,
      lane: input.runtimeLane,
      targetProfileId: input.targetProfileId,
    });
  if (!parsedRequest.success) {
    return {
      status: "rejected",
      reasonCode: "local_agent_control.invalid_request",
      message: "Invalid working-folder read request.",
    };
  }
  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/local-agent-control/read-profile-workspace",
    body: parsedRequest.data,
  });
  const parsed =
    runtimeTransportReadProfileWorkspaceResponseSchema.safeParse(response);
  return parsed.success
    ? parsed.data
    : {
        status: "rejected",
        reasonCode: "local_agent_control.invalid_response",
        message:
          "OpenMeld could not confirm the saved working-folder settings.",
      };
};

export const setRuntimeTransportProfileWorkspace = async (input: {
  deviceId: string;
  env: CoreBindings;
  ownerUserId: string;
  runtimeLane: DaemonServiceLane;
  targetProfileId: string;
  workspaceMode: "custom" | "openmeld_managed";
  workspacePath?: string;
  onlyIfUnconfigured?: boolean;
}): Promise<RuntimeTransportSetProfileWorkspaceResponse> => {
  const parsedRequest =
    runtimeTransportSetProfileWorkspaceRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: input.ownerUserId,
      deviceId: input.deviceId,
      lane: input.runtimeLane,
      targetProfileId: input.targetProfileId,
      workspaceMode: input.workspaceMode,
      ...(input.onlyIfUnconfigured ? { onlyIfUnconfigured: true } : {}),
      ...(input.workspacePath === undefined
        ? {}
        : { workspacePath: input.workspacePath }),
    });
  if (!parsedRequest.success) {
    return {
      status: "rejected",
      reasonCode: "local_agent_control.invalid_request",
      message:
        parsedRequest.error.issues[0]?.message ??
        "invalid profile workspace control request",
    };
  }

  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/local-agent-control/set-profile-workspace",
    body: parsedRequest.data,
  });

  const parsed =
    runtimeTransportSetProfileWorkspaceResponseSchema.safeParse(response);
  if (!parsed.success) {
    return {
      status: "rejected",
      reasonCode: "local_agent_control.invalid_response",
      message:
        "Runtime Transport returned an invalid profile workspace control response.",
    };
  }
  return parsed.data;
};

export const manageRuntimeTransportProfileFolders = async (input: {
  deviceId: string;
  env: CoreBindings;
  operation: import("@openmeld/schemas/types").ProfileFolderOperation;
  ownerUserId: string;
  runtimeLane: DaemonServiceLane;
  targetProfileId: string;
}): Promise<
  import("@openmeld/schemas/types").RuntimeTransportManageProfileFoldersResponse
> => {
  const parsedRequest =
    runtimeTransportManageProfileFoldersRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: input.ownerUserId,
      deviceId: input.deviceId,
      lane: input.runtimeLane,
      targetProfileId: input.targetProfileId,
      operation: input.operation,
    });
  if (!parsedRequest.success) {
    return {
      status: "rejected",
      reasonCode: "local_agent_control.invalid_request",
      message: "Invalid folder request.",
    };
  }
  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/local-agent-control/manage-profile-folders",
    body: parsedRequest.data,
  });
  const parsed =
    runtimeTransportManageProfileFoldersResponseSchema.safeParse(response);
  return parsed.success
    ? parsed.data
    : {
        status: "rejected",
        reasonCode: "local_agent_control.invalid_response",
        message: "OpenMeld could not confirm this Agent’s folders.",
      };
};

export const readRuntimeTransportProfileFolderProjection = async (input: {
  deviceId: string;
  env: CoreBindings;
  ownerUserId: string;
  runtimeLane: DaemonServiceLane;
  targetProfileId: string;
}): Promise<
  import("@openmeld/schemas/types").RuntimeTransportReadProfileFolderProjectionResponse
> => {
  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/local-agent-control/read-profile-folder-projection",
    body: runtimeTransportReadProfileFolderProjectionRequestSchema.parse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: input.ownerUserId,
      deviceId: input.deviceId,
      lane: input.runtimeLane,
      targetProfileId: input.targetProfileId,
    }),
  });
  const parsed =
    runtimeTransportReadProfileFolderProjectionResponseSchema.safeParse(
      response
    );
  return parsed.success
    ? parsed.data
    : {
        status: "rejected",
        reasonCode: "local_agent_control.invalid_response",
        message: "OpenMeld could not read this Agent’s recorded folders.",
      };
};

export const isRuntimeTransportProfileWorkspaceOutcomeDefinitive = (
  response: RuntimeTransportSetProfileWorkspaceResponse
): boolean =>
  response.status === "accepted" ||
  (response.reasonCode !== "local_agent_control.timeout" &&
    response.reasonCode !== "local_agent_control.invalid_response");

export const refreshRuntimeTransportLocalAgentCatalog = async (input: {
  deviceId: string;
  env: CoreBindings;
  ownerUserId: string;
  reason: string;
  runtimeLane: DaemonServiceLane;
}): Promise<RuntimeTransportRefreshLocalAgentCatalogResponse> => {
  const parsedRequest =
    runtimeTransportRefreshLocalAgentCatalogRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: input.ownerUserId,
      deviceId: input.deviceId,
      lane: input.runtimeLane,
      reason: input.reason,
    });
  if (!parsedRequest.success) {
    return {
      status: "rejected",
      reasonCode: "local_agent_control.invalid_request",
      message:
        parsedRequest.error.issues[0]?.message ??
        "invalid local agent catalog refresh request",
    };
  }

  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/local-agent-control/refresh-catalog",
    body: parsedRequest.data,
  });

  const parsed =
    runtimeTransportRefreshLocalAgentCatalogResponseSchema.safeParse(response);
  if (!parsed.success) {
    return {
      status: "rejected",
      reasonCode: "local_agent_control.invalid_response",
      message:
        "Runtime Transport returned an invalid local agent catalog refresh response.",
    };
  }
  return parsed.data;
};

type LocalProjectControlTransportTarget = {
  deviceId: string;
  env: CoreBindings;
  ownerUserId: string;
  runtimeLane: DaemonServiceLane;
};

type ComputerFileAccessTransportTarget = {
  deviceId: string;
  env: CoreBindings;
  ownerUserId: string;
  runtimeLane: DaemonServiceLane;
};

type LocalFolderPickerTransportTarget = {
  deviceId: string;
  env: CoreBindings;
  ownerUserId: string;
  runtimeLane: DaemonServiceLane;
};

type RuntimeSchema<T> = {
  safeParse: (value: unknown) =>
    | { data: T; success: true }
    | {
        error: { issues: Array<{ message?: string }> };
        success: false;
      };
};

export const readRuntimeTransportComputerFileAccessPolicy = async (
  input: ComputerFileAccessTransportTarget & {
    request: ComputerFileAccessReadRequest;
  }
): Promise<
  ComputerFileAccessErrorResponse | ComputerFileAccessPolicyResponse
> =>
  await executeRuntimeTransportComputerFileAccess(input, {
    path: "/computer-file-access/read-policy",
    requestSchema: runtimeTransportComputerFileAccessReadRequestSchema,
  });

export const updateRuntimeTransportComputerFileAccessPolicy = async (
  input: ComputerFileAccessTransportTarget & {
    request: ComputerFileAccessUpdateRequest;
  }
): Promise<
  ComputerFileAccessErrorResponse | ComputerFileAccessPolicyResponse
> =>
  await executeRuntimeTransportComputerFileAccess(input, {
    path: "/computer-file-access/update-policy",
    requestSchema: runtimeTransportComputerFileAccessUpdateRequestSchema,
  });

async function executeRuntimeTransportComputerFileAccess(
  input: ComputerFileAccessTransportTarget & { request: unknown },
  operation: {
    path: import("./runtime-transport-api-client").RuntimeTransportApiPath;
    requestSchema: RuntimeSchema<unknown>;
  }
): Promise<ComputerFileAccessErrorResponse | ComputerFileAccessPolicyResponse> {
  const parsedRequest = operation.requestSchema.safeParse({
    deviceId: input.deviceId,
    lane: input.runtimeLane,
    ownerUserId: input.ownerUserId,
    request: input.request,
    requestId: crypto.randomUUID(),
    v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
  });
  if (!parsedRequest.success) {
    return {
      code: "computer.file_access.invalid_request",
      message:
        parsedRequest.error.issues[0]?.message ??
        "The Computer file access request is invalid.",
      status: "rejected",
    };
  }
  const response = await callRuntimeTransportApi({
    body: parsedRequest.data,
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: operation.path,
  });
  const parsedResult = computerFileAccessPolicyResultSchema.safeParse(response);
  if (parsedResult.success) {
    return parsedResult.data;
  }
  return {
    code: "computer.file_access.invalid_response",
    message: "Runtime Transport returned an invalid file access response.",
    status: "rejected",
  };
}

export const selectRuntimeTransportLocalFolders = async (
  input: LocalFolderPickerTransportTarget & {
    request: LocalFolderPickerRequest;
  }
): Promise<LocalFolderPickerResult> => {
  const parsedRequest =
    runtimeTransportLocalFolderPickerRequestSchema.safeParse({
      deviceId: input.deviceId,
      lane: input.runtimeLane,
      ownerUserId: input.ownerUserId,
      request: input.request,
      requestId: crypto.randomUUID(),
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    });
  if (!parsedRequest.success) {
    return {
      code: "local.folder_picker.invalid_request",
      message:
        parsedRequest.error.issues[0]?.message ??
        "The Local Folder Picker request is invalid.",
      status: "unavailable",
    };
  }

  const response = await callRuntimeTransportApi({
    body: parsedRequest.data,
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/local-folder-picker/select-folders",
  });
  const parsedResult = localFolderPickerResultSchema.safeParse(response);
  if (parsedResult.success) {
    return parsedResult.data;
  }
  return {
    code: "local.folder_picker.invalid_response",
    message: "Runtime Transport returned an invalid folder selection response.",
    status: "unavailable",
  };
};

export const discoverRuntimeTransportProjects = async (
  input: LocalProjectControlTransportTarget & {
    request: LocalProjectControlDiscoverProjectsDaemonRequest;
  }
): Promise<
  LocalProjectControlDiscoverProjectsResponse | LocalProjectControlErrorResponse
> =>
  await executeRuntimeTransportLocalProjectControl(input, {
    path: "/local-project-control/discover-projects",
    requestSchema:
      runtimeTransportLocalProjectControlDiscoverProjectsRequestSchema,
    resultSchema: localProjectControlDiscoverProjectsResultSchema,
  });

export const connectRuntimeTransportProjectCandidate = async (
  input: LocalProjectControlTransportTarget & {
    request: LocalProjectControlConnectCandidateDaemonRequest;
  }
): Promise<
  LocalProjectControlConnectResponse | LocalProjectControlErrorResponse
> =>
  await executeRuntimeTransportLocalProjectControl(input, {
    path: "/local-project-control/connect-candidate",
    requestSchema:
      runtimeTransportLocalProjectControlConnectCandidateRequestSchema,
    resultSchema: localProjectControlConnectResultSchema,
  });

export const connectRuntimeTransportProjectDeclaredPath = async (
  input: LocalProjectControlTransportTarget & {
    request: LocalProjectControlConnectDeclaredPathDaemonRequest;
  }
): Promise<
  LocalProjectControlConnectResponse | LocalProjectControlErrorResponse
> =>
  await executeRuntimeTransportLocalProjectControl(input, {
    path: "/local-project-control/connect-declared-path",
    requestSchema:
      runtimeTransportLocalProjectControlConnectDeclaredPathRequestSchema,
    resultSchema: localProjectControlConnectResultSchema,
  });

export const setRuntimeTransportDefaultProjectConnection = async (
  input: LocalProjectControlTransportTarget & {
    request: LocalProjectControlSetDefaultConnectionRequest;
  }
): Promise<
  | LocalProjectControlErrorResponse
  | LocalProjectControlSetDefaultConnectionResponse
> =>
  await executeRuntimeTransportLocalProjectControl(input, {
    path: "/local-project-control/set-default-connection",
    requestSchema:
      runtimeTransportLocalProjectControlSetDefaultConnectionRequestSchema,
    resultSchema: localProjectControlSetDefaultConnectionResultSchema,
  });

export const removeRuntimeTransportProjectConnection = async (
  input: LocalProjectControlTransportTarget & {
    request: LocalProjectControlRemoveConnectionRequest;
  }
): Promise<
  LocalProjectControlErrorResponse | LocalProjectControlRemoveConnectionResponse
> =>
  await executeRuntimeTransportLocalProjectControl(input, {
    path: "/local-project-control/remove-connection",
    requestSchema:
      runtimeTransportLocalProjectControlRemoveConnectionRequestSchema,
    resultSchema: localProjectControlRemoveConnectionResultSchema,
  });

export const removeRuntimeTransportMissingProjectConnections = async (
  input: LocalProjectControlTransportTarget & {
    request: LocalProjectControlRemoveMissingConnectionsRequest;
  }
): Promise<
  | LocalProjectControlErrorResponse
  | LocalProjectControlRemoveMissingConnectionsResponse
> =>
  await executeRuntimeTransportLocalProjectControl(input, {
    path: "/local-project-control/remove-missing-connections",
    requestSchema:
      runtimeTransportLocalProjectControlRemoveMissingConnectionsRequestSchema,
    resultSchema: localProjectControlRemoveMissingConnectionsResultSchema,
  });

async function executeRuntimeTransportLocalProjectControl<T>(
  input: LocalProjectControlTransportTarget & { request: unknown },
  operation: {
    path: import("./runtime-transport-api-client").RuntimeTransportApiPath;
    requestSchema: RuntimeSchema<unknown>;
    resultSchema: RuntimeSchema<T>;
  }
): Promise<LocalProjectControlErrorResponse | T> {
  const parsedRequest = operation.requestSchema.safeParse({
    v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    ownerUserId: input.ownerUserId,
    deviceId: input.deviceId,
    lane: input.runtimeLane,
    requestId: crypto.randomUUID(),
    request: input.request,
  });
  if (!parsedRequest.success) {
    return {
      status: "rejected",
      code: "invalid_request",
      message:
        parsedRequest.error.issues[0]?.message ??
        "The local Project control request is invalid.",
    };
  }
  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: operation.path,
    body: parsedRequest.data,
  });
  const parsedResult = operation.resultSchema.safeParse(response);
  if (parsedResult.success) {
    return parsedResult.data;
  }
  return {
    status: "rejected",
    code: "invalid_response",
    message: "Runtime Transport returned an invalid Project control response.",
  };
}

export const readRuntimeTransportDisconnectRates = async (input: {
  env: CoreBindings;
  ownerUserId: string;
}): Promise<RuntimeTransportDisconnectRatesResponse> => {
  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/diagnostics/disconnect-rates",
    body: {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: input.ownerUserId,
    },
  });
  return parseRuntimeTransportDisconnectRatesResponse(response);
};

// Forgotten-device blocking is a display-time gate over an already-verified
// liveness answer. If the gate itself cannot be read (missing DB binding or a
// failing D1 read), fail open and keep the observed route: a flaky gate read
// must not turn a live answer into an error for every composing caller.
async function readForgottenDeviceFlagFailOpen(input: {
  env: CoreBindings;
  ownerUserId: string;
  deviceId: string;
  source: string;
}): Promise<boolean> {
  const db = getPostgresDatabase(input.env);
  if (!db) {
    return false;
  }
  try {
    return Boolean(
      await readForgottenDeviceRecord({
        db,
        userId: input.ownerUserId,
        deviceId: input.deviceId,
      })
    );
  } catch (error) {
    console.warn("[core.current_device.forgotten_read_failed]", {
      event: "current_device.forgotten_read_failed",
      ownerUserId: input.ownerUserId,
      deviceId: input.deviceId,
      source: input.source,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function blockForgottenRuntimeTransportOwnerService(input: {
  env: CoreBindings;
  ownerUserId: string;
  response: Extract<
    RuntimeTransportLookupOwnerServiceResponse,
    { online: true }
  >;
}): Promise<RuntimeTransportLookupOwnerServiceResponse> {
  const activeSessions: typeof input.response.sessions = [];
  for (const session of input.response.sessions) {
    const forgottenDevice = await readForgottenDeviceFlagFailOpen({
      env: input.env,
      ownerUserId: input.ownerUserId,
      deviceId: session.deviceId,
      source: "daemon_owner_service_lookup",
    });
    if (forgottenDevice) {
      console.info("[core.current_device.forgotten_observation_ignored]", {
        event: "current_device.forgotten_observation_ignored",
        ownerUserId: input.ownerUserId,
        deviceId: session.deviceId,
      });
      continue;
    }
    activeSessions.push(session);
  }

  if (activeSessions.length === 0) {
    return {
      online: false,
      reasonCode: "daemon.profile.offline",
    };
  }

  return {
    online: true,
    sessions: activeSessions,
  };
}

async function blockForgottenRuntimeTransportRoute(input: {
  env: CoreBindings;
  ownerUserId: string;
  profileId: string;
  route: Extract<RuntimeTransportLookupRouteResponse, { online: true }>;
}): Promise<RuntimeTransportLookupRouteResponse> {
  const forgottenDevice = await readForgottenDeviceFlagFailOpen({
    env: input.env,
    ownerUserId: input.ownerUserId,
    deviceId: input.route.deviceId,
    source: "daemon_route_lookup",
  });
  if (!forgottenDevice) {
    return input.route;
  }

  console.info("[core.current_device.forgotten_observation_ignored]", {
    event: "current_device.forgotten_observation_ignored",
    ownerUserId: input.ownerUserId,
    deviceId: input.route.deviceId,
    profileId: input.profileId,
    source: "daemon_route_lookup",
  });
  return {
    online: false,
    reasonCode: "daemon.profile.offline",
  };
}

export const notifyRuntimeTransportRouteCatalogChanged = async (input: {
  affectedProfileIds?: readonly string[];
  env: CoreBindings;
  ownerUserId: string;
  reason: string;
}): Promise<RuntimeTransportNotifyRouteCatalogChangedResponse> => {
  const affectedProfileIds = (input.affectedProfileIds ?? [])
    .map((profileId) => profileId.trim())
    .filter((profileId) => profileId.length > 0);
  const parsedRequest =
    runtimeTransportNotifyRouteCatalogChangedRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: input.ownerUserId,
      reason: input.reason,
      ...(affectedProfileIds.length > 0 ? { affectedProfileIds } : {}),
    });
  if (!parsedRequest.success) {
    return {
      ok: false,
      notifiedSessions: 0,
    };
  }

  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/route-catalog-changed",
    body: parsedRequest.data,
  });

  const parsed =
    runtimeTransportNotifyRouteCatalogChangedResponseSchema.safeParse(response);
  if (!parsed.success) {
    return {
      ok: false,
      notifiedSessions: 0,
    };
  }
  return parsed.data;
};

function parseRuntimeTransportDisconnectRatesResponse(
  value: unknown
): RuntimeTransportDisconnectRatesResponse {
  const parsed = runtimeTransportDisconnectRatesResponseSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  return {
    ok: false,
    reasonCode: "runtime_transport.disconnect_rates_invalid_response",
    buckets: [],
    recentSessions: [],
  };
}
