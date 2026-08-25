import * as z from "zod/v4";
import { spaceMetaSchema } from "./space-meta";

export const createSpaceResponseSchema = z.strictObject({
  spaceId: spaceMetaSchema.shape.spaceId,
  meta: spaceMetaSchema.optional(),
});
