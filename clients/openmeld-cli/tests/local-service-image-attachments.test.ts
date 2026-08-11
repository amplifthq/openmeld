import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { materializeDispatchImageAttachments } from "../src/local-service/dispatch/dispatch-image-attachments";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "openmeld-image-wake-"));
  workspaces.push(workspace);
  return workspace;
}

describe("local service image attachments", () => {
  it.each([
    "builtin:claude-code",
    "builtin:codex",
    "builtin:opencode",
  ])("materializes an image and assembles the %s prompt", async (agentControllerRef) => {
    const workspace = await createWorkspace();
    const downloadAttachment = vi.fn(
      async () =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "content-type": "image/png" },
        })
    );

    const result = await materializeDispatchImageAttachments({
      agentControllerRef,
      attachments: [
        {
          id: "attachment-1",
          mimeType: "image/png",
          sizeBytes: 4,
          fileName: "diagram.png",
        },
      ],
      downloadAttachment,
      providerRuntimeWorkingDirectory: workspace,
      spaceId: "space-1",
      taskId: "task-1",
    });

    const localPath = join(
      workspace,
      ".openmeld",
      "attachments",
      "task-1",
      "attachment-1.png"
    );
    expect(new Uint8Array(await readFile(localPath))).toEqual(
      new Uint8Array([137, 80, 78, 71])
    );
    expect(downloadAttachment).toHaveBeenCalledWith({
      attachmentId: "attachment-1",
      spaceId: "space-1",
    });
    expect(result.promptSection).toBe(
      [
        "Attached images (local files):",
        `- \`${localPath}\` — Space attachment "diagram.png" (image/png).`,
      ].join("\n")
    );
    expect(result.failures).toEqual([]);
  });

  it("materializes multiple images and preserves valid file extensions", async () => {
    const workspace = await createWorkspace();
    const responses = [
      new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
      new Response(new Uint8Array([255, 216, 255]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    ];

    const result = await materializeDispatchImageAttachments({
      agentControllerRef: "builtin:codex",
      attachments: [
        {
          id: "attachment-1",
          mimeType: "image/png",
          sizeBytes: 4,
          fileName: "diagram.png",
        },
        {
          id: "attachment-2",
          mimeType: "image/jpeg",
          sizeBytes: 3,
          fileName: "photo.jpeg",
        },
      ],
      downloadAttachment: vi.fn(async () => responses.shift() as Response),
      providerRuntimeWorkingDirectory: workspace,
      spaceId: "space-1",
      taskId: "task-1",
    });

    expect(result.localPaths).toEqual([
      join(workspace, ".openmeld", "attachments", "task-1", "attachment-1.png"),
      join(
        workspace,
        ".openmeld",
        "attachments",
        "task-1",
        "attachment-2.jpeg"
      ),
    ]);
    expect(result.promptSection).toContain("attachment-1.png");
    expect(result.promptSection).toContain("attachment-2.jpeg");
    expect(result.failures).toEqual([]);
  });

  it("degrades one failed download without blocking the other image", async () => {
    const workspace = await createWorkspace();
    const downloadAttachment = vi.fn(
      async ({ attachmentId }: { attachmentId: string }) =>
        attachmentId === "attachment-expired"
          ? Response.json(
              {
                error: {
                  code: "attachment_not_found",
                  message: "Attachment not found.",
                },
              },
              { status: 404 }
            )
          : new Response(new Uint8Array([137, 80, 78, 71]), {
              status: 200,
              headers: { "content-type": "image/png" },
            })
    );

    const result = await materializeDispatchImageAttachments({
      agentControllerRef: "builtin:claude-code",
      attachments: [
        {
          id: "attachment-expired",
          mimeType: "image/png",
          sizeBytes: 4,
          fileName: "expired.png",
        },
        {
          id: "attachment-ok",
          mimeType: "image/png",
          sizeBytes: 4,
          fileName: "available.png",
        },
      ],
      downloadAttachment,
      providerRuntimeWorkingDirectory: workspace,
      spaceId: "space-1",
      taskId: "task-1",
    });

    expect(result.localPaths).toHaveLength(1);
    expect(result.promptSection).toContain(
      "The user attached 1 image(s) but they could not be retrieved."
    );
    expect(result.promptSection).toContain(
      '"expired.png" (attachment-expired)'
    );
    expect(result.promptSection).toContain("attachment-ok.png");
    expect(result.failures).toMatchObject([
      {
        attachment: { id: "attachment-expired" },
        errorCode: "download_failed",
        errorMessage: "Attachment download returned HTTP 404.",
      },
    ]);
  });

  it("degrades an unreadable download body without blocking the Wake", async () => {
    const workspace = await createWorkspace();
    const response = new Response(null, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
    vi.spyOn(response, "arrayBuffer").mockRejectedValue(
      new Error("Download body expired.")
    );

    const result = await materializeDispatchImageAttachments({
      agentControllerRef: "builtin:codex",
      attachments: [
        {
          id: "attachment-expired",
          mimeType: "image/png",
          sizeBytes: 4,
          fileName: "expired.png",
        },
      ],
      downloadAttachment: vi.fn(async () => response),
      providerRuntimeWorkingDirectory: workspace,
      spaceId: "space-1",
      taskId: "task-1",
    });

    expect(result.localPaths).toEqual([]);
    expect(result.failures).toMatchObject([
      {
        errorCode: "download_failed",
        errorMessage: "Download body expired.",
      },
    ]);
    expect(result.promptSection).toContain(
      "The user attached 1 image(s) but they could not be retrieved."
    );
  });

  it("rejects an unsafe attachment ID before download or path creation", async () => {
    const workspace = await createWorkspace();
    const downloadAttachment = vi.fn();

    const result = await materializeDispatchImageAttachments({
      agentControllerRef: "builtin:opencode",
      attachments: [
        {
          id: "../escape",
          mimeType: "image/png",
          sizeBytes: 4,
          fileName: "escape.png",
        },
      ],
      downloadAttachment,
      providerRuntimeWorkingDirectory: workspace,
      spaceId: "space-1",
      taskId: "task-1",
    });

    expect(downloadAttachment).not.toHaveBeenCalled();
    await expect(
      access(join(workspace, ".openmeld", "attachments"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.failures[0]?.errorCode).toBe("invalid_attachment_id");
    expect(result.promptSection).toContain(
      "The user attached 1 image(s) but they could not be retrieved."
    );
  });

  it("does nothing when the Wake has no images", async () => {
    const workspace = await createWorkspace();
    const downloadAttachment = vi.fn();

    const result = await materializeDispatchImageAttachments({
      agentControllerRef: "builtin:codex",
      attachments: [],
      downloadAttachment,
      providerRuntimeWorkingDirectory: workspace,
      spaceId: "space-1",
      taskId: "task-1",
    });

    expect(downloadAttachment).not.toHaveBeenCalled();
    await expect(access(join(workspace, ".openmeld"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(result).toEqual({
      failures: [],
      localPaths: [],
      promptSection: null,
    });
  });
});
