import type { z } from "zod/v4";

type Schemas = typeof import("../schemas/ai-billing");
export type AiFundingSource = z.infer<Schemas["aiFundingSourceSchema"]>;
export type OrganizationAiBilling = z.infer<
  Schemas["organizationAiBillingSchema"]
>;
export type OrganizationAiBillingRpcInput = z.infer<
  Schemas["organizationAiBillingRpcInputSchema"]
>;
export type UpdateOrganizationAiBilling = z.infer<
  Schemas["updateOrganizationAiBillingSchema"]
>;
export type UpdateOrganizationAiBillingRpcInput = z.infer<
  Schemas["updateOrganizationAiBillingRpcInputSchema"]
>;
export type RemoteAiProviderAuthorization = z.infer<
  Schemas["remoteAiProviderAuthorizationSchema"]
>;
