import * as z from "zod/v4";
import {
  spaceAttachmentDescriptorSchema,
  spaceAttachmentDimensionSchema,
  spaceAttachmentFileNameSchema,
} from "../protocol/space-attachment";

const spaceAttachmentQueryDimensionSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(spaceAttachmentDimensionSchema);

/**
 * Optional metadata sent as query parameters on the raw-binary upload request.
 * Width and height are client-declared layout hints and are not verified by
 * decoding the image on the server.
 */
export const spaceAttachmentUploadQuerySchema = z.strictObject({
  fileName: spaceAttachmentFileNameSchema.optional(),
  width: spaceAttachmentQueryDimensionSchema.optional(),
  height: spaceAttachmentQueryDimensionSchema.optional(),
});

export const uploadSpaceAttachmentResponseSchema = z.strictObject({
  attachment: spaceAttachmentDescriptorSchema,
});
