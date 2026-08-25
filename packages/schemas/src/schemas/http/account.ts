import * as z from "zod/v4";
import { gatewayErrorEnvelopeSchema } from "./gateway-error";
import { authProfileViewSchema } from "./profiles";

export const ACCOUNT_DISPLAY_NAME_MAX_LENGTH = 32;

export const accountDisplayNameSchema = z
  .string()
  .trim()
  .min(1, { message: "Display name is required" })
  .max(ACCOUNT_DISPLAY_NAME_MAX_LENGTH, {
    message: `Display name must be ${ACCOUNT_DISPLAY_NAME_MAX_LENGTH} characters or less`,
  });

export const updateAccountDisplayNameBodySchema = z.strictObject({
  displayName: accountDisplayNameSchema,
});

export const updateAccountDisplayNameCompatibilityBodySchema = z.strictObject({
  name: accountDisplayNameSchema,
});

export const updateAccountDisplayNameCompatibilityResponseSchema =
  z.strictObject({
    status: z.literal(true),
  });

export const updateAccountDisplayNameResponseSchema = z.strictObject({
  ok: z.literal(true),
  displayName: accountDisplayNameSchema,
  defaultHumanProfile: authProfileViewSchema,
});

export const accountOrganizationIdSchema = z.string().trim().min(1).max(255);

export const selectLastSelectedOrganizationBodySchema = z.strictObject({
  organizationId: accountOrganizationIdSchema,
});

export const selectLastSelectedOrganizationResponseSchema = z.strictObject({
  ok: z.literal(true),
  organizationId: accountOrganizationIdSchema,
});

export const selectLastSelectedOrganizationErrorCodeSchema = z.enum([
  "auth.invalid_origin",
  "auth.unauthenticated",
  "invalid_payload",
  "organization.membership_required",
  "upstream_error",
  "upstream_unreachable",
]);

export const selectLastSelectedOrganizationErrorResponseSchema =
  gatewayErrorEnvelopeSchema.extend({
    error: gatewayErrorEnvelopeSchema.shape.error.extend({
      code: selectLastSelectedOrganizationErrorCodeSchema,
    }),
  });
