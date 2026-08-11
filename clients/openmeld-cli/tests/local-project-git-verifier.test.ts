import { describe, expect, it } from "vitest";
import {
  createGitRepositoryVerifier,
  GitCommandFailure,
  GitVerificationUnavailableError,
  NotGitRepositoryError,
  parseGitWorktreeList,
  type RunGitCommand,
} from "../src/local-service/projects/git-repository-verifier";

describe("local Project Git verification", () => {
  it("checks xcode-select before Git on macOS and never opens an installer", async () => {
    const commands: string[] = [];
    const verifier = createGitRepositoryVerifier({
      platform: "darwin",
      runCommand: (input) => {
        commands.push([input.command, ...input.args].join(" "));
        return Promise.reject(
          new GitCommandFailure("exit", "Command Line Tools are missing")
        );
      },
    });

    await expect(verifier.checkAvailability()).resolves.toBe(
      "command_line_tools_missing"
    );
    expect(commands).toEqual(["xcode-select -p"]);
  });

  it("normalizes a repository subdirectory to its canonical Git toplevel", async () => {
    const commands: string[] = [];
    const verifier = createGitRepositoryVerifier({
      canonicalizePath: (path) => Promise.resolve(path),
      platform: "linux",
      runCommand: (input) => {
        commands.push([input.command, ...input.args].join(" "));
        if (input.args[0] === "--version") {
          return Promise.resolve({
            stderr: "",
            stdout: "git version 2.50.0\n",
          });
        }
        if (input.args.at(-1) === "--show-toplevel") {
          return Promise.resolve({
            stderr: "",
            stdout: "/workspace/openmeld\n",
          });
        }
        return Promise.resolve({
          stderr: "",
          stdout: "git@github.com:OpenMeldAI/openmeld.git\n",
        });
      },
    });

    await expect(
      verifier.inspectRepository("/workspace/openmeld/clients/web")
    ).resolves.toEqual({
      canonicalPath: "/workspace/openmeld",
      originUrl: "git@github.com:OpenMeldAI/openmeld.git",
      repositoryFingerprint:
        "sha256:db842c81f5054f3e212e05b4466f9ce3344eb0245132d84b21dc182a977a136e",
    });
    expect(commands).toEqual([
      "git --version",
      "git -C /workspace/openmeld/clients/web rev-parse --show-toplevel",
      "git -C /workspace/openmeld remote get-url origin",
    ]);
  });

  it("parses worktree porcelain without treating metadata as paths", () => {
    expect(
      parseGitWorktreeList(
        [
          "worktree /workspace/openmeld",
          "HEAD abc123",
          "branch refs/heads/main",
          "",
          "worktree /workspace/openmeld feature",
          "HEAD def456",
          "detached",
          "",
        ].join("\n")
      )
    ).toEqual(["/workspace/openmeld", "/workspace/openmeld feature"]);
  });

  it("limits all Git commands to four deterministic in-flight operations", async () => {
    const releases: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;
    const runCommand: RunGitCommand = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return { stderr: "", stdout: "git version 2.50.0\n" };
    };
    const verifier = createGitRepositoryVerifier({
      maxConcurrency: 4,
      platform: "linux",
      runCommand,
    });

    const checks = Array.from({ length: 6 }, () =>
      verifier.runForTest({ args: ["--version"], command: "git" })
    );
    await waitFor(() => releases.length === 4);
    expect(maximumActive).toBe(4);
    for (const release of releases.splice(0, 4)) {
      release();
    }
    await waitFor(() => releases.length === 2);
    for (const release of releases.splice(0)) {
      release();
    }
    await Promise.all(checks);
    expect(maximumActive).toBe(4);
  });

  it("shares the four-command ceiling across verifier instances", async () => {
    const releases: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;
    const runCommand: RunGitCommand = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return { stderr: "", stdout: "ok\n" };
    };
    const first = createGitRepositoryVerifier({
      platform: "linux",
      runCommand,
    });
    const second = createGitRepositoryVerifier({
      platform: "linux",
      runCommand,
    });

    const checks = Array.from({ length: 3 }, () =>
      first.runForTest({ args: ["--version"], command: "git" })
    ).concat(
      Array.from({ length: 3 }, () =>
        second.runForTest({ args: ["--version"], command: "git" })
      )
    );
    await waitFor(() => releases.length === 4);
    expect(maximumActive).toBe(4);
    for (const release of releases.splice(0, 4)) {
      release();
    }
    await waitFor(() => releases.length === 2);
    for (const release of releases.splice(0)) {
      release();
    }
    await Promise.all(checks);
    expect(maximumActive).toBe(4);
  });

  it.each([
    [
      "a plain folder",
      "fatal: not a git repository (or any of the parent directories): .git",
      NotGitRepositoryError,
    ],
    [
      "a Git command failure",
      "fatal: cannot open .git/FETCH_HEAD: Permission denied",
      GitVerificationUnavailableError,
    ],
  ])("distinguishes %s from verification failure", async (_label, stderr, errorType) => {
    const verifier = createGitRepositoryVerifier({
      canonicalizePath: (path) => Promise.resolve(path),
      platform: "linux",
      runCommand: (input) =>
        input.args[0] === "--version"
          ? Promise.resolve({ stderr: "", stdout: "git version 2.50.0\n" })
          : Promise.reject(
              new GitCommandFailure("exit", "git failed", stderr, 128)
            ),
    });

    await expect(
      verifier.inspectRepository("/workspace")
    ).rejects.toBeInstanceOf(errorType);
  });

  it("caps each command at ten seconds and the remaining discovery budget", async () => {
    const timeouts: number[] = [];
    const verifier = createGitRepositoryVerifier({
      deadlineMs: 17_000,
      now: () => 9000,
      platform: "linux",
      runCommand: (input) => {
        timeouts.push(input.timeoutMs);
        return Promise.resolve({
          stderr: "",
          stdout: "git version 2.50.0\n",
        });
      },
    });

    await verifier.runForTest({ args: ["--version"], command: "git" });
    expect(timeouts).toEqual([8000]);
  });

  it("rechecks the shared deadline after waiting for a command slot", async () => {
    let nowMs = 0;
    let releaseFirst: (() => void) | undefined;
    let commandCount = 0;
    const verifier = createGitRepositoryVerifier({
      deadlineMs: 10_000,
      maxConcurrency: 1,
      now: () => nowMs,
      platform: "linux",
      runCommand: async () => {
        commandCount += 1;
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return { stderr: "", stdout: "ok\n" };
      },
    });

    const first = verifier.runForTest({ args: ["first"], command: "git" });
    await waitFor(() => releaseFirst !== undefined);
    const queued = verifier.runForTest({ args: ["queued"], command: "git" });
    nowMs = 10_001;
    releaseFirst?.();

    await expect(first).resolves.toMatchObject({ stdout: "ok\n" });
    await expect(queued).rejects.toMatchObject({ reason: "timed_out" });
    expect(commandCount).toBe(1);
  });

  it.each([
    ["missing binary", "not_installed", "not_installed"],
    ["timeout", "timed_out", "timed_out"],
    ["other failure", "unavailable", "exit"],
  ] as const)("maps %s to the frozen Git status", async (_label, expectedStatus, failureReason) => {
    const verifier = createGitRepositoryVerifier({
      platform: "linux",
      runCommand: () =>
        Promise.reject(new GitCommandFailure(failureReason, "failed")),
    });

    await expect(verifier.checkAvailability()).resolves.toBe(expectedStatus);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("The deterministic test condition was not reached.");
}
