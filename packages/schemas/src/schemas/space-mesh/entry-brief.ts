import * as z from "zod/v4";
import { trimmedStringFromUnknown } from "../protocol/shared";

const briefLineSchema = z.preprocess(
  trimmedStringFromUnknown,
  z.string().min(1)
);

export const entryBriefSchema = z.strictObject({
  whatThisRoomIs: briefLineSchema,
  youAre: briefLineSchema,
  thisRoomIsFor: briefLineSchema,
  howThisRoomWorks: briefLineSchema,
  ifUnsure: briefLineSchema,
});
