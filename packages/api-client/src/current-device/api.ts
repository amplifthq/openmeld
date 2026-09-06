import {
  currentDeviceTargetResponseSchema,
  currentLocalAgentInstallationsResponseSchema,
  currentLocalRuntimeReplyReadinessResponseSchema,
  forgetComputerResponseSchema,
  forgetCurrentComputerResponseSchema,
  localRuntimeEnrollmentBodySchema,
  localRuntimeEnrollmentResponseSchema,
  localRuntimesQuerySchema,
  localRuntimesResponseSchema,
  peopleComputersResponseSchema,
  peopleComputerTargetSchema,
  refreshCurrentLocalAgentCatalogResponseSchema,
  requestCurrentOpenMeldToolsUpdateResponseSchema,
  selectCurrentLocalAgentInstallationBodySchema,
  selectCurrentLocalAgentInstallationResponseSchema,
  setCurrentAgentProfileWorkspaceBodySchema,
  setCurrentAgentProfileWorkspaceResponseSchema,
  setCurrentLocalAgentEnabledBodySchema,
  setCurrentLocalAgentEnabledResponseSchema,
  setCurrentOpenMeldToolsMaintenanceBodySchema,
  setCurrentOpenMeldToolsMaintenanceResponseSchema,
  setLocalRuntimeDisplayNameBodySchema,
  writeCurrentDeviceObservedMetadataBodySchema,
  writeCurrentDeviceObservedMetadataResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildCurrentAgentProfileWorkspaceRoute,
  buildCurrentDeviceObservedMetadataRoute,
  buildCurrentLocalAgentEnabledRoute,
  buildCurrentLocalAgentInstallationsRoute,
  buildForgetComputerRoute,
  buildLocalRuntimeDisplayNameRoute,
  buildLocalRuntimeEnrollmentRoute,
  buildLocalRuntimesRoute,
  CURRENT_DEVICE_ROUTE,
  CURRENT_LOCAL_AGENT_CATALOG_REFRESH_ROUTE,
  CURRENT_LOCAL_RUNTIME_REPLY_READINESS_ROUTE,
  CURRENT_OPENMELD_TOOLS_MAINTENANCE_ROUTE,
  CURRENT_OPENMELD_TOOLS_UPDATE_ROUTE,
  FORGET_CURRENT_COMPUTER_ROUTE,
} from "./routes";
import type {
  CreateCurrentDeviceApi,
  EnrollLocalRuntimeInput,
  ListLocalRuntimesInput,
  SelectCurrentLocalAgentInstallationInput,
  SetCurrentAgentProfileWorkspaceInput,
  SetCurrentLocalAgentEnabledInput,
  SetCurrentOpenMeldToolsMaintenanceInput,
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

function requireValidCurrentLocalAgentInstallationBody(
  input: SelectCurrentLocalAgentInstallationInput
) {
  const parsed = selectCurrentLocalAgentInstallationBodySchema.safeParse({
    installationId: input.installationId,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid local agent installation payload."
    );
  }
  return parsed.data;
}

function requireValidCurrentOpenMeldToolsMaintenanceBody(
  input: SetCurrentOpenMeldToolsMaintenanceInput
) {
  const parsed = setCurrentOpenMeldToolsMaintenanceBodySchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid update setting."
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
    listPeopleComputers: async (input) =>
      client.requestJson({
        url: `/v1/people-computers${input?.includeUsageLimits === "true" ? "?includeUsageLimits=true" : ""}`,
        operation: "people_computers.list",
        method: "GET",
        schema: peopleComputersResponseSchema,
        invalidMessage: "Invalid computers response.",
      }),
    getPeopleComputerReplyReadiness: (input) => {
      const target = peopleComputerTargetSchema.parse(input);
      return client.requestJson({
        url: `/v1/people-computers/${encodeURIComponent(target.deviceId)}/lanes/${encodeURIComponent(target.runtimeLane)}/reply-readiness`,
        operation: "people_computers.reply_readiness.read",
        method: "GET",
        schema: currentLocalRuntimeReplyReadinessResponseSchema,
        invalidMessage: "Invalid computer readiness response.",
      });
    },
    setPeopleComputerLocalAgentEnabled: async (input) => {
      const target = peopleComputerTargetSchema.parse({
        deviceId: input.deviceId,
        runtimeLane: input.runtimeLane,
      });
      const body = setCurrentLocalAgentEnabledBodySchema.parse({
        enabled: input.enabled,
      });
      return await client.requestJson({
        url: `/v1/people-computers/${encodeURIComponent(target.deviceId)}/lanes/${encodeURIComponent(target.runtimeLane)}/local-agents/${encodeURIComponent(input.agentId)}/enabled`,
        operation: "people_computer.setPeopleComputerLocalAgentEnabled",
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        schema: setCurrentLocalAgentEnabledResponseSchema,
        invalidMessage: "Invalid computer action response.",
      });
    },
    getPeopleComputerLocalAgentInstallations: async (input) => {
      const target = peopleComputerTargetSchema.parse({
        deviceId: input.deviceId,
        runtimeLane: input.runtimeLane,
      });
      return await client.requestJson({
        url: `/v1/people-computers/${encodeURIComponent(target.deviceId)}/lanes/${encodeURIComponent(target.runtimeLane)}/local-agents/${encodeURIComponent(input.agentId)}/installations`,
        operation: "people_computer.getPeopleComputerLocalAgentInstallations",
        method: "GET",
        schema: currentLocalAgentInstallationsResponseSchema,
        invalidMessage: "Invalid computer action response.",
      });
    },
    selectPeopleComputerLocalAgentInstallation: async (input) => {
      const target = peopleComputerTargetSchema.parse({
        deviceId: input.deviceId,
        runtimeLane: input.runtimeLane,
      });
      const body = selectCurrentLocalAgentInstallationBodySchema.parse({
        installationId: input.installationId,
      });
      return await client.requestJson({
        url: `/v1/people-computers/${encodeURIComponent(target.deviceId)}/lanes/${encodeURIComponent(target.runtimeLane)}/local-agents/${encodeURIComponent(input.agentId)}/installations`,
        operation: "people_computer.selectPeopleComputerLocalAgentInstallation",
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        schema: selectCurrentLocalAgentInstallationResponseSchema,
        invalidMessage: "Invalid computer action response.",
      });
    },
    refreshPeopleComputerLocalAgentCatalog: async (input) => {
      const target = peopleComputerTargetSchema.parse({
        deviceId: input.deviceId,
        runtimeLane: input.runtimeLane,
      });
      return await client.requestJson({
        url: `/v1/people-computers/${encodeURIComponent(target.deviceId)}/lanes/${encodeURIComponent(target.runtimeLane)}/local-agents/refresh-catalog`,
        operation: "people_computer.refreshPeopleComputerLocalAgentCatalog",
        method: "POST",
        schema: refreshCurrentLocalAgentCatalogResponseSchema,
        invalidMessage: "Invalid computer action response.",
      });
    },
    requestPeopleComputerOpenMeldToolsUpdate: async (input) => {
      const target = peopleComputerTargetSchema.parse({
        deviceId: input.deviceId,
        runtimeLane: input.runtimeLane,
      });
      return await client.requestJson({
        url: `/v1/people-computers/${encodeURIComponent(target.deviceId)}/lanes/${encodeURIComponent(target.runtimeLane)}/openmeld-tools/update`,
        operation: "people_computer.requestPeopleComputerOpenMeldToolsUpdate",
        method: "POST",
        schema: requestCurrentOpenMeldToolsUpdateResponseSchema,
        invalidMessage: "Invalid computer action response.",
      });
    },
    setPeopleComputerOpenMeldToolsMaintenance: async (input) => {
      const target = peopleComputerTargetSchema.parse({
        deviceId: input.deviceId,
        runtimeLane: input.runtimeLane,
      });
      const body = setCurrentOpenMeldToolsMaintenanceBodySchema.parse({
        automaticUpdatesEnabled: input.automaticUpdatesEnabled,
      });
      return await client.requestJson({
        url: `/v1/people-computers/${encodeURIComponent(target.deviceId)}/lanes/${encodeURIComponent(target.runtimeLane)}/openmeld-tools/maintenance`,
        operation: "people_computer.setPeopleComputerOpenMeldToolsMaintenance",
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        schema: setCurrentOpenMeldToolsMaintenanceResponseSchema,
        invalidMessage: "Invalid computer action response.",
      });
    },
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
    getCurrentLocalAgentInstallations: async (input) =>
      await client.requestJson({
        url: buildCurrentLocalAgentInstallationsRoute(input.agentId),
        operation: "local_runtime.current.local_agent_installations.read",
        method: "GET",
        schema: currentLocalAgentInstallationsResponseSchema,
        invalidMessage: "Invalid local agent installations response.",
      }),
    selectCurrentLocalAgentInstallation: async (input) => {
      const body = requireValidCurrentLocalAgentInstallationBody(input);
      return await client.requestJson({
        url: buildCurrentLocalAgentInstallationsRoute(input.agentId),
        operation: "local_runtime.current.local_agent_installation.write",
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        schema: selectCurrentLocalAgentInstallationResponseSchema,
        invalidMessage: "Invalid selected local agent installation response.",
      });
    },
    requestCurrentOpenMeldToolsUpdate: async () =>
      await client.requestJson({
        url: CURRENT_OPENMELD_TOOLS_UPDATE_ROUTE,
        operation: "local_runtime.current.openmeld_tools.update",
        method: "POST",
        schema: requestCurrentOpenMeldToolsUpdateResponseSchema,
        invalidMessage: "Invalid OpenMeld Tools update response.",
      }),
    setCurrentOpenMeldToolsMaintenance: async (input) => {
      const body = requireValidCurrentOpenMeldToolsMaintenanceBody(input);
      return await client.requestJson({
        url: CURRENT_OPENMELD_TOOLS_MAINTENANCE_ROUTE,
        operation: "local_runtime.current.openmeld_tools.maintenance.write",
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        schema: setCurrentOpenMeldToolsMaintenanceResponseSchema,
        invalidMessage: "Invalid OpenMeld Tools update setting response.",
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
