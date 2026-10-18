import type { SuggestPermissionModeRequest } from "@openmeld/schemas";
import {
  listPermissionModeSuggestionsResponseSchema,
  resolvePermissionModeSuggestionResponseSchema,
  suggestPermissionModeRequestSchema,
  suggestPermissionModeResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

const SUGGESTIONS_URL = "/v1/organizations/current/permission-mode-suggestions";

function withOrganization(path: string, organizationId: string): string {
  return `${path}?expectedOrganizationId=${encodeURIComponent(organizationId)}`;
}

export function createPermissionModeSuggestionsApi(
  client: OpenMeldApiClientFoundation
) {
  return {
    /** The task stand-in's `suggest_permission_mode` action. */
    suggest: (input: {
      organizationId: string;
      request: SuggestPermissionModeRequest;
      requestContext: OpenMeldRequestContext;
    }) =>
      client.requestJson({
        body: JSON.stringify(
          suggestPermissionModeRequestSchema.parse(input.request)
        ),
        headers: { "content-type": "application/json" },
        invalidMessage: "Invalid permission-mode suggestion response.",
        method: "POST",
        operation: "permissionModeSuggestions.suggest",
        requestContext: input.requestContext,
        schema: suggestPermissionModeResponseSchema,
        url: withOrganization(SUGGESTIONS_URL, input.organizationId),
      }),
    list: (input: { organizationId: string; spaceId: string }) =>
      client.requestJson({
        body: JSON.stringify({ spaceId: input.spaceId }),
        headers: { "content-type": "application/json" },
        invalidMessage: "Invalid permission-mode suggestions response.",
        method: "POST",
        operation: "permissionModeSuggestions.list",
        schema: listPermissionModeSuggestionsResponseSchema,
        url: withOrganization(`${SUGGESTIONS_URL}/list`, input.organizationId),
      }),
    resolve: (input: {
      organizationId: string;
      resolution: "applied" | "dismissed";
      suggestionId: string;
    }) =>
      client.requestJson({
        body: JSON.stringify({
          resolution: input.resolution,
          suggestionId: input.suggestionId,
        }),
        headers: { "content-type": "application/json" },
        invalidMessage: "Invalid permission-mode suggestion response.",
        method: "POST",
        operation: "permissionModeSuggestions.resolve",
        schema: resolvePermissionModeSuggestionResponseSchema,
        url: withOrganization(
          `${SUGGESTIONS_URL}/resolve`,
          input.organizationId
        ),
      }),
  };
}
