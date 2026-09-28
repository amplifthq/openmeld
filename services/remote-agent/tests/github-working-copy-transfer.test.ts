import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceClient } from "@cloudflare/computer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advanceGitPackTransfer,
  GIT_PACK_TRANSFER_PROGRAM,
  hasGitPackTransfer,
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
  it("starts an operation only when no transfer has been recorded", async () => {
    const storage = new InMemoryDurableObjectStorage();
    expect(await hasGitPackTransfer(storage, "operation-1")).toBe(false);
    await storage.put("github-working-copy:git-transfer:operation-1", {
      id: "retained-process",
      operationId: "operation-1",
    });
    expect(await hasGitPackTransfer(storage, "operation-1")).toBe(true);
  });

  it("restarts a lost retained transfer at most once per retry", async () => {
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
      workspaceAccess: {
        withWorkspace: async <T>(run: (value: WorkspaceClient) => Promise<T>) =>
          await run(workspace),
      },
      operationId: "operation-2",
      owner: "acme",
      repo: "private",
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
    expect(await advanceGitPackTransfer(input)).toBe("running");
    expect(await advanceGitPackTransfer(input)).toBe("running");
    expect(exec).toHaveBeenCalledTimes(2);
    expect(getExec).toHaveBeenCalledTimes(1);
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
    const request = {
      root: transport,
      url: `file://${upstream}`,
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
