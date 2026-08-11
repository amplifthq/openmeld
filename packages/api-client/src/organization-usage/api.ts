import { organizationUsageOverviewResponseSchema } from "@openmeld/schemas";
import { buildOrganizationUsageOverviewPath } from "./routes";
import type {
  CreateOrganizationUsageApi,
  OrganizationUsageRequestInput,
} from "./types";

export const createOrganizationUsageApi: CreateOrganizationUsageApi = (
  client
) => ({
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
