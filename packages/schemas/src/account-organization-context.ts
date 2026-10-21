import * as z from "zod/v4";

export const ACCOUNT_ORGANIZATION_CONTEXT_PATH =
  "/v1/account/organization-context" as const;

// Opt in only when the caller observes the Account Session HTTP read, which
// remains responsible for returning the vendor's session-renewal cookies.
export const accountOrganizationContextQuerySchema = z.object({
  deferSessionRefresh: z.literal("true").optional(),
});

export const organizationSummarySchema = z.strictObject({
  id: z.string().refine((value) => value.trim().length > 0),
  name: z.string().refine((value) => value.trim().length > 0),
  slug: z.string().refine((value) => value.trim().length > 0),
  logo: z.string().nullable().optional(),
  isPersonal: z.boolean().optional(),
});

export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const accountOrganizationContextSchema = z
  .strictObject({
    account: z.strictObject({
      email: z.string().nullable(),
      image: z.string().nullable(),
      name: z.string().nullable(),
    }),
    currentUserId: z.string().trim().min(1),
    organizations: z.array(organizationSummarySchema),
    defaultOrganizationId: z.string().min(1).nullable(),
  })
  .refine((value) =>
    value.defaultOrganizationId === null
      ? value.organizations.length === 0
      : value.organizations.some(
          (organization) => organization.id === value.defaultOrganizationId
        )
  );

export type AccountOrganizationContext = z.infer<
  typeof accountOrganizationContextSchema
>;
