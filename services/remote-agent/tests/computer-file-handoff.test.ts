import type { WorkspaceClient } from "@cloudflare/computer";
import { describe, expect, it, vi } from "vitest";
import { createAgentComputerFileHandoff } from "../flue-adapter/computer-file-handoff";

function createWorkspaceFake(files: Record<string, string>) {
  const storedFiles = new Map(Object.entries(files));
  const fs = {
    lstat: vi.fn((path: string) => {
      const content = storedFiles.get(path);
      if (content !== undefined) {
        return Promise.resolve({
          isDirectory: false,
          isFile: true,
          isSymbolicLink: false,
          size: new TextEncoder().encode(content).byteLength,
        });
      }
      const isDirectory = [...storedFiles.keys()].some((filePath) =>
        filePath.startsWith(`${path}/`)
      );
      if (isDirectory) {
        return Promise.resolve({
          isDirectory: true,
          isFile: false,
          isSymbolicLink: false,
          size: 0,
        });
      }
      return Promise.reject(
        Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" })
      );
    }),
    readFile: vi.fn((path: string, encoding: string) => {
      if (encoding !== "utf8") {
        throw new Error("Expected a UTF-8 read.");
      }
      const content = storedFiles.get(path);
      if (content === undefined) {
        return Promise.reject(
          Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" })
        );
      }
      return Promise.resolve(content);
    }),
  };
  return { fs } as unknown as Pick<WorkspaceClient, "fs">;
}

describe("Center Agent Computer file handoff", () => {
  it("reads only selected text files inside the current working directory", async () => {
    const handoff = createAgentComputerFileHandoff({
      workingDirectory: "/computer/tasks/task-1",
      workspace: createWorkspaceFake({
        "/computer/tasks/task-1/launch/checklist.md": "Ready to ship.\n",
      }),
    });

    await expect(
      handoff.readTextFiles(["launch/./checklist.md"])
    ).resolves.toEqual([
      {
        content: "Ready to ship.\n",
        path: "launch/checklist.md",
      },
    ]);
  });

  it("rejects paths outside the current work and private sidecar files", async () => {
    const handoff = createAgentComputerFileHandoff({
      workingDirectory: "/computer/tasks/task-1",
      workspace: createWorkspaceFake({
        "/computer/tasks/other/secrets.md": "secret",
        "/computer/tasks/task-1/note.md.openmeld.json": "{}",
      }),
    });

    await expect(
      handoff.readTextFiles(["../other/secrets.md"])
    ).rejects.toThrow("current Computer working directory");
    await expect(
      handoff.readTextFiles(["note.md.openmeld.json"])
    ).rejects.toThrow("Private Computer metadata");
  });

  it("rejects binary-looking and oversized files before delegation", async () => {
    const handoff = createAgentComputerFileHandoff({
      workingDirectory: "/computer/spaces/space-1",
      workspace: createWorkspaceFake({
        "/computer/spaces/space-1/binary.txt": "safe\0unsafe",
        "/computer/spaces/space-1/large.txt": "x".repeat(32_001),
      }),
    });

    await expect(handoff.readTextFiles(["binary.txt"])).rejects.toThrow(
      "plain text"
    );
    await expect(handoff.readTextFiles(["large.txt"])).rejects.toThrow(
      "32,000 bytes"
    );
  });
});
