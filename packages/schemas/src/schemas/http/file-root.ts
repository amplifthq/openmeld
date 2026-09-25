import * as z from "../../lazy-zod";

const rootIdSchema = z.string().trim().min(1).max(512);

/** A file belongs to exactly one Organization-scoped location. */
export const fileRootSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("team"),
    organizationId: rootIdSchema,
  }),
  z.strictObject({
    kind: z.literal("member"),
    organizationId: rootIdSchema,
    memberUserId: rootIdSchema,
  }),
  z.strictObject({
    kind: z.literal("space"),
    organizationId: rootIdSchema,
    spaceId: rootIdSchema,
  }),
]);
