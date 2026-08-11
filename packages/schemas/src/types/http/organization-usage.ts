import type { z } from "zod/v4";

type OrganizationUsageSchemas =
  typeof import("../../schemas/http/organization-usage");

export type OrganizationUsageOverviewResponse = z.infer<
  OrganizationUsageSchemas["organizationUsageOverviewResponseSchema"]
>;

export type OrganizationUsageOverviewRpcInput = z.infer<
  OrganizationUsageSchemas["organizationUsageOverviewRpcInputSchema"]
>;
