import type {
  CenterAgentSessionSelector,
  CreateCenterAgentSessionBody,
  ListCenterAgentSessionsQuery,
  ListCenterAgentSessionsResponse,
} from "@openmeld/schemas";
import type {
  CenterAgentModelConfigurationResponse,
  CenterAgentSlackWorkspaceConnectBody,
  CenterAgentSlackWorkspaceConnectionResponse,
  CenterAgentSlackWorkspaceDisconnectResponse,
  CenterAgentUpdateProfileBody,
  CenterAgentUpdateProfileResponse,
  CreateCenterAgentContextLoadReceiptBody,
  CreateCenterAgentContextLoadReceiptResponse,
  CreateCenterAgentContextManifestBody,
  CreateCenterAgentContextManifestResponse,
  DesignateCenterAgentBody,
  DesignateCenterAgentResponse,
  GetCenterAgentDesignationResponse,
  GetCenterAgentDirectMessageSpaceProjectionResponse,
  GetCenterAgentOperatingStateResponse,
  ListCenterAgentAuditJournalQuery,
  ListCenterAgentAuditJournalResponse,
  OpenCenterAgentDirectMessageSpaceResponse,
  OpenMeldRequestContext,
  SlackIdentityLinkConsumeBody,
  SlackIdentityLinkConsumeResponse,
  SlackIdentityLinkPreviewBody,
  SlackIdentityLinkPreviewResponse,
  UpdateCenterAgentModelBody,
  UpdateCenterAgentModelResponse,
  UpdateCenterAgentOperatingStateBody,
  UpdateCenterAgentOperatingStateResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type CenterAgentRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type CenterAgentDesignateInput = DesignateCenterAgentBody &
  CenterAgentRequestInput;

export type CenterAgentUpdateProfileInput = CenterAgentUpdateProfileBody &
  CenterAgentRequestInput;

export type CenterAgentUpdateOperatingStateInput =
  UpdateCenterAgentOperatingStateBody & CenterAgentRequestInput;

export type CenterAgentUpdateModelInput = UpdateCenterAgentModelBody &
  CenterAgentRequestInput;

export type CenterAgentSlackWorkspaceConnectInput =
  CenterAgentSlackWorkspaceConnectBody & CenterAgentRequestInput;

export type SlackIdentityLinkPreviewInput = SlackIdentityLinkPreviewBody &
  CenterAgentRequestInput;

export type SlackIdentityLinkConsumeInput = SlackIdentityLinkConsumeBody &
  CenterAgentRequestInput;

export type ListCenterAgentAuditJournalInput =
  ListCenterAgentAuditJournalQuery & CenterAgentRequestInput;

export type CreateCenterAgentContextManifestInput =
  CreateCenterAgentContextManifestBody & CenterAgentRequestInput;

export type CreateCenterAgentContextLoadReceiptInput =
  CreateCenterAgentContextLoadReceiptBody &
    CenterAgentRequestInput & { manifestId: string };

export type CenterAgentApi = {
  getDesignation: (
    input?: CenterAgentRequestInput
  ) => Promise<GetCenterAgentDesignationResponse>;
  designate: (
    input: CenterAgentDesignateInput
  ) => Promise<DesignateCenterAgentResponse>;
  getModel: (
    input?: CenterAgentRequestInput
  ) => Promise<CenterAgentModelConfigurationResponse>;
  updateModel: (
    input: CenterAgentUpdateModelInput
  ) => Promise<UpdateCenterAgentModelResponse>;
  getOperatingState: (
    input?: CenterAgentRequestInput
  ) => Promise<GetCenterAgentOperatingStateResponse>;
  updateOperatingState: (
    input: CenterAgentUpdateOperatingStateInput
  ) => Promise<UpdateCenterAgentOperatingStateResponse>;
  connectSlackWorkspace: (
    input: CenterAgentSlackWorkspaceConnectInput
  ) => Promise<CenterAgentSlackWorkspaceConnectionResponse>;
  disconnectSlackWorkspace: (
    input?: CenterAgentRequestInput
  ) => Promise<CenterAgentSlackWorkspaceDisconnectResponse>;
  previewSlackIdentityLink: (
    input: SlackIdentityLinkPreviewInput
  ) => Promise<SlackIdentityLinkPreviewResponse>;
  consumeSlackIdentityLink: (
    input: SlackIdentityLinkConsumeInput
  ) => Promise<SlackIdentityLinkConsumeResponse>;
  updateProfile: (
    input: CenterAgentUpdateProfileInput
  ) => Promise<CenterAgentUpdateProfileResponse>;
  listAuditJournal: (
    input?: ListCenterAgentAuditJournalInput
  ) => Promise<ListCenterAgentAuditJournalResponse>;
  createContextManifest: (
    input: CreateCenterAgentContextManifestInput
  ) => Promise<CreateCenterAgentContextManifestResponse>;
  createContextLoadReceipt: (
    input: CreateCenterAgentContextLoadReceiptInput
  ) => Promise<CreateCenterAgentContextLoadReceiptResponse>;
  openDirectMessageSpace: (
    input?: CenterAgentRequestInput
  ) => Promise<OpenCenterAgentDirectMessageSpaceResponse>;
  createSession: (
    input: CenterAgentRequestInput & CreateCenterAgentSessionBody
  ) => Promise<OpenCenterAgentDirectMessageSpaceResponse>;
  listSessions: (
    input?: CenterAgentRequestInput & ListCenterAgentSessionsQuery
  ) => Promise<ListCenterAgentSessionsResponse>;
  getSession: (
    input: CenterAgentRequestInput & CenterAgentSessionSelector
  ) => Promise<GetCenterAgentDirectMessageSpaceProjectionResponse>;
  getDirectMessageSpaceProjection: (
    input?: CenterAgentRequestInput
  ) => Promise<GetCenterAgentDirectMessageSpaceProjectionResponse>;
};

export type CreateCenterAgentApi = (
  client: OpenMeldApiClientFoundation
) => CenterAgentApi;
