import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceClient } from "@cloudflare/computer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gitUploadPackBytes,
  gitUploadPackRequest,
} from "../flue-adapter/git-upload-pack-stream";
import {
  advanceGitPackTransfer,
  GIT_PACK_TRANSFER_PROGRAM,
} from "../flue-adapter/github-working-copy-transfer";
import { InMemoryDurableObjectStorage } from "./storage";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
  }).trim();
}

describe("Git pack working-copy transport", () => {
  it("strips Git progress and rejects a remote error before importing bytes", async () => {
    const encoder = new TextEncoder();
    const packet = (bytes: Uint8Array) => {
      const header = encoder.encode(
        (bytes.length + 4).toString(16).padStart(4, "0")
      );
      return Buffer.concat([header, bytes]);
    };
    const response = Buffer.concat([
      packet(encoder.encode(`shallow ${"a".repeat(40)}\n`)),
      packet(encoder.encode("NAK\n")),
      packet(new Uint8Array([2, ...encoder.encode("Counting objects\n")])),
      packet(new Uint8Array([1, ...encoder.encode("PACKobjects")])),
      encoder.encode("0000"),
    ]);
    const split = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < response.length; index += 3) {
          controller.enqueue(response.subarray(index, index + 3));
        }
        controller.close();
      },
    });
    let bytes = 0;
    const result = Buffer.from(
      await new Response(
        gitUploadPackBytes(split, (count) => {
          bytes = count;
        })
      ).arrayBuffer()
    );
    expect(result.toString()).toBe("PACKobjects");
    expect(bytes).toBe(result.length);
    const request = Buffer.from(gitUploadPackRequest(["a".repeat(40)]));
    expect(request.toString()).toContain("deepen 1\n");
    expect(request.toString()).toContain("side-band-64k");
    const failure = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          packet(new Uint8Array([3, ...encoder.encode("denied\n")]))
        );
        controller.close();
      },
    });
    await expect(
      new Response(gitUploadPackBytes(failure, () => undefined)).arrayBuffer()
    ).rejects.toThrow("github.checkout.git_remote_rejected");
  });
  it("does not replay a historical detached import without a Computer receipt", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const exec = vi.fn(async () => ({ [Symbol.dispose]: () => undefined }));
    const getExec = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error("Retained process was interrupted"), {
          code: "ENOENT",
        })
      )
    );
    const workspace = {
      runtime: { exec, getExec },
    } as unknown as WorkspaceClient;
    const input = {
      storage,
      invocationId: "new-invocation",
      workspaceAccess: {
        withWorkspace: async <T>(run: (value: WorkspaceClient) => Promise<T>) =>
          await run(workspace),
      },
      operationId: "operation-2",
      packPath: "/computer/transfer/pack-1.pack",
      location: {
        directory: "/computer/repo",
        transportDirectory: "/computer/transfer",
        manifestDigest: "a".repeat(64),
        sourceCommit: "a".repeat(40),
        sourceTree: "b".repeat(40),
        baselineBranch: "main",
        baselineCommit: "c".repeat(40),
        baselineTree: "d".repeat(40),
        baselineManifestDigest: "e".repeat(64),
      },
      expiresAtMs: Date.now() + 60_000,
    };
    await storage.put("github-working-copy:git-transfer:operation-2", {
      id: "historical-native-id",
      operationId: "operation-2",
      attempt: 1,
    });
    await expect(advanceGitPackTransfer(input)).rejects.toThrow(
      "github.checkout.git_transfer_result_unconfirmed"
    );
    expect(exec).not.toHaveBeenCalled();
    expect(getExec).not.toHaveBeenCalled();
  });

  it("fetches pinned source and baseline objects without storing credentials or upstream history as the working copy", () => {
    const directory = mkdtempSync(join(tmpdir(), "openmeld-git-transfer-"));
    directories.push(directory);
    const upstream = join(directory, "upstream");
    const transport = join(directory, "transport");
    execFileSync("git", ["init", "--quiet", upstream]);
    git(upstream, "config", "user.name", "Test");
    git(upstream, "config", "user.email", "test@openmeld.invalid");
    git(upstream, "commit", "--allow-empty", "-m", "baseline");
    const baselineCommit = git(upstream, "rev-parse", "HEAD");
    const baselineTree = git(upstream, "rev-parse", "HEAD^{tree}");
    writeFileSync(join(upstream, "source.txt"), "One changed file\n");
    git(upstream, "add", "source.txt");
    git(upstream, "commit", "-m", "source");
    const sourceCommit = git(upstream, "rev-parse", "HEAD");
    const sourceTree = git(upstream, "rev-parse", "HEAD^{tree}");
    execFileSync("git", ["init", "--quiet", transport]);
    const packPath = join(directory, "objects.pack");
    writeFileSync(
      packPath,
      execFileSync(
        "git",
        ["-C", upstream, "pack-objects", "--stdout", "--revs"],
        {
          input: `${sourceCommit}\n${baselineCommit}\n`,
        }
      )
    );
    const request = {
      root: transport,
      packPath,
      sourceCommit,
      sourceTree,
      baselineCommit,
      baselineTree,
    };

    execFileSync("python3", [
      "-c",
      GIT_PACK_TRANSFER_PROGRAM,
      JSON.stringify(request),
    ]);

    expect(git(transport, "cat-file", "-t", sourceCommit)).toBe("commit");
    expect(git(transport, "cat-file", "-t", baselineCommit)).toBe("commit");
    expect(sourceTree).not.toBe(baselineTree);
    expect(git(transport, "remote", "-v")).toBe("");
    expect(git(transport, "config", "--local", "--list")).not.toContain(
      "token"
    );
    expect(() =>
      execFileSync("python3", [
        "-c",
        GIT_PACK_TRANSFER_PROGRAM,
        JSON.stringify({ ...request, sourceTree: "0".repeat(40) }),
      ])
    ).toThrow("Fetched tree mismatch");
  });
});
