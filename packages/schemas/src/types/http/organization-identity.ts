import type { z } from "zod/v4";

type CreateOrganizationBodySchema =
  typeof import("../../schemas/http/organization-identity")["createOrganizationBodySchema"];
type CreatedOrganizationResponseSchema =
  typeof import("../../schemas/http/organization-identity")["createdOrganizationResponseSchema"];

export type CreateOrganizationBody = z.infer<CreateOrganizationBodySchema>;
export type CreatedOrganizationResponse =
  z.infer<CreatedOrganizationResponseSchema>;
