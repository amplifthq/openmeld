import {
  spaceMessageAttachmentSchema,
  spaceMessageAttachmentsSchema,
} from "@openmeld/schemas";
import type {
  SpaceAttachmentDescriptor,
  SpaceMessageAttachment,
} from "@openmeld/schemas/types";
import { readSpaceAttachmentRecord } from "../infrastructure/d1/space-attachment-repo";

export const ATTACHMENT_REFERENCE_INVALID_MESSAGE =
  "One or more attachment references are invalid for this Space.";

export class SpaceAttachmentReferenceInvalidError extends Error {
  constructor() {
    super(ATTACHMENT_REFERENCE_INVALID_MESSAGE);
    this.name = "SpaceAttachmentReferenceInvalidError";
  }
}

export async function resolveSpaceMessageAttachmentReferences(input: {
  attachments: unknown;
  db: D1Database;
  organizationId: string;
  spaceId: string;
}): Promise<SpaceMessageAttachment[]> {
  const references = spaceMessageAttachmentsSchema.safeParse(input.attachments);
  if (!references.success) {
    throw new SpaceAttachmentReferenceInvalidError();
  }

  const canonicalReferences: SpaceMessageAttachment[] = [];
  for (const reference of references.data) {
    const attachment = await readSpaceAttachmentRecord({
      attachmentId: reference.id,
      db: input.db,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
    });
    if (!attachment) {
      throw new SpaceAttachmentReferenceInvalidError();
    }
    canonicalReferences.push(toSpaceMessageAttachment(attachment));
  }
  return canonicalReferences;
}

function toSpaceMessageAttachment(
  attachment: SpaceAttachmentDescriptor
): SpaceMessageAttachment {
  return spaceMessageAttachmentSchema.parse({
    id: attachment.id,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    ...(attachment.width === undefined ? {} : { width: attachment.width }),
    ...(attachment.height === undefined ? {} : { height: attachment.height }),
    ...(attachment.fileName === undefined
      ? {}
      : { fileName: attachment.fileName }),
  });
}
