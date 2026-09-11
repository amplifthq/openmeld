import * as z from "zod/v4";
import { spaceFileActorSchema, spaceFileEntryIdSchema } from "./space-files";

export const spaceFileUpdateSettingsSchema = z.strictObject({
  fileId: spaceFileEntryIdSchema,
  version: z.number().int().nonnegative(),
  recipientProfileIds: z.array(z.string().trim().min(1)).max(50),
  configuredBy: spaceFileActorSchema.nullable(),
});

export const spaceFileUpdateSettingsCommandSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({ action: z.literal("read") }),
    z.strictObject({
      action: z.literal("configure"),
      baseVersion: z.number().int().nonnegative(),
      recipientProfileIds: z.array(z.string().trim().min(1)).max(50),
    }),
  ]
);

export type SpaceFileUpdateSettings = z.infer<
  typeof spaceFileUpdateSettingsSchema
>;
export type SpaceFileUpdateSettingsCommand = z.infer<
  typeof spaceFileUpdateSettingsCommandSchema
>;
