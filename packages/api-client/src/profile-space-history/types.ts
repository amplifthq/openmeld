import type {
  OpenMeldRequestContext,
  PatchProfileSpaceHistoryStatusBody,
  PatchProfileSpaceHistoryStatusResponse,
  ProfileSpaceHistoryRecord,
  ProfileSpaceHistoryStatus,
  UpsertProfileSpaceHistoryBody,
  UpsertProfileSpaceHistoryResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type ListProfileSpaceHistoryInput = {
  requestContext?: OpenMeldRequestContext;
  profileId: string;
  gatewayHost: string;
  statuses?: readonly ProfileSpaceHistoryStatus[];
  pinned?: boolean;
  limit?: number;
  timeoutMs?: number;
};

export type UpsertProfileSpaceHistoryInput = {
  requestContext?: OpenMeldRequestContext;
  profileId: string;
  spaceId: string;
  body: UpsertProfileSpaceHistoryBody;
  timeoutMs?: number;
};

export type UpdateProfileSpaceHistoryStatusInput = {
  requestContext?: OpenMeldRequestContext;
  profileId: string;
  spaceId: string;
  body: PatchProfileSpaceHistoryStatusBody;
  timeoutMs?: number;
};

export type ProfileSpaceHistoryApi = {
  listProfileSpaceHistory: (
    input: ListProfileSpaceHistoryInput
  ) => Promise<readonly ProfileSpaceHistoryRecord[]>;
  upsertProfileSpaceHistory: (
    input: UpsertProfileSpaceHistoryInput
  ) => Promise<UpsertProfileSpaceHistoryResponse>;
  updateProfileSpaceHistoryStatus: (
    input: UpdateProfileSpaceHistoryStatusInput
  ) => Promise<PatchProfileSpaceHistoryStatusResponse>;
};

export type CreateProfileSpaceHistoryApi = (
  client: OpenMeldApiClientFoundation
) => ProfileSpaceHistoryApi;
