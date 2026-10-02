import type {
  AiUsageQuery,
  AiUsageQueryResponse,
  OpenMeldRequestContext,
  OrganizationUsageOverviewResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type OrganizationUsageRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type OrganizationUsageApi = {
  query: (
    input: OrganizationUsageRequestInput & { query: AiUsageQuery }
  ) => Promise<AiUsageQueryResponse>;
  readOverview: (
    input?: OrganizationUsageRequestInput
  ) => Promise<OrganizationUsageOverviewResponse>;
};

export type CreateOrganizationUsageApi = (
  client: OpenMeldApiClientFoundation
) => OrganizationUsageApi;
