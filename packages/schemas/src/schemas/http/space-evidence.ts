import * as z from "zod/v4";
import { spaceEvidenceReferenceSchema } from "../../space-evidence";
import { centerAgentContextManifestEntrySchema } from "./center-agent-context-manifest";

export const spaceMessageEvidenceResponseSchema = z.strictObject({
  message: centerAgentContextManifestEntrySchema,
  offset: z.int().nonnegative(),
  nextOffset: z.int().positive().nullable(),
});

export const spaceThreadEvidenceResponseSchema = z.strictObject({
  sourceRef: spaceEvidenceReferenceSchema.options[1],
  messages: z.array(centerAgentContextManifestEntrySchema).max(20),
  offset: z.int().nonnegative(),
  nextOffset: z.int().positive().nullable(),
  truncated: z.boolean(),
});
