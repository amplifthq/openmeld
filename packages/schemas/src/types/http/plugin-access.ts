import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/plugin-access");
export type PluginConsumer = z.infer<Schemas["pluginConsumerSchema"]>;
export type PluginPermission = z.infer<Schemas["pluginPermissionSchema"]>;
export type PluginAccessPolicy = z.infer<Schemas["pluginAccessPolicySchema"]>;
export type PluginAccess = z.infer<Schemas["pluginAccessSchema"]>;
export type PluginAccessListResponse = z.infer<
  Schemas["pluginAccessListResponseSchema"]
>;
export type PluginAccessListRpcInput = z.infer<
  Schemas["pluginAccessListRpcInputSchema"]
>;
export type PluginAccessUpdateBody = z.infer<
  Schemas["pluginAccessUpdateBodySchema"]
>;
export type PluginAccessUpdateRpcInput = z.infer<
  Schemas["pluginAccessUpdateRpcInputSchema"]
>;
