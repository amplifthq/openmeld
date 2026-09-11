import {
  pluginActionRequestSchema,
  pluginActionResponseSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  PluginActionRequest,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export function createPluginsApi(client: OpenMeldApiClientFoundation) {
  return {
    action: async (input: {
      organizationId: string;
      requestContext: OpenMeldRequestContext;
      request: PluginActionRequest;
    }) => {
      const request = pluginActionRequestSchema.parse(input.request);
      return await client.requestJson({
        method: "POST",
        operation: "plugins.action",
        timeoutMs:
          input.request.action.operation === "execute" ? 120_000 : 30_000,
        requestContext: input.requestContext,
        url: `/v1/organizations/current/plugins/actions?expectedOrganizationId=${encodeURIComponent(input.organizationId)}`,
        body: JSON.stringify(request),
        headers: { "content-type": "application/json" },
        schema: pluginActionResponseSchema,
        invalidMessage: "Invalid plugin action response.",
      });
    },
  };
}
