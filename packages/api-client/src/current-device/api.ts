import {
  currentDeviceTargetResponseSchema,
  currentLocalRuntimeReplyReadinessResponseSchema,
  forgetComputerResponseSchema,
  forgetCurrentComputerResponseSchema,
  localRuntimeEnrollmentBodySchema,
  localRuntimeEnrollmentResponseSchema,
  localRuntimesQuerySchema,
  localRuntimesResponseSchema,
  refreshCurrentLocalAgentCatalogResponseSchema,
  setCurrentAgentProfileWorkspaceBodySchema,
  setCurrentAgentProfileWorkspaceResponseSchema,
  setCurrentLocalAgentEnabledBodySchema,
  setCurrentLocalAgentEnabledResponseSchema,
  setLocalRuntimeDisplayNameBodySchema,
  writeCurrentDeviceObservedMetadataBodySchema,
  writeCurrentDeviceObservedMetadataResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildCurrentAgentProfileWorkspaceRoute,
  buildCurrentDeviceObservedMetadataRoute,
  buildCurrentLocalAgentEnabledRoute,
  buildForgetComputerRoute,
  buildLocalRuntimeDisplayNameRoute,
  buildLocalRuntimeEnrollmentRoute,
  buildLocalRuntimesRoute,
  CURRENT_DEVICE_ROUTE,
  CURRENT_LOCAL_AGENT_CATALOG_REFRESH_ROUTE,
  CURRENT_LOCAL_RUNTIME_REPLY_READINESS_ROUTE,
  FORGET_CURRENT_COMPUTER_ROUTE,
} from "./routes";
import type {
  CreateCurrentDeviceApi,
  EnrollLocalRuntimeInput,
  ListLocalRuntimesInput,
  SetCurrentAgentProfileWorkspaceInput,
  SetCurrentLocalAgentEnabledInput,
  SetLocalRuntimeDisplayNameInput,
  WriteCurrentDeviceObservedMetadataInput,
} from "./types";

function requireValidLocalRuntimeEnrollmentBody(
  input: EnrollLocalRuntimeInput
) {
  const parsed = localRuntimeEnrollmentBodySchema.safeParse({
    ...(input.connectedComputerId === undefined
      ? {}
      : { connectedComputerId: input.connectedComputerId }),
    runtimeLane: input.runtimeLane,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid local runtime enrollment body."
    );
  }
  return parsed.data;
}

function requireValidCurrentDeviceObservedMetadataBody(
  input: WriteCurrentDeviceObservedMetadataInput
) {
  const parsed = writeCurrentDeviceObservedMetadataBodySchema.safeParse({
    metadata: input.metadata,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid current device observed metadata body."
    );
  }
  return parsed.data;
}

function requireValidLocalRuntimesQuery(input: ListLocalRuntimesInput = {}) {
  const parsed = localRuntimesQuerySchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid local runtimes query."
    );
  }
  return parsed.data;
}

function requireValidLocalRuntimeDisplayNameBody(
  input: SetLocalRuntimeDisplayNameInput
) {
  const parsed = setLocalRuntimeDisplayNameBodySchema.safeParse({
    displayName: input.displayName,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid local runtime display name body."
    );
  }
  return parsed.data;
}

function requireValidCurrentLocalAgentEnabledBody(
  input: SetCurrentLocalAgentEnabledInput
) {
  const parsed = setCurrentLocalAgentEnabledBodySchema.safeParse({
    enabled: input.enabled,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid local agent enabled payload."
    );
  }
  return parsed.data;
}

function requireValidCurrentAgentProfileWorkspaceBody(
  input: SetCurrentAgentProfileWorkspaceInput
) {
  const parsed = setCurrentAgentProfileWorkspaceBodySchema.safeParse({
    workspaceMode: input.workspaceMode,
    ...(input.workspacePath === undefined
      ? {}
      : { workspacePath: input.workspacePath }),
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid profile workspace payload."
    );
  }
  return parsed.data;
}

export const createCurrentDeviceApi: CreateCurrentDeviceApi = (
  client: OpenMeldApiClientFoundation
) => {
  return {
    getCurrentLocalRuntimeReplyReadiness: async () =>
      await client.requestJson({
        url: CURRENT_LOCAL_RUNTIME_REPLY_READINESS_ROUTE,
        operation: "local_runtime.current.reply_readiness.read",
        method: "GET",
        schema: currentLocalRuntimeReplyReadinessResponseSchema,
        invalidMessage:
          "Invalid current local runtime reply readiness response.",
      }),
    getCurrentTarget: async () =>
      await client.requestJson({
        url: CURRENT_DEVICE_ROUTE,
        operation: "current_device.read",
        method: "GET",
        schema: currentDeviceTargetResponseSchema,
        invalidMessage: "Invalid current device target response.",
      }),
    forgetComputer: async (input) =>
      await client.requestJson({
        url: buildForgetComputerRoute(input.deviceId),
        operation: "local_runtime.forget",
        method: "POST",
        schema: forgetComputerResponseSchema,
        invalidMessage: "Invalid forgotten computer response.",
      }),
    forgetCurrentComputer: async () =>
      await client.requestJson({
        url: FORGET_CURRENT_COMPUTER_ROUTE,
        operation: "current_device.forget",
        method: "POST",
        schema: forgetCurrentComputerResponseSchema,
        invalidMessage: "Invalid forgotten computer response.",
      }),
    listLocalRuntimes: async (input) => {
      const query = requireValidLocalRuntimesQuery(input);

      return await client.requestJson({
        url: buildLocalRuntimesRoute(query),
        operation: "local_runtime.list",
        method: "GET",
        schema: localRuntimesResponseSchema,
        invalidMessage: "Invalid local runtimes response.",
      });
    },
    enrollLocalRuntime: async (input) => {
      const body = requireValidLocalRuntimeEnrollmentBody(input);

      return await client.requestJson({
        url: buildLocalRuntimeEnrollmentRoute(input.deviceId),
        operation: "local_runtime.enroll",
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        schema: localRuntimeEnrollmentResponseSchema,
        invalidMessage: "Invalid local runtime enrollment response.",
      });
    },
    setDisplayName: async (input) => {
      const body = requireValidLocalRuntimeDisplayNameBody(input);

      return await client.requestJson({
        url: buildLocalRuntimeDisplayNameRoute(input.deviceId),
        operation: "local_runtime.display_name.write",
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        schema: localRuntimesResponseSchema,
        invalidMessage: "Invalid local runtimes response.",
      });
    },
    setCurrentLocalAgentEnabled: async (input) => {
      const body = requireValidCurrentLocalAgentEnabledBody(input);

      return await client.requestJson({
        url: buildCurrentLocalAgentEnabledRoute(input.agentId),
        operation: "local_runtime.current.local_agent_enabled.write",
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        schema: setCurrentLocalAgentEnabledResponseSchema,
        invalidMessage: "Invalid local agent enabled response.",
      });
    },
    setCurrentAgentProfileWorkspace: async (input) => {
      const body = requireValidCurrentAgentProfileWorkspaceBody(input);

      return await client.requestJson({
        url: buildCurrentAgentProfileWorkspaceRoute(input.agentProfileId),
        operation: "local_runtime.current.agent_profile_workspace.write",
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        schema: setCurrentAgentProfileWorkspaceResponseSchema,
        invalidMessage: "Invalid profile workspace response.",
      });
    },
    refreshCurrentLocalAgentCatalog: async () =>
      await client.requestJson({
        url: CURRENT_LOCAL_AGENT_CATALOG_REFRESH_ROUTE,
        operation: "local_runtime.current.local_agent_catalog.refresh",
        method: "POST",
        schema: refreshCurrentLocalAgentCatalogResponseSchema,
        invalidMessage: "Invalid local agent catalog refresh response.",
      }),
    writeObservedMetadata: async (input) => {
      const body = requireValidCurrentDeviceObservedMetadataBody(input);

      return await client.requestJson({
        url: buildCurrentDeviceObservedMetadataRoute(input.deviceId),
        operation: "current_device.observed_metadata.write",
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        schema: writeCurrentDeviceObservedMetadataResponseSchema,
        invalidMessage: "Invalid current device observed metadata response.",
      });
    },
  };
};
