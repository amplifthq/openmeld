import type { z } from "zod/v4";

type SpaceAttachmentUploadQuerySchema =
  typeof import("../../schemas/http/space-attachments")["spaceAttachmentUploadQuerySchema"];
type UploadSpaceAttachmentResponseSchema =
  typeof import("../../schemas/http/space-attachments")["uploadSpaceAttachmentResponseSchema"];

export type SpaceAttachmentUploadQuery =
  z.infer<SpaceAttachmentUploadQuerySchema>;
export type UploadSpaceAttachmentResponse =
  z.infer<UploadSpaceAttachmentResponseSchema>;
