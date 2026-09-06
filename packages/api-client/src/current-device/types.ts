import type {
  CurrentDeviceTargetResponse,
  CurrentLocalAgentInstallationsResponse,
  LocalRuntimesQuery,
  ObservedDeviceMetadata,
  PeopleComputersResponse,
  PeopleComputerTarget,
  RequestCurrentOpenMeldToolsUpdateResponse,
  SelectCurrentLocalAgentInstallationResponse,
  SetCurrentAgentProfileWorkspaceBody,
  SetCurrentAgentProfileWorkspaceResponse,
  SetCurrentLocalAgentEnabledBody,
  SetCurrentLocalAgentEnabledResponse,
  SetCurrentOpenMeldToolsMaintenanceBody,
  SetCurrentOpenMeldToolsMaintenanceResponse,
  SetLocalRuntimeDisplayNameBody,
  WriteCurrentDeviceObservedMetadataResponse,
} from "@openmeld/schemas/types";

export type ForgetCurrentComputerResponse =
  import("@openmeld/schemas/types").ForgetCurrentComputerResponse;
export type ForgetComputerResponse =
  import("@openmeld/schemas/types").ForgetComputerResponse;
export type CurrentLocalRuntimeReplyReadinessResponse =
  import("@openmeld/schemas/types").CurrentLocalRuntimeReplyReadinessResponse;
export type LocalRuntimesResponse =
  import("@openmeld/schemas/types").LocalRuntimesResponse;
export type RefreshCurrentLocalAgentCatalogResponse =
  import("@openmeld/schemas/types").RefreshCurrentLocalAgentCatalogResponse;

export type ForgetComputerInput = {
  deviceId: string;
};
export type ListLocalRuntimesInput = LocalRuntimesQuery;
export type EnrollLocalRuntimeInput =
  import("@openmeld/schemas/types").LocalRuntimeEnrollmentBody & {
    deviceId: string;
  };
export type LocalRuntimeEnrollmentResponse =
  import("@openmeld/schemas/types").LocalRuntimeEnrollmentResponse;
export type SetCurrentLocalAgentEnabledInput =
  SetCurrentLocalAgentEnabledBody & {
    agentId: string;
  };
export type SetCurrentOpenMeldToolsMaintenanceInput =
  SetCurrentOpenMeldToolsMaintenanceBody;
export type SelectCurrentLocalAgentInstallationInput = {
  agentId: string;
  installationId: string;
};
export type SetCurrentAgentProfileWorkspaceInput =
  SetCurrentAgentProfileWorkspaceBody & {
    agentProfileId: string;
  };
export type WriteCurrentDeviceObservedMetadataInput = {
  deviceId: string;
  metadata: ObservedDeviceMetadata;
};
export type SetLocalRuntimeDisplayNameInput = SetLocalRuntimeDisplayNameBody & {
  deviceId: string;
};

export type CreateCurrentDeviceApi = (
  client: import("../client").OpenMeldApiClientFoundation
) => {
  listPeopleComputers: (input?: {
    includeUsageLimits?: "true";
  }) => Promise<PeopleComputersResponse>;
  getPeopleComputerReplyReadiness: (
    input: PeopleComputerTarget
  ) => Promise<CurrentLocalRuntimeReplyReadinessResponse>;
  getCurrentLocalRuntimeReplyReadiness: () => Promise<CurrentLocalRuntimeReplyReadinessResponse>;
  getCurrentTarget: () => Promise<CurrentDeviceTargetResponse>;
  forgetComputer: (
    input: ForgetComputerInput
  ) => Promise<ForgetComputerResponse>;
  forgetCurrentComputer: () => Promise<ForgetCurrentComputerResponse>;
  listLocalRuntimes: (
    input?: ListLocalRuntimesInput
  ) => Promise<LocalRuntimesResponse>;
  enrollLocalRuntime: (
    input: EnrollLocalRuntimeInput
  ) => Promise<LocalRuntimeEnrollmentResponse>;
  setDisplayName: (
    input: SetLocalRuntimeDisplayNameInput
  ) => Promise<LocalRuntimesResponse>;
  setCurrentLocalAgentEnabled: (
    input: SetCurrentLocalAgentEnabledInput
  ) => Promise<SetCurrentLocalAgentEnabledResponse>;
  getCurrentLocalAgentInstallations: (input: {
    agentId: string;
  }) => Promise<CurrentLocalAgentInstallationsResponse>;
  selectCurrentLocalAgentInstallation: (
    input: SelectCurrentLocalAgentInstallationInput
  ) => Promise<SelectCurrentLocalAgentInstallationResponse>;
  requestCurrentOpenMeldToolsUpdate: () => Promise<RequestCurrentOpenMeldToolsUpdateResponse>;
  setCurrentOpenMeldToolsMaintenance: (
    input: SetCurrentOpenMeldToolsMaintenanceInput
  ) => Promise<SetCurrentOpenMeldToolsMaintenanceResponse>;
  setCurrentAgentProfileWorkspace: (
    input: SetCurrentAgentProfileWorkspaceInput
  ) => Promise<SetCurrentAgentProfileWorkspaceResponse>;
  refreshCurrentLocalAgentCatalog: () => Promise<RefreshCurrentLocalAgentCatalogResponse>;
  writeObservedMetadata: (
    input: WriteCurrentDeviceObservedMetadataInput
  ) => Promise<WriteCurrentDeviceObservedMetadataResponse>;
};
