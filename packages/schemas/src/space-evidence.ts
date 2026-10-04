import * as z from "zod/v4";
import { spaceThreadIdSchema } from "./schemas/space-mesh/space-thread";

const id = z.string().trim().min(1).max(256);
const version = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

/** References select evidence; they never convey source access. */
export const spaceEvidenceReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("message"),
    spaceId: id,
    sourceSignalId: id,
    version,
  }),
  z.strictObject({
    kind: z.literal("thread"),
    spaceId: id,
    threadId: spaceThreadIdSchema,
    version,
  }),
  z.strictObject({
    kind: z.literal("file"),
    spaceId: id,
    fileId: id,
    revision: z.int().positive(),
  }),
]);
export const spaceEvidenceReferencesSchema = z
  .array(spaceEvidenceReferenceSchema)
  .min(1)
  .max(20);

export const spaceThreadEvidenceRequestSchema = z
  .strictObject({
    threadId: spaceThreadIdSchema,
    version: version.optional(),
    offset: z.int().nonnegative().max(10_000).optional(),
  })
  .refine((value) => !value.offset || value.version !== undefined, {
    message: "A continuation must retain the thread version.",
  });

export type SpaceEvidenceReference = z.infer<
  typeof spaceEvidenceReferenceSchema
>;
