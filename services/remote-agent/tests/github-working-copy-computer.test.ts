import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
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
import { fileURLToPath } from "node:url";
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
function fixture(
  count = 3,
  options: {
    beforeBaseline?: (root: string) => void;
    afterBaseline?: (root: string) => void;
  } = {}
) {
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
  options.beforeBaseline?.(source);
  git(source, ["add", "."]);
  git(source, ["commit", "-m", "baseline"]);
  const baselineCommit = git(source, ["rev-parse", "HEAD"]).toString().trim();
  const baselineTree = git(source, ["rev-parse", "HEAD^{tree}"])
    .toString()
    .trim();
  if (options.afterBaseline) {
    options.afterBaseline(source);
    git(source, ["add", "."]);
    git(source, ["commit", "-m", "candidate"]);
  }
  const sourceCommit = git(source, ["rev-parse", "HEAD"]).toString().trim();
  const sourceTree = git(source, ["rev-parse", "HEAD^{tree}"])
    .toString()
    .trim();
  const listTree = (ref: string): RemoteAgentGitTreeEntry[] =>
    git(source, ["ls-tree", "-r", "-t", "-z", ref])
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
  const entries = listTree(sourceCommit);
  const baselineEntries = listTree(baselineCommit);
  const baselineText = JSON.stringify(baselineEntries);
  const text = JSON.stringify(entries);
  const transportDirectory = join(root, "transfer");
  mkdirSync(join(transportDirectory, "blobs"), { recursive: true });
  writeFileSync(join(transportDirectory, "manifest.json"), text);
  writeFileSync(join(transportDirectory, "baseline.json"), baselineText);
  const request = {
    directory: join(root, "copy"),
    transportDirectory,
    sourceCommit,
    sourceTree,
    manifestDigest: createHash("sha256").update(text).digest("hex"),
    baselineBranch: "main",
    baselineCommit,
    baselineTree,
    baselineManifestDigest: createHash("sha256")
      .update(baselineText)
      .digest("hex"),
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
  it("builds a verified independent origin/main baseline, not the candidate tree or upstream history", () => {
    const f = fixture(3, {
      afterBaseline: (root) =>
        writeFileSync(join(root, "candidate-only.txt"), "new code"),
    });
    for (;;) {
      const progress = f.invoke("prepare");
      if (progress.ready) {
        break;
      }
      f.transfer(required(progress.missing));
    }
    expect(
      git(f.request.directory, ["rev-parse", "origin/main^{tree}"])
        .toString()
        .trim()
    ).toBe(f.request.baselineTree);
    expect(
      git(f.request.directory, ["rev-parse", "HEAD^{tree}"]).toString().trim()
    ).toBe(f.request.sourceTree);
    expect(f.request.sourceTree).not.toBe(f.request.baselineTree);
    expect(
      git(f.request.directory, ["diff", "--name-only", "origin/main...HEAD"])
        .toString()
        .trim()
    ).toBe("candidate-only.txt");
    git(f.request.directory, [
      "update-ref",
      "refs/remotes/origin/main",
      "HEAD",
    ]);
    expect(() => f.invoke("prepare")).toThrow();
  });

  it("runs OpenMeld's actual CLI Skill build guard with independently preserved signed baseline files", () => {
    const repo = fileURLToPath(new URL("../../..", import.meta.url));
    const f = fixture(0, {
      beforeBaseline: (root) => {
        for (const path of [
          "release/openmeld-cli-skill",
          "clients/web/public/skills/openmeld-cli",
        ]) {
          cpSync(join(repo, path), join(root, path), { recursive: true });
        }
      },
      afterBaseline: (root) =>
        writeFileSync(
          join(root, "candidate-code.ts"),
          "export const next = true;\n"
        ),
    });
    for (;;) {
      const progress = f.invoke("prepare");
      if (progress.ready) {
        break;
      }
      f.transfer(required(progress.missing));
    }
    const args = [join(repo, "scripts/release/cli-skill.mjs"), "check"];
    const env = {
      ...process.env,
      OPENMELD_VERIFICATION_ROOT: f.request.directory,
      OPENMELD_AFFECTED_BASE: "origin/main",
    };
    const checked = spawnSync(process.execPath, args, {
      env,
      encoding: "utf8",
    });
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stdout).toContain("check passed");
    const baseline = git(f.request.directory, ["rev-parse", "origin/main"])
      .toString()
      .trim();
    git(f.request.directory, ["update-ref", "-d", "refs/remotes/origin/main"]);
    const missing = spawnSync(process.execPath, args, {
      env,
      encoding: "utf8",
    });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain(
      "Cannot resolve trusted CLI Skill base origin/main"
    );
    git(f.request.directory, [
      "update-ref",
      "refs/remotes/origin/main",
      baseline,
    ]);
    const archive = join(
      f.request.directory,
      "clients/web/public/skills/openmeld-cli/archive.json"
    );
    writeFileSync(archive, JSON.stringify({ schemaVersion: 1, releases: [] }));
    const removed = spawnSync(process.execPath, args, {
      env,
      encoding: "utf8",
    });
    expect(removed.status).not.toBe(0);
    expect(removed.stderr).toContain("trusted");
  });

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
