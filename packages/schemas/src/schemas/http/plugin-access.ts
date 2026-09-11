import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import {
  connectorConnectionNameSchema,
  connectorServiceSchema,
} from "./connector-connections";

export const pluginConsumerSchema = z.enum([
  "center_agent",
  "local_agent",
  "remote_agent",
]);
export const pluginPermissionSchema = z.enum(["none", "read", "write"]);
export const pluginAccessPolicySchema = z.strictObject({
  center_agent: pluginPermissionSchema,
  local_agent: pluginPermissionSchema,
  remote_agent: pluginPermissionSchema,
});
export const pluginAccessSchema = z.strictObject({
  canManage: z.boolean(),
  connectionName: connectorConnectionNameSchema,
  policy: pluginAccessPolicySchema,
  revision: z.number().int().nonnegative(),
});
export const pluginAccessListResponseSchema = z.strictObject({
  organizationId: z.string().trim().min(1),
  connections: z.array(pluginAccessSchema),
});
export const pluginAccessListRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  expectedOrganizationId: z.string().trim().min(1),
  service: connectorServiceSchema,
});
export const pluginAccessUpdateBodySchema = z.strictObject({
  connectionName: connectorConnectionNameSchema,
  expectedRevision: z.number().int().nonnegative(),
  policy: pluginAccessPolicySchema,
});
export const pluginAccessUpdateRpcInputSchema =
  pluginAccessListRpcInputSchema.extend({
    ...pluginAccessUpdateBodySchema.shape,
  });
