import {
  SPACE_ATTACHMENT_MAX_SIZE_BYTES,
  type SpaceAttachmentDescriptor,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  buildSpaceAttachmentDownloadPath,
  createOpenMeldApiClient,
  createSpaceApi,
  type OpenMeldApiClientTransport,
  uploadSpaceAttachment,
} from "../src";

const DESCRIPTOR: SpaceAttachmentDescriptor = {
  id: "attachment-1",
  spaceId: "space-1",
  organizationId: "organization-1",
  mimeType: "image/jpeg",
  sizeBytes: 4,
  width: 640,
  height: 480,
  fileName: "photo.jpg",
  createdAt: "2026-07-11T08:00:00.000Z",
};

describe("Space attachment API", () => {
  it("uploads validated raw bytes and returns the shared descriptor", async () => {
    const transport = vi.fn(
      async (_input: Parameters<OpenMeldApiClientTransport>[0]) =>
        Response.json({ attachment: DESCRIPTOR })
    );
    const client = createOpenMeldApiClient({
      baseUrl: "https://gateway.openmeld.invalid",
      transport,
    });
    const sourceBytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);

    await expect(
      uploadSpaceAttachment(client, {
        spaceId: "space-1",
        bytes: sourceBytes,
        mimeType: "image/jpeg",
        fileName: "C:\\fakepath\\photo.jpg",
        width: 640,
        height: 480,
      })
    ).resolves.toEqual(DESCRIPTOR);

    expect(transport).toHaveBeenCalledTimes(1);
    const request = transport.mock.calls[0]?.[0];
    expect(request).toEqual(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-1/attachments?fileName=photo.jpg&width=640&height=480",
        operation: "space.attachment.upload",
        init: expect.objectContaining({
          method: "POST",
          headers: { "content-type": "image/jpeg" },
          body: expect.any(ArrayBuffer),
        }),
      })
    );
    const requestBody = request?.init?.body;
    expect(requestBody).toBeInstanceOf(ArrayBuffer);
    if (!(requestBody instanceof ArrayBuffer)) {
      throw new Error("expected upload request body to be an ArrayBuffer");
    }
    expect(Array.from(new Uint8Array(requestBody))).toEqual(
      Array.from(sourceBytes)
    );
  });

  it("accepts a Blob through the Space API factory", async () => {
    const transport = vi.fn(
      async (_input: Parameters<OpenMeldApiClientTransport>[0]) =>
        Response.json({
          attachment: {
            ...DESCRIPTOR,
            mimeType: "image/png",
            fileName: undefined,
          },
        })
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );
    const blob = new Blob([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ]);

    await api.uploadAttachment({
      spaceId: "space-1",
      bytes: blob,
      mimeType: "image/png",
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-1/attachments",
        init: expect.objectContaining({ body: blob }),
      })
    );
  });

  it("rejects invalid metadata and size before transport", async () => {
    const transport = vi.fn(
      async (_input: Parameters<OpenMeldApiClientTransport>[0]) =>
        Response.json({ attachment: DESCRIPTOR })
    );
    const client = createOpenMeldApiClient({
      baseUrl: "https://gateway.openmeld.invalid",
      transport,
    });

    await expect(
      uploadSpaceAttachment(client, {
        spaceId: "space-1",
        bytes: new Uint8Array([1]),
        mimeType: "image/jpeg",
        width: 20_001,
      })
    ).rejects.toThrow("invalid Space attachment upload metadata");
    await expect(
      uploadSpaceAttachment(client, {
        spaceId: "space-1",
        bytes: new Uint8Array(SPACE_ATTACHMENT_MAX_SIZE_BYTES + 1),
        mimeType: "image/jpeg",
      })
    ).rejects.toThrow("invalid Space attachment size");
    expect(transport).not.toHaveBeenCalled();
  });

  it("builds a private authenticated download path", () => {
    expect(buildSpaceAttachmentDownloadPath("space /1", "attachment/1")).toBe(
      "/v1/spaces/space%20%2F1/attachments/attachment%2F1"
    );
  });
});
