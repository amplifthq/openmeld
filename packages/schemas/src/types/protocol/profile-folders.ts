import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/protocol/profile-folders");
export type ProfileFolderKind = z.infer<Schemas["profileFolderKindSchema"]>;
export type ProfileFolderProjectionEntry = z.infer<
  Schemas["profileFolderProjectionEntrySchema"]
>;
export type ProfileFolderProjection = z.infer<
  Schemas["profileFolderProjectionSchema"]
>;
export type ProfileFolderOperation = z.infer<
  Schemas["profileFolderOperationSchema"]
>;
export type ProfileFolderOperationReasonCode = z.infer<
  Schemas["profileFolderOperationReasonCodeSchema"]
>;
