import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  gatewayErrorEnvelopeSchema,
  SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE,
  SPACE_ATTACHMENT_MAX_SIZE_BYTES,
  uploadSpaceAttachmentResponseSchema,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSend } from "../src/space/send";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
const PROFILE = createTestOpenMeldProfile({
  openMeldProfileId: "11111111-1111-4111-8111-111111111111",
  profileName: "Mira",
  profileKind: "human",
});

// These schema-validated success shapes mirror the dev-lane Gateway capture.
// IDs are deterministic here so the behavior assertions remain stable.
function createAttachmentDescriptor(fileName = "evidence.png") {
  return {
    id: "att_11111111-1111-4111-8111-111111111111",
    spaceId: "demo",
    organizationId: "org-1",
    mimeType: "image/png",
    sizeBytes: PNG_BYTES.byteLength,
    fileName,
    createdAt: "2026-07-20T00:00:00.000Z",
  } as const;
}

function createPostSignalResponse(
  attachments: Array<{
    fileName: string;
    id: string;
    mimeType: "image/jpeg" | "image/png";
    sizeBytes: number;
  }> = [
    {
      id: "att_11111111-1111-4111-8111-111111111111",
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.byteLength,
      fileName: "evidence.png",
    },
  ]
) {
  return new Response(
    JSON.stringify({
      v: 1,
      id: "sig-1",
      spaceId: "demo",
      ts: 1,
      profile: {
        kind: "human",
        profileId: PROFILE.openMeldProfileId,
        profileName: PROFILE.profileName,
      },
      type: "signal.text",
      data: {
        text: "Deployment evidence",
        attachments,
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

describe("space send attachments", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    "human",
    "agent",
  ] as const)("uploads every attachment before sending and reports the signal in %s view", async (view) => {
    await withTempHome(async (home) => {
      const attachmentPath = join(home, "evidence.png");
      await writeFile(attachmentPath, PNG_BYTES);

      const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (method === "POST" && url.pathname.endsWith("/attachments")) {
          expect(url.searchParams.get("fileName")).toBe("evidence.png");
          expect(new Headers(init?.headers).get("content-type")).toBe(
            "image/png"
          );
          expect(init?.body).toBeInstanceOf(ArrayBuffer);
          return new Response(
            JSON.stringify(
              uploadSpaceAttachmentResponseSchema.parse({
                attachment: createAttachmentDescriptor(),
              })
            ),
            {
              status: 201,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (method === "POST" && url.pathname.endsWith("/signals")) {
          const body = JSON.parse(String(init?.body)) as {
            attachments?: unknown[];
          };
          expect(body.attachments).toEqual([
            {
              id: "att_11111111-1111-4111-8111-111111111111",
              mimeType: "image/png",
              sizeBytes: PNG_BYTES.byteLength,
              fileName: "evidence.png",
            },
          ]);
          return createPostSignalResponse();
        }
        throw new Error(`unexpected request: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSend({
          openMeldProfile: PROFILE,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          attachmentPaths: [attachmentPath],
          plainText: true,
          text: "Deployment evidence",
          view,
        });
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(plainStdout).toContain("sig-1");
      expect(plainStdout).toContain("1 attachment");
      if (view === "agent") {
        const lines = plainStdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(lines).toContainEqual(
          expect.objectContaining({
            type: "line",
            code: "send.attachments_sent",
            data: {
              attachmentCount: 1,
              signalId: "sig-1",
            },
          })
        );
      }
    });
  });

  it("does not send a message when an attachment upload fails", async () => {
    await withTempHome(async (home) => {
      const attachmentPath = join(home, "evidence.png");
      await writeFile(attachmentPath, PNG_BYTES);
      const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (method === "POST" && url.pathname.endsWith("/attachments")) {
          const failure = gatewayErrorEnvelopeSchema.parse({
            ok: false,
            error: {
              code: "attachment_storage_failed",
              message: "The attachment could not be stored.",
              requestId: "req-upload-1",
            },
          });
          return new Response(JSON.stringify(failure), {
            status: 500,
            headers: {
              "content-type": "application/json",
              "x-openmeld-request-id": "req-upload-1",
            },
          });
        }
        throw new Error("message must not be sent after upload failure");
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runSend({
          openMeldProfile: PROFILE,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          attachmentPaths: [attachmentPath],
          plainText: true,
          text: "Deployment evidence",
          view: "agent",
        })
      ).rejects.toMatchObject({
        code: "attachment_storage_failed",
        requestId: "req-upload-1",
        status: 500,
        message: expect.stringContaining("The Space message was not sent"),
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("uploads repeated attachment paths and sends all returned descriptors together", async () => {
    await withTempHome(async (home) => {
      const pngPath = join(home, "evidence.png");
      const jpegPath = join(home, "diagram.jpg");
      await writeFile(pngPath, PNG_BYTES);
      await writeFile(jpegPath, JPEG_BYTES);
      const uploadedFileNames: string[] = [];
      const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (method === "POST" && url.pathname.endsWith("/attachments")) {
          const fileName = String(url.searchParams.get("fileName"));
          uploadedFileNames.push(fileName);
          const isJpeg = fileName === "diagram.jpg";
          return new Response(
            JSON.stringify({
              attachment: {
                id: isJpeg ? "att-jpeg" : "att-png",
                spaceId: "demo",
                organizationId: "org-1",
                mimeType: isJpeg ? "image/jpeg" : "image/png",
                sizeBytes: isJpeg
                  ? JPEG_BYTES.byteLength
                  : PNG_BYTES.byteLength,
                fileName,
                createdAt: "2026-07-20T00:00:00.000Z",
              },
            }),
            {
              status: 201,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (method === "POST" && url.pathname.endsWith("/signals")) {
          const body = JSON.parse(String(init?.body)) as {
            attachments?: Array<{ id: string }>;
          };
          expect(body.attachments?.map((attachment) => attachment.id)).toEqual([
            "att-png",
            "att-jpeg",
          ]);
          return createPostSignalResponse([
            {
              id: "att-png",
              mimeType: "image/png",
              sizeBytes: PNG_BYTES.byteLength,
              fileName: "evidence.png",
            },
            {
              id: "att-jpeg",
              mimeType: "image/jpeg",
              sizeBytes: JPEG_BYTES.byteLength,
              fileName: "diagram.jpg",
            },
          ]);
        }
        throw new Error(`unexpected request: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSend({
          openMeldProfile: PROFILE,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          attachmentPaths: [pngPath, jpegPath],
          plainText: true,
          text: "Deployment evidence",
          view: "agent",
        });
      });

      expect(uploadedFileNames).toEqual(["evidence.png", "diagram.jpg"]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(plainStdout).toContain("2 attachments");
    });
  });

  it("rejects a missing file before making any request", async () => {
    await withTempHome(async (home) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runSend({
          openMeldProfile: PROFILE,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          attachmentPaths: [join(home, "missing.png")],
          plainText: true,
          text: "Deployment evidence",
          view: "agent",
        })
      ).rejects.toMatchObject({
        code: "space.attachment.file_not_found",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("rejects an oversized file before making any request", async () => {
    await withTempHome(async (home) => {
      const attachmentPath = join(home, "oversized.png");
      await writeFile(
        attachmentPath,
        Buffer.alloc(SPACE_ATTACHMENT_MAX_SIZE_BYTES + 1, 0)
      );
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runSend({
          openMeldProfile: PROFILE,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          attachmentPaths: [attachmentPath],
          plainText: true,
          text: "Deployment evidence",
          view: "agent",
        })
      ).rejects.toMatchObject({
        code: "space.attachment.too_large",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("rejects unsupported file bytes before making any request", async () => {
    await withTempHome(async (home) => {
      const attachmentPath = join(home, "evidence.gif");
      await writeFile(attachmentPath, Uint8Array.from([0x47, 0x49, 0x46]));
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runSend({
          openMeldProfile: PROFILE,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          attachmentPaths: [attachmentPath],
          plainText: true,
          text: "Deployment evidence",
          view: "agent",
        })
      ).rejects.toMatchObject({
        code: "space.attachment.unsupported_type",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("rejects more paths than the shared message limit before reading files", async () => {
    const attachmentPaths = Array.from(
      { length: SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE + 1 },
      (_, index) => `/missing/evidence-${index}.png`
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runSend({
        openMeldProfile: PROFILE,
        baseUrl: "https://gateway.openmeld.invalid",
        space: "demo",
        attachmentPaths,
        plainText: true,
        text: "Deployment evidence",
        view: "agent",
      })
    ).rejects.toMatchObject({
      code: "space.attachment.too_many",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when attachments are combined with a thread reply", async () => {
    await withTempHome(async (home) => {
      const attachmentPath = join(home, "evidence.png");
      await writeFile(attachmentPath, PNG_BYTES);
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runSend({
          openMeldProfile: PROFILE,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          attachmentPaths: [attachmentPath],
          plainText: true,
          replyToSignalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          text: "Deployment evidence",
          view: "agent",
        })
      ).rejects.toMatchObject({
        code: "space.attachment.thread_reply_not_supported",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
