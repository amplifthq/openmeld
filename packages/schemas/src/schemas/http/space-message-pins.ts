import * as z from "zod/v4";
import { uuidProfileIdSchema } from "../protocol/profile";
import { spaceFileDescriptorSchema } from "./space-files";

export const spaceFilePinMutationSchema = z.strictObject({
  fileId: z.string().trim().min(1).max(200),
  action: z.enum(["pin", "unpin"]),
});
export const spaceFilePinsResponseSchema = z.strictObject({
  pins: z.array(
    z.strictObject({
      file: spaceFileDescriptorSchema,
      pinnedByProfileId: uuidProfileIdSchema,
      pinnedByName: z.string(),
      pinnedAt: z.string(),
    })
  ),
});

export const spaceMessagePinMutationSchema = z.strictObject({
  signalId: z.string().trim().min(1).max(200),
  action: z.enum(["pin", "unpin"]),
});

export const spaceMessagePinsResponseSchema = z.strictObject({
  pins: z.array(
    z.strictObject({
      signalId: z.string().min(1),
      pinnedByProfileId: uuidProfileIdSchema,
      pinnedByName: z.string(),
      pinnedAt: z.string(),
      authorName: z.string(),
      preview: z.string(),
    })
  ),
});
