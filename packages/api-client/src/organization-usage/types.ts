import type {
  AiUsageQuery,
  AiUsageQueryResponse,
  OpenMeldRequestContext,
  OrganizationAiBilling,
  OrganizationUsageOverviewResponse,
  UpdateOrganizationAiBilling,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type OrganizationUsageRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type OrganizationUsageApi = {
  readBilling: (
    input?: OrganizationUsageRequestInput
  ) => Promise<OrganizationAiBilling>;
  updateBilling: (
    input: OrganizationUsageRequestInput & {
      settings: UpdateOrganizationAiBilling;
    }
  ) => Promise<OrganizationAiBilling>;
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
