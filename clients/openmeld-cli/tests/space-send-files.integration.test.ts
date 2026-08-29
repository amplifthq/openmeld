import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  gatewayErrorEnvelopeSchema,
  SPACE_FILE_MAX_SIZE_BYTES,
  SPACE_MESSAGE_FILE_MAX_COUNT,
  trashSpaceFileEntryResponseSchema,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSend } from "../src/space/send";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const PROFILE = createTestOpenMeldProfile({
  openMeldProfileId: "11111111-1111-4111-8111-111111111111",
  profileName: "Mira",
  profileKind: "human",
});
const CREATED_AT = "2026-07-20T00:00:00.000Z";
const THREAD_ID = "thr_11111111-1111-4111-8111-111111111111";
const ROOT_SIGNAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createFileDescriptor(input: {
  fileId?: string;
  mimeType: string;
  name: string;
  sizeBytes: number;
}) {
  const fileId = input.fileId ?? "file-1";
  const actor = {
    profileId: PROFILE.openMeldProfileId,
    profileKind: "human" as const,
    displayName: PROFILE.profileName,
  };
  return {
    id: fileId,
    spaceId: "demo",
    parentId: null,
    name: input.name,
    path: `/${input.name}`,
    kind: "file" as const,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    createdBy: actor,
    updatedBy: actor,
    latestRevision: {
      id: `${fileId}-revision-1`,
      fileId,
      revision: 1,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      createdAt: CREATED_AT,
      createdBy: actor,
    },
  };
}

function createSignalEnvelope(files: unknown[]) {
  return {
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
    data: { text: "Deployment evidence", files },
  };
}

function createSignalResponse(files: unknown[]) {
  return new Response(JSON.stringify(createSignalEnvelope(files)), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("space send files", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    "human",
    "agent",
  ] as const)("adds a general file to Space Files before sending its canonical revision in %s view", async (view) => {
    await withTempHome(async (home) => {
      const filePath = join(home, "launch-brief.pdf");
      const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
      await writeFile(filePath, bytes);
      const file = createFileDescriptor({
        mimeType: "application/pdf",
        name: "launch-brief.pdf",
        sizeBytes: bytes.byteLength,
      });
      const reference = {
        fileId: file.id,
        revision: 1,
        name: file.name,
        mimeType: file.latestRevision.mimeType,
        sizeBytes: file.latestRevision.sizeBytes,
      };
      const fetchMock = vi.fn((request: string | URL, init?: RequestInit) => {
        const url = new URL(String(request));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (method === "POST" && url.pathname.endsWith("/files")) {
          expect(url.searchParams.get("name")).toBe("launch-brief.pdf");
          expect(new Headers(init?.headers).get("content-type")).toBe(
            "application/pdf"
          );
          return new Response(JSON.stringify({ file }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        if (method === "POST" && url.pathname.endsWith("/signals")) {
          const body = JSON.parse(String(init?.body)) as { files?: unknown[] };
          expect(body.files).toEqual([reference]);
          expect(body).not.toHaveProperty("attachments");
          return createSignalResponse([reference]);
        }
        throw new Error(`unexpected request: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSend({
          openMeldProfile: PROFILE,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          filePaths: [filePath],
          plainText: true,
          text: "Deployment evidence",
          view,
        });
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(plainStdout).toContain("1 file");
      if (view === "agent") {
        const lines = plainStdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(lines).toContainEqual(
          expect.objectContaining({
            type: "line",
            code: "send.files_sent",
            data: { fileCount: 1, signalId: "sig-1" },
          })
        );
      }
    });
  });

  it("sends a file without requiring filler message text", async () => {
    await withTempHome(async (home) => {
      const filePath = join(home, "launch-brief.pdf");
      const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
      await writeFile(filePath, bytes);
      const file = createFileDescriptor({
        mimeType: "application/pdf",
        name: "launch-brief.pdf",
        sizeBytes: bytes.byteLength,
      });
      const fetchMock = vi.fn((request: string | URL, init?: RequestInit) => {
        const url = new URL(String(request));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (method === "POST" && url.pathname.endsWith("/files")) {
          return new Response(JSON.stringify({ file }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        if (method === "POST" && url.pathname.endsWith("/signals")) {
          const body = JSON.parse(String(init?.body)) as {
            files?: unknown[];
            text?: string;
          };
          expect(body.text).toBe("");
          expect(body.files).toHaveLength(1);
          return createSignalResponse(body.files ?? []);
        }
        throw new Error(`unexpected request: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await runSend({
        openMeldProfile: PROFILE,
        baseUrl: "https://gateway.openmeld.invalid",
        space: "demo",
        filePaths: [filePath],
        plainText: true,
        text: "",
        view: "human",
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("supports files in Space thread replies", async () => {
    await withTempHome(async (home) => {
      const filePath = join(home, "notes.txt");
      const bytes = new TextEncoder().encode("Shared notes");
      await writeFile(filePath, bytes);
      const file = createFileDescriptor({
        mimeType: "text/plain",
        name: "notes.txt",
        sizeBytes: bytes.byteLength,
      });
      const reference = {
        fileId: file.id,
        revision: 1,
        name: file.name,
        mimeType: file.latestRevision.mimeType,
        sizeBytes: file.latestRevision.sizeBytes,
      };
      const fetchMock = vi.fn((request: string | URL, init?: RequestInit) => {
        const url = new URL(String(request));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (method === "POST" && url.pathname.endsWith("/files")) {
          return new Response(JSON.stringify({ file }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        if (method === "GET" && url.pathname.endsWith("/threads")) {
          return new Response(
            JSON.stringify({
              threads: [
                {
                  threadId: THREAD_ID,
                  spaceId: "demo",
                  rootSignalId: ROOT_SIGNAL_ID,
                  createdByProfileId: PROFILE.openMeldProfileId,
                  createdAt: CREATED_AT,
                  updatedAt: CREATED_AT,
                },
              ],
              previews: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (method === "POST" && url.pathname.endsWith("/signals")) {
          const body = JSON.parse(String(init?.body)) as { files?: unknown[] };
          expect(body.files).toEqual([reference]);
          return new Response(
            JSON.stringify({
              signal: createSignalEnvelope([reference]),
              placement: {
                threadId: THREAD_ID,
                signalId: "sig-1",
                placement: "thread",
                createdAt: CREATED_AT,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        throw new Error(`unexpected request: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await runSend({
        openMeldProfile: PROFILE,
        baseUrl: "https://gateway.openmeld.invalid",
        space: "demo",
        filePaths: [filePath],
        plainText: true,
        replyToSignalId: ROOT_SIGNAL_ID,
        text: "Deployment evidence",
        view: "agent",
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  it("does not send a message when adding a file to the Space fails", async () => {
    await withTempHome(async (home) => {
      const filePath = join(home, "evidence.png");
      await writeFile(filePath, Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
      const fetchMock = vi.fn(
        () =>
          new Response(
            JSON.stringify(
              gatewayErrorEnvelopeSchema.parse({
                ok: false,
                error: {
                  code: "space_file.storage_failed",
                  message: "The file could not be stored.",
                  requestId: "req-upload-1",
                },
              })
            ),
            {
              status: 500,
              headers: {
                "content-type": "application/json",
                "x-openmeld-request-id": "req-upload-1",
              },
            }
          )
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runSend({
          openMeldProfile: PROFILE,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          filePaths: [filePath],
          plainText: true,
          text: "Deployment evidence",
          view: "agent",
        })
      ).rejects.toMatchObject({
        code: "space_file.storage_failed",
        requestId: "req-upload-1",
        status: 500,
        message: expect.stringContaining("The message was not sent"),
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("moves files uploaded by this send to Trash when a later upload fails", async () => {
    await withTempHome(async (home) => {
      const firstPath = join(home, "first.txt");
      const secondPath = join(home, "second.txt");
      await writeFile(firstPath, "First file");
      await writeFile(secondPath, "Second file");
      const firstFile = createFileDescriptor({
        fileId: "file-first",
        mimeType: "text/plain",
        name: "first.txt",
        sizeBytes: 10,
      });
      const trashedEntryIds: string[] = [];
      const fetchMock = vi.fn((request: string | URL, init?: RequestInit) => {
        const url = new URL(String(request));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (
          method === "POST" &&
          url.pathname.endsWith("/files") &&
          url.searchParams.get("name") === "first.txt"
        ) {
          return new Response(JSON.stringify({ file: firstFile }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        if (
          method === "POST" &&
          url.pathname.endsWith("/files") &&
          url.searchParams.get("name") === "second.txt"
        ) {
          return new Response(
            JSON.stringify(
              gatewayErrorEnvelopeSchema.parse({
                ok: false,
                error: {
                  code: "upstream_unreachable",
                  message:
                    "Space File audit event content_write:request-1 conflicts with an existing event.",
                  requestId: "request-1",
                },
              })
            ),
            {
              status: 502,
              headers: {
                "content-type": "application/json",
                "x-openmeld-request-id": "request-1",
              },
            }
          );
        }
        if (
          method === "DELETE" &&
          url.pathname.endsWith(`/files/${firstFile.id}`)
        ) {
          const body = JSON.parse(String(init?.body)) as {
            clientMutationId?: unknown;
          };
          expect(body.clientMutationId).toEqual(expect.any(String));
          trashedEntryIds.push(firstFile.id);
          return new Response(
            JSON.stringify(
              trashSpaceFileEntryResponseSchema.parse({
                entryId: firstFile.id,
                trashedAt: CREATED_AT,
              })
            ),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        throw new Error(`unexpected request: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runSend({
          openMeldProfile: PROFILE,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          filePaths: [firstPath, secondPath],
          plainText: true,
          text: "Deployment evidence",
          view: "agent",
        })
      ).rejects.toMatchObject({
        code: "upstream_unreachable",
        requestId: "request-1",
        status: 502,
      });
      expect(trashedEntryIds).toEqual([firstFile.id]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  it("preserves exact recovery guidance when partial-upload cleanup fails", async () => {
    await withTempHome(async (home) => {
      const firstPath = join(home, "first.txt");
      const secondPath = join(home, "second.txt");
      await writeFile(firstPath, "First file");
      await writeFile(secondPath, "Second file");
      const firstFile = createFileDescriptor({
        fileId: "file-cleanup-failed",
        mimeType: "text/plain",
        name: "first.txt",
        sizeBytes: 10,
      });
      const fetchMock = vi.fn((request: string | URL, init?: RequestInit) => {
        const url = new URL(String(request));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (
          method === "POST" &&
          url.pathname.endsWith("/files") &&
          url.searchParams.get("name") === "first.txt"
        ) {
          return new Response(JSON.stringify({ file: firstFile }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        const isSecondUpload =
          method === "POST" &&
          url.pathname.endsWith("/files") &&
          url.searchParams.get("name") === "second.txt";
        const isCleanup =
          method === "DELETE" &&
          url.pathname.endsWith(`/files/${firstFile.id}`);
        if (isSecondUpload || isCleanup) {
          const requestId = isCleanup
            ? "request-cleanup-1"
            : "request-upload-2";
          return new Response(
            JSON.stringify(
              gatewayErrorEnvelopeSchema.parse({
                ok: false,
                error: {
                  code: "upstream_unreachable",
                  message: isCleanup
                    ? "The file could not be moved to Trash."
                    : "The second file could not be added.",
                  requestId,
                },
              })
            ),
            {
              status: 502,
              headers: {
                "content-type": "application/json",
                "x-openmeld-request-id": requestId,
              },
            }
          );
        }
        throw new Error(`unexpected request: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      let caught: unknown;
      try {
        await runSend({
          openMeldProfile: PROFILE,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          filePaths: [firstPath, secondPath],
          plainText: true,
          text: "Deployment evidence",
          view: "agent",
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        code: "upstream_unreachable",
        requestId: "request-upload-2",
      });
      expect((caught as Error).message).toContain("request-cleanup-1");
      expect((caught as Error).message).toContain(
        `openmeld space files trash demo ${firstFile.id}`
      );
    });
  });

  it("retries a partial multi-file send without keeping or reusing the first attempt", async () => {
    await withTempHome(async (home) => {
      const firstPath = join(home, "first.txt");
      const secondPath = join(home, "second.txt");
      await writeFile(firstPath, "First file");
      await writeFile(secondPath, "Second file");
      const firstAttemptFile = createFileDescriptor({
        fileId: "file-first-attempt",
        mimeType: "text/plain",
        name: "first.txt",
        sizeBytes: 10,
      });
      const retryFiles = [
        createFileDescriptor({
          fileId: "file-retry-first",
          mimeType: "text/plain",
          name: "first.txt",
          sizeBytes: 10,
        }),
        createFileDescriptor({
          fileId: "file-retry-second",
          mimeType: "text/plain",
          name: "second.txt",
          sizeBytes: 11,
        }),
      ] as const;
      const uploadCounts = new Map<string, number>();
      const uploadMutationIds: string[] = [];
      const trashedEntryIds: string[] = [];
      let sentFileIds: string[] = [];
      const fetchMock = vi.fn((request: string | URL, init?: RequestInit) => {
        const url = new URL(String(request));
        const method = String(init?.method ?? "GET").toUpperCase();
        const name = url.searchParams.get("name");
        if (method === "POST" && url.pathname.endsWith("/files") && name) {
          uploadMutationIds.push(
            String(url.searchParams.get("clientMutationId"))
          );
          const count = (uploadCounts.get(name) ?? 0) + 1;
          uploadCounts.set(name, count);
          if (name === "first.txt") {
            const file = count === 1 ? firstAttemptFile : retryFiles[0];
            return new Response(JSON.stringify({ file }), {
              status: 201,
              headers: { "content-type": "application/json" },
            });
          }
          if (name === "second.txt" && count === 1) {
            return new Response(
              JSON.stringify(
                gatewayErrorEnvelopeSchema.parse({
                  ok: false,
                  error: {
                    code: "upstream_unreachable",
                    message: "The second file could not be added.",
                    requestId: "request-first-attempt",
                  },
                })
              ),
              {
                status: 502,
                headers: { "content-type": "application/json" },
              }
            );
          }
          if (name === "second.txt") {
            return new Response(JSON.stringify({ file: retryFiles[1] }), {
              status: 201,
              headers: { "content-type": "application/json" },
            });
          }
        }
        if (
          method === "DELETE" &&
          url.pathname.endsWith(`/files/${firstAttemptFile.id}`)
        ) {
          trashedEntryIds.push(firstAttemptFile.id);
          return new Response(
            JSON.stringify(
              trashSpaceFileEntryResponseSchema.parse({
                entryId: firstAttemptFile.id,
                trashedAt: CREATED_AT,
              })
            ),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (method === "POST" && url.pathname.endsWith("/signals")) {
          const body = JSON.parse(String(init?.body)) as {
            files?: Array<{ fileId: string }>;
          };
          sentFileIds = (body.files ?? []).map((file) => file.fileId);
          return createSignalResponse(body.files ?? []);
        }
        throw new Error(`unexpected request: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const input = {
        openMeldProfile: PROFILE,
        baseUrl: "https://gateway.openmeld.invalid",
        space: "demo",
        filePaths: [firstPath, secondPath],
        plainText: true,
        text: "Deployment evidence",
        view: "agent" as const,
      };
      await expect(runSend(input)).rejects.toMatchObject({
        requestId: "request-first-attempt",
      });
      await runSend(input);

      expect(trashedEntryIds).toEqual([firstAttemptFile.id]);
      expect(sentFileIds).toEqual(retryFiles.map((file) => file.id));
      expect(new Set(uploadMutationIds).size).toBe(uploadMutationIds.length);
      expect(sentFileIds).not.toContain(firstAttemptFile.id);
    });
  });

  it("accepts arbitrary file types instead of limiting messages to images", async () => {
    await withTempHome(async (home) => {
      const filePath = join(home, "archive.custom");
      await writeFile(filePath, Uint8Array.from([1, 2, 3]));
      const fetchMock = vi.fn((request: string | URL, init?: RequestInit) => {
        const url = new URL(String(request));
        const method = String(init?.method ?? "GET").toUpperCase();
        const file = createFileDescriptor({
          mimeType: "application/octet-stream",
          name: "archive.custom",
          sizeBytes: 3,
        });
        if (method === "POST" && url.pathname.endsWith("/files")) {
          expect(new Headers(init?.headers).get("content-type")).toBe(
            "application/octet-stream"
          );
          return new Response(JSON.stringify({ file }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        if (method === "POST" && url.pathname.endsWith("/signals")) {
          return createSignalResponse([
            {
              fileId: file.id,
              revision: 1,
              name: file.name,
              mimeType: file.latestRevision.mimeType,
              sizeBytes: 3,
            },
          ]);
        }
        throw new Error(`unexpected request: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await runSend({
        openMeldProfile: PROFILE,
        baseUrl: "https://gateway.openmeld.invalid",
        space: "demo",
        filePaths: [filePath],
        plainText: true,
        text: "Archive",
        view: "agent",
      });
    });
  });

  it("rejects missing, oversized, and excessive files before any request", async () => {
    await withTempHome(async (home) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        runSend({
          openMeldProfile: PROFILE,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          filePaths: [join(home, "missing.pdf")],
          plainText: true,
          text: "Missing",
          view: "agent",
        })
      ).rejects.toMatchObject({ code: "space.file.file_not_found" });

      const oversizedPath = join(home, "oversized.bin");
      await writeFile(
        oversizedPath,
        Buffer.alloc(SPACE_FILE_MAX_SIZE_BYTES + 1)
      );
      await expect(
        runSend({
          openMeldProfile: PROFILE,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          filePaths: [oversizedPath],
          plainText: true,
          text: "Oversized",
          view: "agent",
        })
      ).rejects.toMatchObject({ code: "space.file.too_large" });

      await expect(
        runSend({
          openMeldProfile: PROFILE,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          filePaths: Array.from(
            { length: SPACE_MESSAGE_FILE_MAX_COUNT + 1 },
            (_, index) => `/missing/file-${index}.pdf`
          ),
          plainText: true,
          text: "Too many",
          view: "agent",
        })
      ).rejects.toMatchObject({ code: "space.file.too_many" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
