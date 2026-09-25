import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/file-root");

export type FileRoot = z.infer<Schemas["fileRootSchema"]>;
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
