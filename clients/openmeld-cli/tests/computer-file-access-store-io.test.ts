import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Rename = typeof import("node:fs/promises").rename;
type WriteFile = typeof import("node:fs/promises").writeFile;

const fileSystemMocks = vi.hoisted(() => ({
  actualRename: null as Rename | null,
  actualWriteFile: null as WriteFile | null,
  rename: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  fileSystemMocks.actualRename = actual.rename;
  fileSystemMocks.actualWriteFile = actual.writeFile;
  fileSystemMocks.rename.mockImplementation(actual.rename);
  fileSystemMocks.writeFile.mockImplementation(actual.writeFile);
  return {
    ...actual,
    rename: fileSystemMocks.rename,
    writeFile: fileSystemMocks.writeFile,
  };
});

import {
  ComputerFileAccessStoreError,
  updateComputerFileAccessPolicy,
} from "../src/local-service/file-access/computer-file-access-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "openmeld-file-access-io-"));
  tempDirs.push(path);
  return path;
}

beforeEach(() => {
  if (!(fileSystemMocks.actualRename && fileSystemMocks.actualWriteFile)) {
    throw new Error("The real filesystem implementations were not captured.");
  }
  fileSystemMocks.rename
    .mockReset()
    .mockImplementation(fileSystemMocks.actualRename);
  fileSystemMocks.writeFile
    .mockReset()
    .mockImplementation(fileSystemMocks.actualWriteFile);
});

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { force: true, recursive: true });
    })
  );
});

describe("Computer file access store I/O failures", () => {
  it("keeps write failures and temporary paths in local diagnostics", async () => {
    const root = await makeTempDir();
    const storePath = join(root, "policy.json");
    fileSystemMocks.writeFile.mockRejectedValueOnce(
      Object.assign(
        new Error(`EACCES: permission denied, open '${storePath}.tmp-secret'`),
        { code: "EACCES" }
      )
    );

    const error = await updateComputerFileAccessPolicy({
      expectedRevision: 1,
      idempotencyKey: "write-failure",
      nowMs: 100,
      policy: { mode: "local_agent_settings" },
      storePath,
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: "computer.file_access.internal_error",
      localDiagnosticContext: {
        errorCode: "EACCES",
        operation: "write_store",
        reason: "io_error",
      },
    });
    if (!(error instanceof ComputerFileAccessStoreError)) {
      throw error;
    }
    if (error.localDiagnosticContext?.reason !== "io_error") {
      throw new Error("Expected a local filesystem diagnostic.");
    }
    expect(
      error.localDiagnosticContext.path.startsWith(`${storePath}.tmp-`)
    ).toBe(true);
    expect((error as Error).message).not.toContain(storePath);
    expect(JSON.stringify(error)).not.toContain(storePath);
    expect(fileSystemMocks.rename).not.toHaveBeenCalled();
  });

  it("keeps atomic rename failures and store paths in local diagnostics", async () => {
    const root = await makeTempDir();
    const folder = join(root, "work");
    await mkdir(folder);
    const storePath = join(root, "policy.json");
    fileSystemMocks.rename.mockRejectedValueOnce(
      Object.assign(
        new Error(`EROFS: read-only file system, rename '${storePath}'`),
        { code: "EROFS" }
      )
    );

    const error = await updateComputerFileAccessPolicy({
      expectedRevision: 1,
      idempotencyKey: "rename-failure",
      nowMs: 100,
      policy: {
        folders: [folder],
        mode: "only_selected_folders",
      },
      storePath,
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: "computer.file_access.internal_error",
      localDiagnosticContext: {
        errorCode: "EROFS",
        operation: "rename_store",
        path: storePath,
        reason: "io_error",
      },
    });
    expect((error as Error).message).not.toContain(storePath);
    expect(JSON.stringify(error)).not.toContain(storePath);
  });
});
