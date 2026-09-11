import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/plugin-actions");
export type PluginActionRequest = z.infer<Schemas["pluginActionRequestSchema"]>;
export type PluginActionRpcInput = z.infer<
  Schemas["pluginActionRpcInputSchema"]
>;
export type PluginActionResponse = z.infer<
  Schemas["pluginActionResponseSchema"]
>;
