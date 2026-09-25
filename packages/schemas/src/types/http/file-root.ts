import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/file-root");

export type FileRoot = z.infer<Schemas["fileRootSchema"]>;
