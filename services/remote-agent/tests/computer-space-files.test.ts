import type { WorkspaceClient } from "@cloudflare/computer";
import type { SpaceFileDescriptor } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { getRemoteAgentOpenMeldToolDefinitions } from "../agent-core/tools";
import { getComputerSpaceFileTools } from "../flue-adapter/computer-space-files";
import { materializeSpaceWork } from "../flue-adapter/space-work-materialization";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

describe("Computer Space file transfer", () => {
  it("preserves binary bytes and attaches the published revision without injecting contents", async () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      request,
      nowMs: TEST_NOW_MS,
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        requestId: "files",
        status: "pending",
        submissionId: "files",
      },
    });
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, context);
    const bytes = new Uint8Array([0, 255, 128, 13, 10, 42]);
    const actor = {
      displayName: "Agent",
      profileId: request.agentProfileId,
      ownerUserId: "user_1",
      profileKind: "agent" as const,
    };
    const now = new Date(TEST_NOW_MS).toISOString();
    const file: SpaceFileDescriptor = {
      id: "file_input",
      kind: "file",
      name: "input.bin",
      path: "/input.bin",
      parentId: null,
      spaceId: request.spaceId,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      updatedBy: actor,
      trashedAt: null,
      trashedBy: null,
      latestRevision: {
        id: "revision_input",
        fileId: "file_input",
        revision: 2,
        mimeType: "application/octet-stream",
        sizeBytes: bytes.length,
        createdAt: now,
        createdBy: actor,
      },
    };
    const readSpaceFileContent = vi.fn<
      NonNullable<RemoteAgentCoreWorkerBinding["readSpaceFileContent"]>
    >(async () => ({
      bytes: bytes.slice().buffer,
      file,
      revision: file.latestRevision,
      organizationId: request.organizationId,
      objectKey: "input.bin",
    }));
    const writeSpaceFileContent = vi.fn<
      NonNullable<RemoteAgentCoreWorkerBinding["writeSpaceFileContent"]>
    >(async ({ write }) => ({
      ...file,
      id: write.fileId,
      name: write.name ?? file.name,
      latestRevision: {
        ...file.latestRevision,
        id: write.revisionId,
        fileId: write.fileId,
        revision: (write.baseRevision ?? 0) + 1,
      },
    }));
    const stored = new Map<string, Uint8Array>();
    const workspace = {
      fs: {
        mkdir: vi.fn(async () => undefined),
        writeFile: vi.fn((path: string, data: Uint8Array) => {
          stored.set(path, data);
          return Promise.resolve();
        }),
        lstat: vi.fn(async (path: string) => ({
          isFile: stored.has(path),
          isDirectory: !stored.has(path),
          isSymbolicLink: false,
          size: stored.get(path)?.length ?? 0,
        })),
        readFile: vi.fn((path: string) => {
          const data = stored.get(path);
          if (!data) {
            throw new Error("File not found");
          }
          return Promise.resolve(new Blob([data.slice().buffer]).stream());
        }),
      },
    } as unknown as WorkspaceClient;
    const tools = getComputerSpaceFileTools({
      context,
      coreWorker: { readSpaceFileContent, writeSpaceFileContent },
      storage,
      workspaceAccess: {
        withWorkspace: async (operation) => await operation(workspace),
      },
      workingDirectory: "/computer/spaces/current",
    });
    const [download, upload, save, attach] = tools;
    const combined = [
      ...getRemoteAgentOpenMeldToolDefinitions({
        storage,
        coreWorker: {},
        submissionId: context.submissionId,
      }),
      ...tools,
    ].map((tool) => tool.name);
    expect(new Set(combined).size).toBe(combined.length);
    if (!(download && upload && save && attach)) {
      throw new Error("Missing file tools");
    }
    const downloaded = (await download.execute({
      fileId: "file_input",
      revision: 2,
    })) as { path: string };
    expect(stored.get(downloaded.path)).toEqual(bytes);
    expect(downloaded).not.toHaveProperty("bytes");
    expect(readSpaceFileContent.mock.calls[0]?.[0].spaceId).toBe(
      request.spaceId
    );
    await upload.execute({
      path: downloaded.path,
      mimeType: "application/octet-stream",
      clientMutationId: "publish-result",
    });
    const written = writeSpaceFileContent.mock.calls[0]?.[0];
    if (!written) {
      throw new Error("Missing uploaded file");
    }
    expect(new Uint8Array(written.bytes)).toEqual(bytes);
    expect(
      (await readRemoteAgentCallbackContext(storage, "files"))?.outputFiles
    ).toEqual([
      expect.objectContaining({
        name: "input.bin",
        revision: 1,
        sizeBytes: bytes.length,
      }),
    ]);
    await expect(
      upload.execute({
        path: "../private.bin",
        mimeType: "application/octet-stream",
        clientMutationId: "escape",
      })
    ).rejects.toThrow();
    expect(writeSpaceFileContent).toHaveBeenCalledTimes(1);
    const saved = await save.execute({
      path: downloaded.path,
      fileId: file.id,
      baseRevision: 2,
      mimeType: "application/octet-stream",
      clientMutationId: "save-work",
    });
    expect(saved).toMatchObject({
      attachedToFinalReply: false,
      file: { id: file.id, latestRevision: { revision: 3 } },
    });
    expect(writeSpaceFileContent.mock.calls[1]?.[0].write).toMatchObject({
      fileId: file.id,
      baseRevision: 2,
    });
    expect(
      (await readRemoteAgentCallbackContext(storage, "files"))?.outputFiles
    ).toHaveLength(1);
    writeSpaceFileContent.mockRejectedValueOnce(
      new Error("space_file.conflict")
    );
    await expect(
      save.execute({
        path: downloaded.path,
        fileId: file.id,
        baseRevision: 2,
        mimeType: "application/octet-stream",
        clientMutationId: "stale-work",
      })
    ).rejects.toThrow("space_file.conflict");
    expect(stored.get(downloaded.path)).toEqual(bytes);
    await attach.execute({ fileId: file.id, revision: 2 });
    expect(
      (await readRemoteAgentCallbackContext(storage, "files"))?.outputFiles
    ).toContainEqual(expect.objectContaining({ fileId: file.id, revision: 2 }));
    context.workHandoff = {
      schemaVersion: 1,
      files: [
        { fileId: file.id, revision: 2, relativePath: "inputs/input.bin" },
        { fileId: "missing", revision: 2, relativePath: "report.bin" },
      ],
      skills: [],
      work: { goal: "Review", completed: "", nextSteps: "Check the inputs" },
      requirements: [],
    };
    const preparation = {
      context,
      coreWorker: { readSpaceFileContent },
      storage,
      workspaceAccess: {
        withWorkspace: async <T>(
          operation: (client: WorkspaceClient) => Promise<T>
        ) => await operation(workspace),
      },
      workingDirectory: "/computer/spaces/current",
    };
    await expect(materializeSpaceWork(preparation)).rejects.toThrow(
      "selected revision"
    );
    expect(
      await storage.get(`space-work:${context.submissionId}`)
    ).toBeUndefined();
    context.workHandoff.files.pop();
    const preparedRoot = await materializeSpaceWork(preparation);
    expect(stored.get(`${preparedRoot}/inputs/input.bin`)).toEqual(bytes);
    stored.set(`${preparedRoot}/inputs/input.bin`, new Uint8Array([9]));
    expect(await materializeSpaceWork(preparation)).toBe(preparedRoot);
    expect(stored.get(`${preparedRoot}/inputs/input.bin`)).toEqual(
      new Uint8Array([9])
    );
  });
});
