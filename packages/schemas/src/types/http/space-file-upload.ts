import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/space-file-upload");
export type SpaceFileUploadMetadata = z.infer<
  Schemas["spaceFileUploadMetadataSchema"]
>;
export type SpaceFileUploadCommand = z.infer<
  Schemas["spaceFileUploadCommandSchema"]
>;
export type SpaceFileUploadResponse = z.infer<
  Schemas["spaceFileUploadResponseSchema"]
>;
