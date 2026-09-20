import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/plugin-runtime");
export type PluginRuntimeRequest = z.infer<
  Schemas["pluginRuntimeRequestSchema"]
>;
export type PluginRuntimeResponse = z.infer<
  Schemas["pluginRuntimeResponseSchema"]
>;
