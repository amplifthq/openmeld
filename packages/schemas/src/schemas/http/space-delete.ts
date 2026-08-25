import * as z from "zod/v4";
import { nonEmptyTrimmedStringFromUnknown } from "../protocol/shared";

export const deleteSpaceResponseSchema = z.strictObject({
  spaceId: nonEmptyTrimmedStringFromUnknown,
  deleted: z.literal(true),
});
