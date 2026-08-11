import type {
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
  readOverview: (
    input?: OrganizationUsageRequestInput
  ) => Promise<OrganizationUsageOverviewResponse>;
};

export type CreateOrganizationUsageApi = (
  client: OpenMeldApiClientFoundation
) => OrganizationUsageApi;
