import * as z from "zod/v4";

const BOUNDED_ID_SCHEMA = z.string().trim().min(1).max(256);
const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });

export const organizationMemberOpenMeldServiceStateSchema = z.enum([
  "connected",
  "needs_attention",
  "not_connected",
  "unknown",
]);

export const organizationMemberOpenMeldServiceStatusSchema = z.strictObject({
  state: organizationMemberOpenMeldServiceStateSchema,
  userId: BOUNDED_ID_SCHEMA,
});

export const centerAgentReadMemberOpenMeldServiceStatusBodySchema =
  z.strictObject({
    memberUserId: BOUNDED_ID_SCHEMA,
  });

export const centerAgentReadMemberOpenMeldServiceStatusResponseSchema =
  z.strictObject({
    generatedAt: ISO_DATE_TIME_SCHEMA,
    member: organizationMemberOpenMeldServiceStatusSchema,
    organizationId: BOUNDED_ID_SCHEMA,
  });

export const organizationMemberOpenMeldServiceStatusesResponseSchema =
  z.strictObject({
    generatedAt: ISO_DATE_TIME_SCHEMA,
    members: z.array(organizationMemberOpenMeldServiceStatusSchema),
    organizationId: BOUNDED_ID_SCHEMA,
  });
