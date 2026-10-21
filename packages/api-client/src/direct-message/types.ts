import type {
  DeleteAgentDirectMessageSessionResponse,
  ListAgentDirectMessageSessionsQuery,
  ListAgentDirectMessageSessionsResponse,
  UpdateAgentDirectMessageSessionBody,
  UpdateAgentDirectMessageSessionResponse,
} from "@openmeld/schemas";
import type {
  ConvertDirectMessageToSpaceBody,
  ConvertDirectMessageToSpaceResponse,
  OpenDirectMessageSpaceBody,
  OpenDirectMessageSpaceResponse,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type DirectMessageRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type OpenDirectMessageSpaceInput = OpenDirectMessageSpaceBody &
  DirectMessageRequestInput;

export type ConvertDirectMessageToSpaceInput = ConvertDirectMessageToSpaceBody &
  DirectMessageRequestInput & {
    spaceId: string;
  };

export type ListAgentDirectMessageSessionsInput =
  ListAgentDirectMessageSessionsQuery & DirectMessageRequestInput;

export type UpdateAgentDirectMessageSessionInput = DirectMessageRequestInput & {
  spaceId: string;
  update: UpdateAgentDirectMessageSessionBody;
};

export type DeleteAgentDirectMessageSessionInput = DirectMessageRequestInput & {
  spaceId: string;
};

export type DirectMessageApi = {
  listSessions: (
    input: ListAgentDirectMessageSessionsInput
  ) => Promise<ListAgentDirectMessageSessionsResponse>;
  updateSession: (
    input: UpdateAgentDirectMessageSessionInput
  ) => Promise<UpdateAgentDirectMessageSessionResponse>;
  deleteSession: (
    input: DeleteAgentDirectMessageSessionInput
  ) => Promise<DeleteAgentDirectMessageSessionResponse>;
  convertToSpace: (
    input: ConvertDirectMessageToSpaceInput
  ) => Promise<ConvertDirectMessageToSpaceResponse>;
  openSpace: (
    input: OpenDirectMessageSpaceInput
  ) => Promise<OpenDirectMessageSpaceResponse>;
};

export type CreateDirectMessageApi = (
  client: OpenMeldApiClientFoundation
) => DirectMessageApi;
