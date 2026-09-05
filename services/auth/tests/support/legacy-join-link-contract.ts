// Captured from main dc72580d4a5e4e65d39b53af31f28ae26c9ac105.
// Keep these strict receiver contracts frozen to protect shipped clients.
// biome-ignore lint/performance/noNamespaceImport: Preserve the captured schema expressions verbatim.
import * as z from "../../../../packages/schemas/src/lazy-zod";

export const organizationJoinLinkTokenSchema = z
  .string()
  .regex(/^joinlink_[0-9a-f]{64}$/);

export const organizationJoinLinkSchema = z.strictObject({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  token: organizationJoinLinkTokenSchema,
  url: z.url(),
  role: z.literal("member"),
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export const previewOrganizationJoinLinkResponseSchema = z.discriminatedUnion(
  "active",
  [
    z.strictObject({
      ok: z.literal(true),
      active: z.literal(true),
      organizationName: z.string().min(1),
      organizationSlug: z.string().min(1),
    }),
    z.strictObject({
      ok: z.literal(true),
      active: z.literal(false),
    }),
  ]
);
