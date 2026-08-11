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

export type DirectMessageApi = {
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
