import type { infer as Infer } from "zod/v4";

import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";

const id = z.string().trim().min(1).max(256);
export const organizationDashboardKindSchema = z.enum([
  "github_issues",
  "ugc",
  "traffic",
]);
export const organizationDashboardArtifactSchema = z.strictObject({
  spaceId: z.string().trim().min(1).max(512),
  fileId: z.string().trim().min(1).max(128),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});
const fields = {
  organizationId: id,
  name: z.string().trim().min(1).max(100),
  kind: organizationDashboardKindSchema,
  repository: z
    .string()
    .trim()
    .max(140)
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)
    .nullish(),
  artifact: organizationDashboardArtifactSchema.nullish(),
};
export const organizationDashboardMutationSchema = z
  .discriminatedUnion("operation", [
    z.strictObject({ ...fields, operation: z.literal("create") }),
    z.strictObject({ ...fields, id, operation: z.literal("update") }),
    z.strictObject({ organizationId: id, id, operation: z.literal("archive") }),
  ])
  .refine(
    (value) =>
      value.operation === "archive" ||
      (value.kind === "github_issues"
        ? Boolean(value.repository) && !value.artifact
        : !value.repository),
    "Select the correct source for this dashboard."
  );
export const organizationDashboardQuerySchema = z.strictObject({
  organizationId: id,
  id: id.optional(),
});
const organizationDashboardSchema = z.strictObject({
  id,
  name: fields.name,
  kind: fields.kind,
  repository: fields.repository.unwrap().unwrap().nullable(),
  hasArtifact: z.boolean(),
  artifact: organizationDashboardArtifactSchema.nullable(),
  canManage: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const organizationDashboardResponseSchema = z.strictObject({
  organizationId: id,
  dashboards: z.array(organizationDashboardSchema),
});
export const organizationDashboardRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  input: z.union([
    organizationDashboardQuerySchema,
    organizationDashboardMutationSchema,
  ]),
});
export type OrganizationDashboard = Infer<typeof organizationDashboardSchema>;
export type OrganizationDashboardMutation = Infer<
  typeof organizationDashboardMutationSchema
>;
export type OrganizationDashboardArtifact = Infer<
  typeof organizationDashboardArtifactSchema
>;
export type OrganizationDashboardRpcInput = Infer<
  typeof organizationDashboardRpcInputSchema
>;
