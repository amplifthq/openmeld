import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { buildRepositoryFingerprint } from "@openmeld/projects";
import type { LocalProjectControlGitStatus } from "@openmeld/schemas";

const GIT_COMMAND_TIMEOUT_MS = 10_000;
const DEFAULT_GIT_CONCURRENCY = 4;
const MISSING_ORIGIN_PATTERN = /no such remote|not found/iu;
const NOT_GIT_REPOSITORY_PATTERN = /not a git repository/iu;

export type GitCommandInput = {
  args: string[];
  command: string;
  timeoutMs: number;
};

export type GitCommandOutput = {
  stderr: string;
  stdout: string;
};

export type RunGitCommand = (
  input: GitCommandInput
) => Promise<GitCommandOutput>;

type GitCommandFailureReason =
  | "exit"
  | "not_installed"
  | "timed_out"
  | "unavailable";

export class GitCommandFailure extends Error {
  readonly exitCode: number | null;
  readonly reason: GitCommandFailureReason;
  readonly stderr: string;

  constructor(
    reason: GitCommandFailureReason,
    message: string,
    stderr = "",
    exitCode: number | null = null
  ) {
    super(message);
    this.exitCode = exitCode;
    this.name = "GitCommandFailure";
    this.reason = reason;
    this.stderr = stderr;
  }
}

export class GitVerificationUnavailableError extends Error {
  readonly status: LocalProjectControlGitStatus;

  constructor(status: LocalProjectControlGitStatus) {
    super(`Git verification is unavailable: ${status}`);
    this.name = "GitVerificationUnavailableError";
    this.status = status;
  }
}

export class NotGitRepositoryError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`The folder is not a Git repository: ${path}`);
    this.name = "NotGitRepositoryError";
    this.path = path;
  }
}

export type InspectedGitRepository = {
  canonicalPath: string;
  originUrl: string | null;
  repositoryFingerprint: string | null;
};

export type GitRepositoryVerifier = ReturnType<
  typeof createGitRepositoryVerifier
>;

export function createGitRepositoryVerifier(
  input: {
    canonicalizePath?: (path: string) => Promise<string>;
    deadlineMs?: number;
    maxConcurrency?: number;
    now?: () => number;
    platform?: NodeJS.Platform;
    runCommand?: RunGitCommand;
  } = {}
) {
  const now = input.now ?? Date.now;
  const platform = input.platform ?? process.platform;
  const runCommand = input.runCommand ?? runGitCommand;
  const canonicalizePath = input.canonicalizePath ?? realpath;
  const semaphore =
    input.maxConcurrency === undefined
      ? GLOBAL_GIT_COMMAND_SEMAPHORE
      : new CommandSemaphore(input.maxConcurrency);
  let availability: Promise<LocalProjectControlGitStatus> | null = null;

  const withinDeadline = async <T>(operation: Promise<T>): Promise<T> => {
    if (input.deadlineMs === undefined) {
      return await operation;
    }
    const remainingMs = input.deadlineMs - now();
    if (remainingMs <= 0) {
      throw discoveryBudgetExpired();
    }
    return await rejectAfter(operation, remainingMs, discoveryBudgetExpired);
  };

  const run = async (command: {
    args: string[];
    command: string;
  }): Promise<GitCommandOutput> => {
    return await withinDeadline(
      semaphore.run(async () => {
        const remainingMs =
          input.deadlineMs === undefined
            ? GIT_COMMAND_TIMEOUT_MS
            : input.deadlineMs - now();
        if (remainingMs <= 0) {
          throw discoveryBudgetExpired();
        }
        return await runCommand({
          ...command,
          timeoutMs: Math.min(GIT_COMMAND_TIMEOUT_MS, remainingMs),
        });
      })
    );
  };

  const checkAvailability = async (): Promise<LocalProjectControlGitStatus> => {
    availability ??= (async () => {
      if (platform === "darwin") {
        try {
          await run({ args: ["-p"], command: "xcode-select" });
        } catch {
          return "command_line_tools_missing";
        }
      }
      try {
        await run({ args: ["--version"], command: "git" });
        return "available";
      } catch (error) {
        return gitFailureToStatus(error);
      }
    })();
    return await availability;
  };

  const inspectRepository = async (
    path: string
  ): Promise<InspectedGitRepository> => {
    const status = await checkAvailability();
    if (status !== "available") {
      throw new GitVerificationUnavailableError(status);
    }
    let toplevel: GitCommandOutput;
    try {
      toplevel = await run({
        args: ["-C", path, "rev-parse", "--show-toplevel"],
        command: "git",
      });
    } catch (error) {
      if (
        error instanceof GitCommandFailure &&
        error.reason === "exit" &&
        NOT_GIT_REPOSITORY_PATTERN.test(error.stderr || error.message)
      ) {
        throw new NotGitRepositoryError(path);
      }
      throw new GitVerificationUnavailableError(gitFailureToStatus(error));
    }
    const rawToplevel = toplevel.stdout.trim();
    if (!rawToplevel) {
      throw new GitVerificationUnavailableError("unavailable");
    }
    const canonicalPath = await withinDeadline(
      canonicalizePath(resolve(rawToplevel))
    );
    let originUrl: string | null;
    try {
      originUrl = (
        await run({
          args: ["-C", canonicalPath, "remote", "get-url", "origin"],
          command: "git",
        })
      ).stdout.trim();
      originUrl ||= null;
    } catch (error) {
      if (isMissingOrigin(error)) {
        originUrl = null;
      } else {
        throw new GitVerificationUnavailableError(gitFailureToStatus(error));
      }
    }
    return {
      canonicalPath,
      originUrl,
      repositoryFingerprint: originUrl
        ? await buildRepositoryFingerprint(originUrl)
        : null,
    };
  };

  const listWorktrees = async (repositoryPath: string): Promise<string[]> => {
    const status = await checkAvailability();
    if (status !== "available") {
      throw new GitVerificationUnavailableError(status);
    }
    try {
      const result = await run({
        args: ["-C", repositoryPath, "worktree", "list", "--porcelain"],
        command: "git",
      });
      const canonicalPaths = await withinDeadline(
        Promise.all(
          parseGitWorktreeList(result.stdout).map(async (path) => {
            const absolutePath = resolve(path);
            return await canonicalizePath(absolutePath).catch(
              (error: NodeJS.ErrnoException) => {
                if (error.code === "ENOENT") {
                  return null;
                }
                throw error;
              }
            );
          })
        )
      );
      return canonicalPaths.filter((path): path is string => path !== null);
    } catch (error) {
      if (error instanceof GitVerificationUnavailableError) {
        throw error;
      }
      throw new GitVerificationUnavailableError(gitFailureToStatus(error));
    }
  };

  return {
    checkAvailability,
    inspectRepository,
    listWorktrees,
    runForTest: run,
  };
}

export function parseGitWorktreeList(value: string): string[] {
  return value
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter(Boolean);
}

function isMissingOrigin(error: unknown): boolean {
  return Boolean(
    error instanceof GitCommandFailure &&
      error.reason === "exit" &&
      MISSING_ORIGIN_PATTERN.test(error.stderr || error.message)
  );
}

function gitFailureToStatus(error: unknown): LocalProjectControlGitStatus {
  if (!(error instanceof GitCommandFailure)) {
    return "unavailable";
  }
  if (error.reason === "not_installed") {
    return "not_installed";
  }
  if (error.reason === "timed_out") {
    return "timed_out";
  }
  return "unavailable";
}

class CommandSemaphore {
  private active = 0;
  private readonly maximum: number;
  private readonly queue: Array<() => void> = [];

  constructor(maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new Error("Git command concurrency must be a positive integer.");
    }
    this.maximum = maximum;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) {
      await new Promise<void>((resolveWaiter) =>
        this.queue.push(resolveWaiter)
      );
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

const GLOBAL_GIT_COMMAND_SEMAPHORE = new CommandSemaphore(
  DEFAULT_GIT_CONCURRENCY
);

function discoveryBudgetExpired(): GitCommandFailure {
  return new GitCommandFailure(
    "timed_out",
    "The local Project discovery budget expired."
  );
}

async function rejectAfter<T>(
  operation: Promise<T>,
  timeoutMs: number,
  createError: () => Error
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(createError()), timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

const runGitCommand: RunGitCommand = async (input) =>
  await new Promise<GitCommandOutput>((resolveCommand, rejectCommand) => {
    execFile(
      input.command,
      input.args,
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: input.timeoutMs,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolveCommand({ stderr, stdout });
          return;
        }
        const nodeError = error as NodeJS.ErrnoException & {
          killed?: boolean;
          signal?: string | null;
        };
        if (nodeError.code === "ENOENT") {
          rejectCommand(
            new GitCommandFailure("not_installed", error.message, stderr)
          );
          return;
        }
        if (nodeError.killed || nodeError.signal === "SIGTERM") {
          rejectCommand(
            new GitCommandFailure("timed_out", error.message, stderr)
          );
          return;
        }
        rejectCommand(
          new GitCommandFailure(
            "exit",
            error.message,
            stderr,
            typeof nodeError.code === "number" ? nodeError.code : null
          )
        );
      }
    );
  });
