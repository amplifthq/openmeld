import { z } from "zod/v4";

export const ORGANIZATION_PROTECTED_INFORMATION_MAX_CHARS = 2000;

const boundedIdentifierSchema = z.string().trim().min(1).max(256);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const organizationProtectedInformationSchema = z
  .string()
  .trim()
  .min(1)
  .max(ORGANIZATION_PROTECTED_INFORMATION_MAX_CHARS);

export const organizationInformationProtectionPolicyResponseSchema =
  z.strictObject({
    organizationId: boundedIdentifierSchema,
    protectedInformation: organizationProtectedInformationSchema.nullable(),
    updatedAt: isoDateTimeSchema.nullable(),
    updatedByUserId: boundedIdentifierSchema.nullable(),
  });

export const updateOrganizationInformationProtectionPolicyBodySchema =
  z.strictObject({
    protectedInformation: organizationProtectedInformationSchema.nullable(),
  });
