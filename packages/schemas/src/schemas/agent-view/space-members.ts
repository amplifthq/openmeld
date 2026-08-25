import * as z from "zod/v4";
import { spaceMembersSnapshotSchema } from "../http/space-members";

export const spaceMembersEventSchema = z.strictObject({
  type: z.literal("system.space.members"),
  payload: spaceMembersSnapshotSchema,
});
