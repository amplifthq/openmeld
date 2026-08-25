import * as z from "zod/v4";
import { nonEmptyTrimmedStringFromUnknown } from "../protocol/shared";

export const spaceRouteParamsSchema = z.strictObject({
  spaceId: nonEmptyTrimmedStringFromUnknown,
});
