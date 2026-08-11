import { describe, expect, it } from "vitest";
import {
  buildSpaceAttachmentObjectKey,
  deleteSpaceAttachmentRecordInputSchema,
  deleteSpaceAttachmentRecordResultSchema,
  detectSpaceAttachmentMimeType,
  gatewayErrorCodeSchema,
  projectSpaceMessageAttachment,
  recordSpaceAttachmentPayloadSchema,
  resolveSpaceAttachmentForDownloadPayloadSchema,
  SPACE_ATTACHMENT_ALLOWED_MIME_TYPES,
  SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE,
  SPACE_ATTACHMENT_MAX_DIMENSION,
  SPACE_ATTACHMENT_MAX_FILE_NAME_LENGTH,
  SPACE_ATTACHMENT_MAX_SIZE_BYTES,
  spaceAttachmentDescriptorSchema,
  spaceAttachmentUploadQuerySchema,
  uploadSpaceAttachmentResponseSchema,
} from "../../src";

const descriptorFixture = {
  id: "attachment-1",
  spaceId: "space-1",
  organizationId: "organization-1",
  mimeType: "image/png",
  sizeBytes: 1024,
  width: 800,
  height: 600,
  fileName: "photo.png",
  createdAt: "2026-07-11T08:00:00.000Z",
} as const;

describe("Space attachment schemas", () => {
  it("builds the shared private R2 object key", () => {
    expect(buildSpaceAttachmentObjectKey(descriptorFixture)).toBe(
      "org/organization-1/space/space-1/attachment-1"
    );
  });

  it("exports the MVP image attachment limits", () => {
    expect(SPACE_ATTACHMENT_ALLOWED_MIME_TYPES).toEqual([
      "image/jpeg",
      "image/png",
    ]);
    expect(SPACE_ATTACHMENT_MAX_SIZE_BYTES).toBe(5_242_880);
    expect(SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE).toBe(4);
    expect(SPACE_ATTACHMENT_MAX_DIMENSION).toBe(20_000);
    expect(SPACE_ATTACHMENT_MAX_FILE_NAME_LENGTH).toBe(255);
  });

  it("accepts a complete descriptor and preserves optional image metadata", () => {
    expect(spaceAttachmentDescriptorSchema.parse(descriptorFixture)).toEqual(
      descriptorFixture
    );
  });

  it("detects supported image signatures from attachment bytes", () => {
    expect(
      detectSpaceAttachmentMimeType(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      )
    ).toBe("image/png");
    expect(
      detectSpaceAttachmentMimeType(Uint8Array.from([0xff, 0xd8, 0xff]).buffer)
    ).toBe("image/jpeg");
    expect(detectSpaceAttachmentMimeType(Uint8Array.from([0x00]))).toBeNull();
  });

  it("projects canonical descriptors into strict message references", () => {
    expect(projectSpaceMessageAttachment(descriptorFixture)).toEqual({
      id: descriptorFixture.id,
      mimeType: descriptorFixture.mimeType,
      sizeBytes: descriptorFixture.sizeBytes,
      width: descriptorFixture.width,
      height: descriptorFixture.height,
      fileName: descriptorFixture.fileName,
    });
  });

  it("owns the Core attachment RPC payload shapes", () => {
    expect(
      recordSpaceAttachmentPayloadSchema.parse({
        spaceId: descriptorFixture.spaceId,
        mimeType: descriptorFixture.mimeType,
        sizeBytes: descriptorFixture.sizeBytes,
        width: descriptorFixture.width,
        height: descriptorFixture.height,
        fileName: "folder/photo.png",
      })
    ).toEqual({
      spaceId: descriptorFixture.spaceId,
      mimeType: descriptorFixture.mimeType,
      sizeBytes: descriptorFixture.sizeBytes,
      width: descriptorFixture.width,
      height: descriptorFixture.height,
      fileName: "photo.png",
    });
    expect(
      deleteSpaceAttachmentRecordInputSchema.parse({
        attachmentId: descriptorFixture.id,
      })
    ).toEqual({ attachmentId: descriptorFixture.id });
    expect(
      deleteSpaceAttachmentRecordResultSchema.parse({ deleted: true })
    ).toEqual({ deleted: true });
    expect(
      resolveSpaceAttachmentForDownloadPayloadSchema.parse({
        attachmentId: descriptorFixture.id,
        spaceId: descriptorFixture.spaceId,
      })
    ).toEqual({
      attachmentId: descriptorFixture.id,
      spaceId: descriptorFixture.spaceId,
    });
    expect(
      recordSpaceAttachmentPayloadSchema.safeParse({
        spaceId: descriptorFixture.spaceId,
        mimeType: descriptorFixture.mimeType,
        sizeBytes: descriptorFixture.sizeBytes,
        uploaderUserId: "caller-controlled",
      }).success
    ).toBe(false);
  });

  it("accepts a descriptor without optional client-declared metadata", () => {
    const {
      fileName: _fileName,
      height: _height,
      width: _width,
      ...required
    } = descriptorFixture;

    expect(spaceAttachmentDescriptorSchema.parse(required)).toEqual(required);
  });

  it("rejects unsupported MIME types, oversized files, and invalid dimensions", () => {
    expect(
      spaceAttachmentDescriptorSchema.safeParse({
        ...descriptorFixture,
        mimeType: "image/webp",
      }).success
    ).toBe(false);
    expect(
      spaceAttachmentDescriptorSchema.safeParse({
        ...descriptorFixture,
        sizeBytes: SPACE_ATTACHMENT_MAX_SIZE_BYTES + 1,
      }).success
    ).toBe(false);
    expect(
      spaceAttachmentDescriptorSchema.safeParse({
        ...descriptorFixture,
        width: 0,
      }).success
    ).toBe(false);
    expect(
      spaceAttachmentDescriptorSchema.safeParse({
        ...descriptorFixture,
        height: SPACE_ATTACHMENT_MAX_DIMENSION + 1,
      }).success
    ).toBe(false);
  });

  it("rejects unknown descriptor and upload response properties", () => {
    expect(
      spaceAttachmentDescriptorSchema.safeParse({
        ...descriptorFixture,
        publicUrl: "https://example.test/public/photo.png",
      }).success
    ).toBe(false);
    expect(
      uploadSpaceAttachmentResponseSchema.safeParse({
        attachment: descriptorFixture,
        publicUrl: "https://example.test/public/photo.png",
      }).success
    ).toBe(false);
  });

  it("stores only the basename for slash and backslash paths", () => {
    expect(
      spaceAttachmentDescriptorSchema.parse({
        ...descriptorFixture,
        fileName: "/Users/felix/Pictures/photo.png",
      }).fileName
    ).toBe("photo.png");
    expect(
      spaceAttachmentDescriptorSchema.parse({
        ...descriptorFixture,
        fileName: "C:\\fakepath\\photo.jpg",
      }).fileName
    ).toBe("photo.jpg");
  });

  it("rejects an empty basename and basenames longer than 255 characters", () => {
    expect(
      spaceAttachmentDescriptorSchema.safeParse({
        ...descriptorFixture,
        fileName: "/tmp/",
      }).success
    ).toBe(false);
    expect(
      spaceAttachmentDescriptorSchema.safeParse({
        ...descriptorFixture,
        fileName: `${"a".repeat(252)}.png`,
      }).success
    ).toBe(false);
  });

  it("parses optional client-declared upload metadata from query strings", () => {
    expect(
      spaceAttachmentUploadQuerySchema.parse({
        fileName: "C:\\fakepath\\photo.png",
        width: "800",
        height: "600",
      })
    ).toEqual({
      fileName: "photo.png",
      width: 800,
      height: 600,
    });
    expect(spaceAttachmentUploadQuerySchema.parse({})).toEqual({});
    expect(
      spaceAttachmentUploadQuerySchema.safeParse({ width: "800.5" }).success
    ).toBe(false);
    expect(
      spaceAttachmentUploadQuerySchema.safeParse({
        height: String(SPACE_ATTACHMENT_MAX_DIMENSION + 1),
      }).success
    ).toBe(false);
  });

  it("exports the attachment error codes without minting a duplicate member code", () => {
    for (const code of [
      "attachment_too_large",
      "attachment_type_unsupported",
      "attachment_content_mismatch",
      "attachment_not_found",
      "attachment_storage_failed",
      "space.forbidden",
    ]) {
      expect(gatewayErrorCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(gatewayErrorCodeSchema.safeParse("not_space_member").success).toBe(
      false
    );
  });
});
