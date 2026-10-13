import {
  aiUsageQueryResponseSchema,
  organizationAiBillingSchema,
  organizationUsageOverviewResponseSchema,
} from "@openmeld/schemas";
import {
  buildOrganizationAiUsageQueryPath,
  buildOrganizationUsageOverviewPath,
} from "./routes";
import type {
  CreateOrganizationUsageApi,
  OrganizationUsageRequestInput,
} from "./types";

export const createOrganizationUsageApi: CreateOrganizationUsageApi = (
  client
) => ({
  readBilling: async (input = {}) =>
    await client.requestJson({
      ...requestOptions(input),
      method: "GET",
      operation: "organization_usage.billing.read",
      invalidMessage: "Invalid AI billing response",
      schema: organizationAiBillingSchema,
      url: "/v1/organizations/current/usage/billing",
    }),
  updateBilling: async (input) =>
    await client.requestJson({
      ...requestOptions(input),
      method: "PUT",
      operation: "organization_usage.billing.update",
      body: JSON.stringify(input.settings),
      invalidMessage: "Invalid AI billing response",
      schema: organizationAiBillingSchema,
      url: "/v1/organizations/current/usage/billing",
    }),
  query: async (input) =>
    await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(input.query),
      invalidMessage: "Invalid AI usage response",
      method: "POST",
      operation: "organization_usage.query",
      schema: aiUsageQueryResponseSchema,
      url: buildOrganizationAiUsageQueryPath(),
    }),
  readOverview: async (input = {}) =>
    await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Organization Usage overview response",
      method: "GET",
      operation: "organization_usage.overview.read",
      schema: organizationUsageOverviewResponseSchema,
      url: buildOrganizationUsageOverviewPath(),
    }),
});

function requestOptions(input: OrganizationUsageRequestInput): {
  requestContext?: OrganizationUsageRequestInput["requestContext"];
  signal?: AbortSignal;
  timeoutMs?: number;
} {
  return {
    ...(input.requestContext === undefined
      ? {}
      : { requestContext: input.requestContext }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}
