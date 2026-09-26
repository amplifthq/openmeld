import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/file-root");

export type FileRoot = z.infer<Schemas["fileRootSchema"]>;
export type CopyFileRootRevisionBody = z.infer<
  Schemas["copyFileRootRevisionBodySchema"]
>;
export type CopyFileRootRevisionResponse = z.infer<
  Schemas["copyFileRootRevisionResponseSchema"]
>;
export type CopyFileRootToSpaceBody = z.infer<
  Schemas["copyFileRootToSpaceBodySchema"]
>;
export type FileRootEntry = z.infer<Schemas["fileRootEntrySchema"]>;
export type FileRootFileDescriptor = z.infer<
  Schemas["fileRootFileDescriptorSchema"]
>;
export type FileRootFolderDescriptor = z.infer<
  Schemas["fileRootFolderDescriptorSchema"]
>;
export type ListFileRootResponse = z.infer<
  Schemas["listFileRootResponseSchema"]
>;
export type RemoteAgentListTeamFilesRpcInput = z.infer<
  Schemas["remoteAgentListTeamFilesRpcInputSchema"]
>;
export type RemoteAgentReadTeamFileRpcInput = z.infer<
  Schemas["remoteAgentReadTeamFileRpcInputSchema"]
>;
export type RemoteAgentReadTeamFileResponse = z.infer<
  Schemas["remoteAgentReadTeamFileResponseSchema"]
>;
export type RemoteAgentSaveTeamFileRpcInput = z.infer<
  Schemas["remoteAgentSaveTeamFileRpcInputSchema"]
>;
export type RemoteAgentSaveTeamFileResponse = z.infer<
  Schemas["remoteAgentSaveTeamFileResponseSchema"]
>;
