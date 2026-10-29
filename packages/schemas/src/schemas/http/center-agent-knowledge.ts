import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";

export const centerAgentReadSpaceGuideRequestSchema = z.strictObject({
  context: openMeldRequestContextSchema,
});
export const centerAgentReadSpaceGuideResponseSchema = z.strictObject({
  guide: z.string().nullable(),
  sourceRef: z.strictObject({
    kind: z.literal("space_guide"),
    spaceId: z.string().min(1).max(512),
    state: z.literal("current"),
    version: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
});
