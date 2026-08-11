// biome-ignore-all lint/performance/noBarrelFile: This folder intentionally exposes a small shared module surface.

export { createProfileSpaceHistoryApi } from "./api";
export {
  buildProfileSpaceHistoryListPath,
  buildProfileSpaceHistoryStatusPath,
  buildProfileSpaceHistoryUpsertPath,
  resolveProfileSpaceHistoryGatewayHost,
} from "./routes";
export type {
  CreateProfileSpaceHistoryApi,
  ListProfileSpaceHistoryInput,
  ProfileSpaceHistoryApi,
  UpdateProfileSpaceHistoryStatusInput,
  UpsertProfileSpaceHistoryInput,
} from "./types";
