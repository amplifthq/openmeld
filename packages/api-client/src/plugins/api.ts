import {
  listPluginActionRequestsResponseSchema,
  pluginActionRequestCommandSchema,
  pluginActionRequestSchema,
  pluginActionRequestViewSchema,
  pluginActionResponseSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  PluginActionRequest,
  PluginActionRequestCommand,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export function createPluginsApi(client: OpenMeldApiClientFoundation) {
  return {
    listRequests: (input: {
      organizationId: string;
      spaceId: string;
      sourceSignalIds?: string[];
    }) =>
      client.requestJson({
        method: "POST",
        operation: "plugins.listRequests",
        url: `/v1/organizations/current/plugins/action-requests/list?expectedOrganizationId=${encodeURIComponent(input.organizationId)}`,
        body: JSON.stringify({
          spaceId: input.spaceId,
          sourceSignalIds: input.sourceSignalIds,
        }),
        headers: { "content-type": "application/json" },
        schema: listPluginActionRequestsResponseSchema,
        invalidMessage: "Invalid Plugin requests response.",
      }),
    requestAuthorization: (input: {
      organizationId: string;
      command: PluginActionRequestCommand;
      requestContext?: OpenMeldRequestContext;
      includeIssuePreview?: boolean;
    }) =>
      client.requestJson({
        method: "POST",
        operation: "plugins.requestAuthorization",
        requestContext: input.requestContext,
        url: `/v1/organizations/current/plugins/action-requests?expectedOrganizationId=${encodeURIComponent(input.organizationId)}&includeMessageContext=true${input.includeIssuePreview ? "&includeIssuePreview=true" : ""}`,
        body: JSON.stringify(
          pluginActionRequestCommandSchema.parse(input.command)
        ),
        headers: { "content-type": "application/json" },
        schema: pluginActionRequestViewSchema,
        invalidMessage: "Invalid Plugin request response.",
      }),
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
