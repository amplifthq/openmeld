import type { SpaceFileDescriptor } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  createOpenMeldApiClient,
  createSpaceApi,
  type OpenMeldApiClientTransport,
} from "../src";

const UPLOAD_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR = {
  displayName: "Mira",
  ownerUserId: "owner-1",
  profileId: "profile-1",
  profileKind: "human" as const,
};
const FILE: SpaceFileDescriptor = {
  createdAt: "2026-08-29T08:00:00.000Z",
  createdBy: ACTOR,
  id: "file-1",
  kind: "file",
  latestRevision: {
    createdAt: "2026-08-29T08:00:00.000Z",
    createdBy: ACTOR,
    fileId: "file-1",
    id: "revision-1",
    mimeType: "text/plain",
    revision: 1,
    sizeBytes: 5,
  },
  name: "notes.txt",
  parentId: null,
  path: "/notes.txt",
  spaceId: "space-1",
  trashedAt: null,
  trashedBy: null,
  updatedAt: "2026-08-29T08:00:00.000Z",
  updatedBy: ACTOR,
};

describe("Space Composer uploads API", () => {
  it("stages, publishes, and discards one upload through separate operations", async () => {
    const transport = vi.fn(
      (input: Parameters<OpenMeldApiClientTransport>[0]) => {
        let response: Response;
        if (input.operation === "space.composer_uploads.stage") {
          response = Response.json({
            upload: {
              expiresAt: "2026-08-30T08:00:00.000Z",
              id: UPLOAD_ID,
              mimeType: "text/plain",
              name: "notes.txt",
              sizeBytes: 5,
            },
          });
        } else if (input.operation === "space.composer_uploads.publish") {
          response = Response.json({ file: FILE });
        } else {
          response = Response.json({ discarded: true, uploadId: UPLOAD_ID });
        }
        return Promise.resolve(response);
      }
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.stageComposerUpload({
        bytes: new Blob(["notes"]),
        mimeType: "text/plain",
        name: "notes.txt",
        spaceId: "space-1",
        uploadId: UPLOAD_ID,
      })
    ).resolves.toMatchObject({ id: UPLOAD_ID, name: "notes.txt" });
    await expect(
      api.publishComposerUpload({
        clientMutationId: "publish-upload-1",
        spaceId: "space-1",
        uploadId: UPLOAD_ID,
      })
    ).resolves.toEqual(FILE);
    await expect(
      api.discardComposerUpload({
        spaceId: "space-1",
        uploadId: UPLOAD_ID,
      })
    ).resolves.toBeUndefined();

    expect(transport.mock.calls.map(([request]) => request.operation)).toEqual([
      "space.composer_uploads.stage",
      "space.composer_uploads.publish",
      "space.composer_uploads.discard",
    ]);
    expect(transport.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        init: expect.objectContaining({ method: "PUT" }),
        url: `https://gateway.openmeld.invalid/v1/spaces/space-1/composer-uploads/${UPLOAD_ID}?name=notes.txt`,
      })
    );
    expect(transport.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({ clientMutationId: "publish-upload-1" }),
          method: "POST",
        }),
        url: `https://gateway.openmeld.invalid/v1/spaces/space-1/composer-uploads/${UPLOAD_ID}/publish`,
      })
    );
    expect(transport.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        init: expect.objectContaining({ method: "DELETE" }),
        url: `https://gateway.openmeld.invalid/v1/spaces/space-1/composer-uploads/${UPLOAD_ID}`,
      })
    );
  });
});
