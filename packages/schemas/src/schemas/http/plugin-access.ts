import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import {
  connectorConnectionNameSchema,
  connectorServiceSchema,
} from "./connector-connections";

export const PLUGIN_ERROR_CODES = [
  "plugin.access_changed",
  "plugin.access_invalid",
  "plugin.access_manage_forbidden",
  "plugin.action_forbidden",
  "plugin.action_unavailable",
  "plugin.caller_forbidden",
  "plugin.catalog_unavailable",
  "plugin.confirmation_invalid",
  "plugin.connection_not_found",
  "plugin.connection_owner_unavailable",
  "plugin.connection_required",
  "plugin.connection_unavailable",
  "plugin.human_required",
  "plugin.identity_unavailable",
  "plugin.operation_identity_unavailable",
  "plugin.operation_unavailable",
  "plugin.personal_request_required",
  "plugin.request_invalid",
  "plugin.request_provenance_unavailable",
  "plugin.runtime_invalid",
  "plugin.runtime_unavailable",
  "plugin.state_unavailable",
] as const;

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
  scope: z.enum(["member", "shared"]),
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
export const pluginAccessUpdateRpcInputSchema = z.lazySchema(() =>
  pluginAccessListRpcInputSchema.extend({
    ...pluginAccessUpdateBodySchema.shape,
  })
);
