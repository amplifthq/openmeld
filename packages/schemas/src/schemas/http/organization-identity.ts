import { z } from "zod/v4";

export const ORGANIZATION_NAME_MAX_LENGTH = 255;

export const organizationNameSchema = z
  .string()
  .trim()
  .min(1, { message: "Organization name is required." })
  .max(ORGANIZATION_NAME_MAX_LENGTH, {
    message: `Organization name must be ${ORGANIZATION_NAME_MAX_LENGTH} characters or less.`,
  });

/**
 * The optional slug keeps already-deployed Web clients compatible while Auth
 * becomes the only writer of generated Organization URL slugs. Auth never uses
 * this client value for a new Organization.
 */
export const createOrganizationBodySchema = z.strictObject({
  name: organizationNameSchema,
  slug: z.string().optional(),
});

export const createdOrganizationResponseSchema = z.object({
  id: z.string().trim().min(1),
  logo: z.string().nullable().optional(),
  name: organizationNameSchema,
  slug: z.string().trim().min(1),
});
