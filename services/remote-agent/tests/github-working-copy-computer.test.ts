import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type RemoteAgentGitTreeEntry,
  remoteAgentGitNativeResultSchema,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { GITHUB_WORKING_COPY_PROGRAM } from "../flue-adapter/github-working-copy-computer";

const roots: string[] = [];
const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};
function git(root: string, args: string[], input?: string | Buffer) {
  return execFileSync("git", ["-C", root, ...args], { input, env: gitEnv });
}
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("Missing expected native Git fixture value");
  }
  return value;
}
function fixture(count = 3) {
  const root = mkdtempSync(join(tmpdir(), "openmeld-git-copy-"));
  roots.push(root);
  const source = join(root, "source");
  mkdirSync(source);
  git(source, ["init", "--initial-branch=main"]);
  mkdirSync(join(source, "nested"));
  writeFileSync(
    join(source, "nested", "中文 binary.dat"),
    Buffer.from([0, 1, 255, 10, 0, 128])
  );
  writeFileSync(join(source, "run.sh"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(source, "run.sh"), 0o755);
  symlinkSync("../run.sh", join(source, "nested", "link"));
  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(source, `file-${index}.txt`), `Value ${index}\n`);
  }
  git(source, ["add", "."]);
  git(source, ["commit", "-m", "source"]);
  const sourceCommit = git(source, ["rev-parse", "HEAD"]).toString().trim();
  const sourceTree = git(source, ["rev-parse", "HEAD^{tree}"])
    .toString()
    .trim();
  const entries: RemoteAgentGitTreeEntry[] = git(source, [
    "ls-tree",
    "-r",
    "-t",
    "-z",
    "HEAD",
  ])
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [header, ...path] = line.split("\t");
      const [mode, type, sha] = required(header).split(" ");
      return {
        path: path.join("\t"),
        mode: required(mode).padStart(6, "0"),
        type,
        sha,
      } as RemoteAgentGitTreeEntry;
    });
  const text = JSON.stringify(entries);
  const transportDirectory = join(root, "transfer");
  mkdirSync(join(transportDirectory, "blobs"), { recursive: true });
  writeFileSync(join(transportDirectory, "manifest.json"), text);
  const request = {
    directory: join(root, "copy"),
    transportDirectory,
    sourceCommit,
    sourceTree,
    manifestDigest: createHash("sha256").update(text).digest("hex"),
    output: join(transportDirectory, "result.json"),
  };
  const invoke = (action: string, sha?: string) => {
    execFileSync("python3", [
      "-c",
      GITHUB_WORKING_COPY_PROGRAM,
      JSON.stringify({ ...request, action, sha }),
    ]);
    return remoteAgentGitNativeResultSchema.parse(
      JSON.parse(readFileSync(request.output, "utf8"))
    );
  };
  const transfer = (missing: string[]) => {
    for (const sha of missing) {
      writeFileSync(
        join(transportDirectory, "blobs", sha),
        git(source, ["cat-file", "blob", sha])
      );
    }
  };
  return { source, entries, request, invoke, transfer };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("native Git working-copy transport", () => {
  it("preserves the exact source tree including binary files, modes and symlinks without provider credentials", () => {
    const f = fixture();
    const pending = f.invoke("prepare");
    expect(pending.ready).toBe(false);
    expect(existsSync(f.request.directory)).toBe(false);
    f.transfer(required(pending.missing));
    const ready = f.invoke("prepare");
    expect(ready).toMatchObject({
      ready: true,
      tree: f.request.sourceTree,
      remaining: 0,
    });
    expect(
      git(f.request.directory, ["rev-parse", "HEAD^{tree}"]).toString().trim()
    ).toBe(f.request.sourceTree);
    expect(
      readFileSync(join(f.request.directory, "nested", "中文 binary.dat"))
    ).toEqual(Buffer.from([0, 1, 255, 10, 0, 128]));
    expect(readlinkSync(join(f.request.directory, "nested", "link"))).toBe(
      "../run.sh"
    );
    expect(
      readFileSync(join(f.request.directory, ".git", "config"), "utf8")
    ).not.toContain("http");
    expect(ready.localCommit).not.toBe(f.request.sourceCommit);
  });

  it("continues bounded batches and never resets edits when checkout is retried", () => {
    const f = fixture(40);
    const first = f.invoke("prepare");
    expect(first.missing).toHaveLength(32);
    f.transfer(required(first.missing));
    const second = f.invoke("prepare");
    expect(second.ready).toBe(false);
    f.transfer(required(second.missing));
    expect(f.invoke("prepare").ready).toBe(true);
    writeFileSync(
      join(f.request.directory, "file-0.txt"),
      "unfinished user edit"
    );
    expect(f.invoke("prepare").ready).toBe(true);
    expect(readFileSync(join(f.request.directory, "file-0.txt"), "utf8")).toBe(
      "unfinished user edit"
    );
  });

  it("exports an exact immutable commit and does not include later uncommitted changes", () => {
    const f = fixture();
    f.transfer(required(f.invoke("prepare").missing));
    f.invoke("prepare");
    rmSync(join(f.request.directory, "file-0.txt"));
    writeFileSync(
      join(f.request.directory, "run.sh"),
      "#!/bin/sh\necho changed\n"
    );
    git(f.request.directory, ["add", "."]);
    git(f.request.directory, ["commit", "-m", "multiple changes"]);
    const commit = git(f.request.directory, ["rev-parse", "HEAD"])
      .toString()
      .trim();
    writeFileSync(join(f.request.directory, "file-1.txt"), "not committed");
    const exported = f.invoke("snapshot", commit);
    expect(exported.tree).toBe(
      git(f.request.directory, ["rev-parse", `${commit}^{tree}`])
        .toString()
        .trim()
    );
    expect(
      required(exported.entries).some((entry) => entry.path === "file-0.txt")
    ).toBe(false);
    const file = required(
      required(exported.entries).find((entry) => entry.path === "file-1.txt")
    );
    expect(
      Buffer.from(
        required(f.invoke("blob", file.sha).blob),
        "base64"
      ).toString()
    ).toBe("Value 1\n");
  });

  it("rejects changed manifests and corrupt bytes before delivering any working copy", () => {
    const f = fixture();
    const pending = f.invoke("prepare");
    writeFileSync(
      join(
        f.request.transportDirectory,
        "blobs",
        required(required(pending.missing)[0])
      ),
      "corrupt"
    );
    expect(() => f.invoke("prepare")).toThrow();
    expect(existsSync(f.request.directory)).toBe(false);
    writeFileSync(join(f.request.transportDirectory, "manifest.json"), "[]");
    const result = spawnSync("python3", [
      "-c",
      GITHUB_WORKING_COPY_PROGRAM,
      JSON.stringify({ ...f.request, action: "prepare" }),
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toString()).toContain("manifest changed");
  });
});
