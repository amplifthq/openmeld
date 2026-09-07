import type {
  LocalProjectControlConnectCandidateRequest,
  LocalProjectControlConnectDeclaredPathRequest,
  LocalProjectControlConnectOutcome,
  LocalProjectControlDiscoverProjectsRequest,
  LocalProjectControlDiscoverProjectsResponse,
  LocalProjectControlRemoveConnectionRequest,
  LocalProjectControlRemoveConnectionResponse,
  LocalProjectControlRemoveMissingConnectionsRequest,
  LocalProjectControlRemoveMissingConnectionsResponse,
  LocalProjectControlSetDefaultConnectionRequest,
  LocalProjectControlSetDefaultConnectionResponse,
  OpenMeldRequestContext,
  PeopleComputerTarget,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type LocalProjectControlRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type DiscoverLocalProjectsInput = LocalProjectControlRequestInput &
  LocalProjectControlDiscoverProjectsRequest;
export type ConnectLocalProjectCandidateInput =
  LocalProjectControlRequestInput & LocalProjectControlConnectCandidateRequest;
export type ConnectLocalProjectDeclaredPathInput =
  LocalProjectControlRequestInput &
    LocalProjectControlConnectDeclaredPathRequest;
export type SetDefaultLocalProjectConnectionInput =
  LocalProjectControlRequestInput &
    LocalProjectControlSetDefaultConnectionRequest;
export type RemoveLocalProjectConnectionInput =
  LocalProjectControlRequestInput & LocalProjectControlRemoveConnectionRequest;
export type RemoveMissingLocalProjectConnectionsInput =
  LocalProjectControlRequestInput &
    LocalProjectControlRemoveMissingConnectionsRequest;

export type LocalProjectControlApi = {
  discoverPeopleComputerProjects: (
    input: DiscoverLocalProjectsInput & PeopleComputerTarget
  ) => Promise<LocalProjectControlDiscoverProjectsResponse>;
  connectCandidate: (
    input: ConnectLocalProjectCandidateInput
  ) => Promise<LocalProjectControlConnectOutcome>;
  connectDeclaredPath: (
    input: ConnectLocalProjectDeclaredPathInput
  ) => Promise<LocalProjectControlConnectOutcome>;
  discoverProjects: (
    input: DiscoverLocalProjectsInput
  ) => Promise<LocalProjectControlDiscoverProjectsResponse>;
  removeConnection: (
    input: RemoveLocalProjectConnectionInput
  ) => Promise<LocalProjectControlRemoveConnectionResponse>;
  removeMissingConnections: (
    input: RemoveMissingLocalProjectConnectionsInput
  ) => Promise<LocalProjectControlRemoveMissingConnectionsResponse>;
  setDefaultConnection: (
    input: SetDefaultLocalProjectConnectionInput
  ) => Promise<LocalProjectControlSetDefaultConnectionResponse>;
};

export type CreateLocalProjectControlApi = (
  client: OpenMeldApiClientFoundation
) => LocalProjectControlApi;
