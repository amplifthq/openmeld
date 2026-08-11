import type { z } from "zod/v4";

type SpaceAttachmentIdSchema =
  typeof import("../../schemas/protocol/space-attachment")["spaceAttachmentIdSchema"];
type SpaceAttachmentMimeTypeSchema =
  typeof import("../../schemas/protocol/space-attachment")["spaceAttachmentMimeTypeSchema"];
type SpaceAttachmentDescriptorSchema =
  typeof import("../../schemas/protocol/space-attachment")["spaceAttachmentDescriptorSchema"];
type SpaceMessageAttachmentSchema =
  typeof import("../../schemas/protocol/space-attachment")["spaceMessageAttachmentSchema"];
type RecordSpaceAttachmentPayloadSchema =
  typeof import("../../schemas/protocol/space-attachment")["recordSpaceAttachmentPayloadSchema"];
type DeleteSpaceAttachmentRecordInputSchema =
  typeof import("../../schemas/protocol/space-attachment")["deleteSpaceAttachmentRecordInputSchema"];
type DeleteSpaceAttachmentRecordResultSchema =
  typeof import("../../schemas/protocol/space-attachment")["deleteSpaceAttachmentRecordResultSchema"];
type ResolveSpaceAttachmentForDownloadPayloadSchema =
  typeof import("../../schemas/protocol/space-attachment")["resolveSpaceAttachmentForDownloadPayloadSchema"];

export type SpaceAttachmentId = z.infer<SpaceAttachmentIdSchema>;
export type SpaceAttachmentMimeType = z.infer<SpaceAttachmentMimeTypeSchema>;
export type SpaceAttachmentDescriptor =
  z.infer<SpaceAttachmentDescriptorSchema>;
export type SpaceMessageAttachment = z.infer<SpaceMessageAttachmentSchema>;
export type RecordSpaceAttachmentPayload =
  z.infer<RecordSpaceAttachmentPayloadSchema>;
export type DeleteSpaceAttachmentRecordInput =
  z.infer<DeleteSpaceAttachmentRecordInputSchema>;
export type DeleteSpaceAttachmentRecordResult =
  z.infer<DeleteSpaceAttachmentRecordResultSchema>;
export type ResolveSpaceAttachmentForDownloadPayload =
  z.infer<ResolveSpaceAttachmentForDownloadPayloadSchema>;
