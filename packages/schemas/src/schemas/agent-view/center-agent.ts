import * as z from "zod/v4";

export const centerAgentOrganizationTargetSchema = z.strictObject({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  personal: z.boolean().optional(),
  role: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1),
});

export const centerAgentOrganizationScopeSchema = z.strictObject({
  selection: z.enum(["current", "explicit"]),
  target: centerAgentOrganizationTargetSchema,
});
