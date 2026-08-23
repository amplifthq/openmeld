import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/center-agent-space-files");

export type CenterAgentListSpaceFilesRpcInput = z.infer<
  Schemas["centerAgentListSpaceFilesRpcInputSchema"]
>;
export type CenterAgentListSpaceFilesResponse = z.infer<
  Schemas["centerAgentListSpaceFilesResponseSchema"]
>;
export type CenterAgentReadSpaceFileRpcInput = z.infer<
  Schemas["centerAgentReadSpaceFileRpcInputSchema"]
>;
export type CenterAgentReadSpaceFileResponse = z.infer<
  Schemas["centerAgentReadSpaceFileResponseSchema"]
>;
export type CenterAgentSaveSpaceFileRpcInput = z.infer<
  Schemas["centerAgentSaveSpaceFileRpcInputSchema"]
>;
export type CenterAgentSaveSpaceFileResponse = z.infer<
  Schemas["centerAgentSaveSpaceFileResponseSchema"]
>;
export type CenterAgentManageSpaceFilesRpcInput = z.infer<
  Schemas["centerAgentManageSpaceFilesRpcInputSchema"]
>;
export type CenterAgentManageSpaceFilesResponse = z.infer<
  Schemas["centerAgentManageSpaceFilesResponseSchema"]
>;
