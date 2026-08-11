import {
  listProfileSpaceHistoryResponseSchema,
  patchProfileSpaceHistoryStatusResponseSchema,
  upsertProfileSpaceHistoryResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildProfileSpaceHistoryListPath,
  buildProfileSpaceHistoryStatusPath,
  buildProfileSpaceHistoryUpsertPath,
} from "./routes";
import type { CreateProfileSpaceHistoryApi } from "./types";

export const createProfileSpaceHistoryApi: CreateProfileSpaceHistoryApi = (
  client: OpenMeldApiClientFoundation
) => {
  return {
    listProfileSpaceHistory: async (input) => {
      const result = await client.requestJson({
        url: buildProfileSpaceHistoryListPath(input),
        operation: "profile_space_history.list",
        method: "GET",
        requestContext: input.requestContext,
        timeoutMs: input.timeoutMs,
        schema: listProfileSpaceHistoryResponseSchema,
        invalidMessage: "invalid profile-space-history list response",
      });
      return result.items;
    },
    upsertProfileSpaceHistory: async (input) =>
      await client.requestJson({
        url: buildProfileSpaceHistoryUpsertPath(input),
        operation: "profile_space_history.upsert",
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input.body),
        requestContext: input.requestContext,
        timeoutMs: input.timeoutMs,
        schema: upsertProfileSpaceHistoryResponseSchema,
        invalidMessage: "invalid profile-space-history upsert response",
      }),
    updateProfileSpaceHistoryStatus: async (input) =>
      await client.requestJson({
        url: buildProfileSpaceHistoryStatusPath(input),
        operation: "profile_space_history.status.update",
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input.body),
        requestContext: input.requestContext,
        timeoutMs: input.timeoutMs,
        schema: patchProfileSpaceHistoryStatusResponseSchema,
        invalidMessage: "invalid profile-space-history status response",
      }),
  };
};
