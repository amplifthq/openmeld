import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  ComputerFileAccessPolicy,
  ExecutionContextTask,
} from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireLock, releaseLock } from "../src/config/lock";
import {
  markExecutionContextWorkspaceInUse,
  prepareExecutionContextWorkspace,
  readExecutionContextWorkspace,
  releaseExecutionContextWorkspace,
} from "../src/local-service/dispatch/execution-context-workspace";

const execFileAsync = promisify(execFile);
const context: ExecutionContextTask = {
  version: 1,
  id: "11111111-1111-4111-8111-111111111111",
  access: "workspace",
  workspace: "isolated",
  scope: {
    organizationId: "org",
    requesterProfileId: "human",
    spaceId: "space",
    targetProfileId: "agent",
    threadId: null,
  },
  nativeConversationId: null,
  runtimeWorkspaceFingerprint: null,
};
const defaultPolicy: ComputerFileAccessPolicy = {
  mode: "local_agent_settings",
  revision: 1,
  updatedAtMs: 1,
};
let root: string;
let source: string;
let ledger: string;

beforeEach(async () => {
  root = await realpath(
    await mkdtemp(join(tmpdir(), "openmeld-context-workspace-"))
  );
  source = join(root, "source");
  ledger = join(root, "lane");
  await mkdir(source);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function git(cwd: string, args: string[]): Promise<string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
  const result = await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Workspace Test",
      "-c",
      "user.email=workspace@example.invalid",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    {
      cwd,
      env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      encoding: "utf8",
    }
  );
  return result.stdout.trim();
}

async function initializeRepository(): Promise<string> {
  await git(source, ["init", "--template="]);
  await writeFile(join(source, "tracked.txt"), "committed source\n");
  await writeFile(join(source, ".gitignore"), ".env\n");
  await git(source, ["add", "."]);
  await git(source, ["commit", "-m", "Initial committed fixture"]);
  return await git(source, ["rev-parse", "HEAD"]);
}

function prepare(
  overrides: Partial<
    Parameters<typeof prepareExecutionContextWorkspace>[0]
  > = {}
) {
  return prepareExecutionContextWorkspace({
    context,
    currentWorkingDirectory: source,
    ledgerRootPath: ledger,
    policy: defaultPolicy,
    ...overrides,
  });
}

describe("Execution Context workspaces", () => {
  it.each([
    "before Git",
    "after init",
    "after fetch",
    "during checkout",
    "after checkout",
  ])("reconciles an interrupted preparation %s at the frozen commit", async (stage) => {
    const base = await initializeRepository();
    const first = await prepare();
    const path = join(
      ledger,
      "execution-context-workspace-records",
      `${context.id}.json`
    );
    const record = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...record, status: "preparing" }));
    if (stage !== "after checkout" && stage !== "during checkout") {
      await rm(first.boundaryRoot, { recursive: true });
    }
    if (stage === "during checkout") {
      await rm(join(first.workingDirectory, "tracked.txt"));
    }
    if (stage === "after init" || stage === "after fetch") {
      await mkdir(first.boundaryRoot);
      const repository = join(first.boundaryRoot, "repository.git");
      await git(first.boundaryRoot, [
        "init",
        "--bare",
        "--template=",
        repository,
      ]);
      if (stage === "after fetch") {
        await git(first.boundaryRoot, [
          `--git-dir=${repository}`,
          "fetch",
          "--depth=1",
          source,
          `${base}:refs/openmeld/base`,
        ]);
      }
    }
    await writeFile(join(source, "tracked.txt"), "later source commit\n");
    await git(source, ["commit", "-am", "Move source"]);
    const retried = await prepare();
    expect(retried).toEqual(first);
    expect(await git(retried.workingDirectory, ["rev-parse", "HEAD"])).toBe(
      base
    );
    expect(
      await readFile(join(retried.workingDirectory, "tracked.txt"), "utf8")
    ).toBe("committed source\n");
  });

  it("refuses preparation while another live materialization owns the lock", async () => {
    await initializeRepository();
    const lock = await acquireLock({
      openMeldProfileId: "execution-context-workspaces",
      key: context.id,
      pathResolution: { env: { OPENMELD_HOME: ledger } },
    });
    try {
      await expect(prepare()).rejects.toMatchObject({
        code: "openmeld.locked",
      });
      await expect(
        stat(join(ledger, "execution-context-workspaces", context.id))
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await releaseLock(lock);
    }
    expect((await prepare()).baseCommit).toBeTruthy();
  });

  it("reclaims both pristine Git copies only after quiescence and restores the exact native workspace on demand", async () => {
    const base = await initializeRepository();
    const first = await prepare();
    const use = await markExecutionContextWorkspaceInUse({
      ledgerRootPath: ledger,
      context,
    });
    await expect(prepare()).rejects.toMatchObject({ code: "openmeld.locked" });
    expect(
      await releaseExecutionContextWorkspace({
        ledgerRootPath: ledger,
        context,
        ownedProcessesQuiescent: true,
        use,
      })
    ).toEqual({ status: "released" });
    await expect(stat(first.boundaryRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      await readExecutionContextWorkspace({
        ledgerRootPath: ledger,
        contextId: context.id,
      })
    ).toEqual(first);
    await writeFile(join(source, "tracked.txt"), "later source commit\n");
    await git(source, ["commit", "-am", "Move source"]);
    expect(
      await prepare({
        context: {
          ...context,
          nativeConversationId: "retained-native",
          runtimeWorkspaceFingerprint: "retained-workspace",
        },
      })
    ).toEqual(first);
    expect(await git(first.workingDirectory, ["rev-parse", "HEAD"])).toBe(base);
    expect(
      await readdir(join(ledger, "execution-context-workspace-records"))
    ).toEqual([`${context.id}.json`]);
  });

  it("reconciles a lost exit observation only after the durable supervised invocation is absent", async () => {
    await initializeRepository();
    const first = await prepare();
    const use = await markExecutionContextWorkspaceInUse({
      ledgerRootPath: ledger,
      context,
    });
    if (!use) {
      throw new Error("project invocation lock required");
    }
    const child = spawn(
      process.execPath,
      ["-e", "process.send('ready'); setInterval(() => {}, 1000)"],
      {
        env: {
          ...process.env,
          OPENMELD_PROCESS_SUPERVISION_ID: use.processSupervisionId,
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        detached: true,
      }
    );
    try {
      await once(child, "message");
      await writeFile(
        join(first.workingDirectory, "output.txt"),
        "retained task output"
      );
      expect(
        await releaseExecutionContextWorkspace({
          ledgerRootPath: ledger,
          context,
          use,
          ownedProcessesQuiescent: false,
        })
      ).toEqual({
        status: "retained",
        reason: "execution_quiescence_unconfirmed",
      });
      await expect(prepare()).rejects.toThrow(
        "workspace_execution_quiescence_unconfirmed"
      );
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
      expect(
        await prepare({
          context: { ...context, nativeConversationId: "same-native" },
        })
      ).toEqual(first);
      expect(
        await readFile(join(first.workingDirectory, "output.txt"), "utf8")
      ).toBe("retained task output");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      await releaseLock(use.lock);
    }
  });

  it("clears a pre-launch failure fence without requiring an exit from a process that never started", async () => {
    await initializeRepository();
    const first = await prepare();
    const use = await markExecutionContextWorkspaceInUse({
      ledgerRootPath: ledger,
      context,
    });
    await releaseExecutionContextWorkspace({
      ledgerRootPath: ledger,
      context,
      use,
      ownedProcessesQuiescent: false,
    });
    expect(await prepare()).toEqual(first);
  });

  it("reads an old v1 association without inventing a pristine baseline and publishes only v2 lifecycle updates", async () => {
    await initializeRepository();
    const first = await prepare();
    const path = join(
      ledger,
      "execution-context-workspace-records",
      `${context.id}.json`
    );
    const { pristineFingerprint, processSupervisionId, ...old } = JSON.parse(
      await readFile(path, "utf8")
    );
    await writeFile(path, JSON.stringify({ ...old, version: 1 }));
    expect(await prepare()).toEqual(first);
    const use = await markExecutionContextWorkspaceInUse({
      ledgerRootPath: ledger,
      context,
    });
    expect(
      await releaseExecutionContextWorkspace({
        ledgerRootPath: ledger,
        context,
        use,
        ownedProcessesQuiescent: true,
      })
    ).toEqual({ status: "retained", reason: "baseline_unverified" });
    expect(JSON.parse(await readFile(path, "utf8")).version).toBe(2);
    expect(
      await readFile(join(first.workingDirectory, "tracked.txt"), "utf8")
    ).toBe("committed source\n");
  });

  it.each([
    "before rename",
    "after rename",
    "edited retired copy",
    "unexpected live path",
  ])("reconciles retirement interrupted %s without losing continuation data", async (stage) => {
    await initializeRepository();
    const first = await prepare();
    const path = join(
      ledger,
      "execution-context-workspace-records",
      `${context.id}.json`
    );
    const record = JSON.parse(await readFile(path, "utf8"));
    const retired = `${path}.retired-${randomUUID()}`;
    await writeFile(
      path,
      JSON.stringify({
        ...record,
        status: "retiring",
        retirement: {
          path: retired,
          pristineFingerprint: record.pristineFingerprint,
        },
      })
    );
    if (stage !== "before rename") {
      await rename(first.boundaryRoot, retired);
    }
    if (stage === "edited retired copy") {
      await writeFile(
        join(retired, "worktree", "output.txt"),
        "preserve concurrent edit"
      );
    }
    if (stage === "unexpected live path") {
      await mkdir(first.boundaryRoot);
      await writeFile(join(first.boundaryRoot, "user.txt"), "never overwrite");
      await expect(prepare()).rejects.toThrow("workspace_release_incomplete");
      expect(await readFile(join(first.boundaryRoot, "user.txt"), "utf8")).toBe(
        "never overwrite"
      );
      expect(
        await readFile(join(retired, "worktree", "tracked.txt"), "utf8")
      ).toBe("committed source\n");
      return;
    }
    expect(
      await prepare({
        context: { ...context, nativeConversationId: "same-native" },
      })
    ).toEqual(first);
    expect(
      await readFile(join(first.workingDirectory, "tracked.txt"), "utf8")
    ).toBe("committed source\n");
    if (stage === "edited retired copy") {
      expect(
        await readFile(join(first.workingDirectory, "output.txt"), "utf8")
      ).toBe("preserve concurrent edit");
    }
    await expect(stat(retired)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    "tracked edit",
    "untracked",
    "ignored",
    "commit",
    "metadata",
  ])("retains %s after quiescence and allows exact continuation", async (kind) => {
    await initializeRepository();
    const first = await prepare();
    const use = await markExecutionContextWorkspaceInUse({
      ledgerRootPath: ledger,
      context,
    });
    const filename =
      ({ ignored: ".env", untracked: "output.txt" } as Record<string, string>)[
        kind
      ] ?? "tracked.txt";
    const file =
      kind === "metadata"
        ? join(first.boundaryRoot, "repository.git", "user-notes")
        : join(first.workingDirectory, filename);
    await writeFile(file, "keep task data\n");
    if (kind === "commit") {
      await git(first.workingDirectory, ["commit", "-am", "Task output"]);
    }
    const head = await git(first.workingDirectory, ["rev-parse", "HEAD"]);
    expect(
      await releaseExecutionContextWorkspace({
        ledgerRootPath: ledger,
        context,
        ownedProcessesQuiescent: true,
        use,
      })
    ).toEqual({ status: "retained", reason: "workspace_changed" });
    expect(await prepare()).toEqual(first);
    expect(await readFile(file, "utf8")).toBe("keep task data\n");
    expect(await git(first.workingDirectory, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("fails exact restore when the frozen source commit disappears instead of selecting current HEAD", async () => {
    await initializeRepository();
    const first = await prepare();
    await releaseExecutionContextWorkspace({
      ledgerRootPath: ledger,
      context,
      ownedProcessesQuiescent: true,
    });
    await rm(join(source, ".git"), { recursive: true });
    await expect(
      prepare({
        context: { ...context, nativeConversationId: "retained-native" },
      })
    ).rejects.toThrow("workspace_base_commit_unavailable");
    await expect(stat(first.boundaryRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("materializes independent real worktrees from committed source without shared Git metadata or local secrets", async () => {
    const commit = await initializeRepository();
    const sourceWorktrees = await git(source, [
      "worktree",
      "list",
      "--porcelain",
    ]);
    await writeFile(join(source, "tracked.txt"), "uncommitted source\n");
    await writeFile(
      join(source, "untracked.txt"),
      "private untracked content\n"
    );
    await writeFile(join(source, ".env"), "private ignored content\n");
    const first = await prepare();
    expect(
      await readExecutionContextWorkspace({
        ledgerRootPath: ledger,
        contextId: context.id,
      })
    ).toEqual(first);
    const second = await prepare({
      context: {
        ...context,
        id: "22222222-2222-4222-8222-222222222222",
        access: "read_only",
      },
    });
    expect(first).toEqual({
      workingDirectory: join(
        ledger,
        "execution-context-workspaces",
        context.id,
        "worktree"
      ),
      boundaryRoot: join(ledger, "execution-context-workspaces", context.id),
      sourceWorkingDirectory: source,
      baseCommit: commit,
    });
    for (const workspace of [first, second]) {
      expect(
        await readFile(join(workspace.workingDirectory, "tracked.txt"), "utf8")
      ).toBe("committed source\n");
      expect(await readdir(workspace.workingDirectory)).not.toContain(
        "untracked.txt"
      );
      expect(await readdir(workspace.workingDirectory)).not.toContain(".env");
      const common = await git(workspace.workingDirectory, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]);
      expect(common).toBe(join(workspace.boundaryRoot, "repository.git"));
      await expect(
        stat(join(common, "objects", "info", "alternates"))
      ).rejects.toMatchObject({ code: "ENOENT" });
      for (const file of await readdir(join(common, "objects", "pack"))) {
        expect((await stat(join(common, "objects", "pack", file))).nlink).toBe(
          1
        );
      }
    }
    await writeFile(
      join(first.workingDirectory, "tracked.txt"),
      "first task edit\n"
    );
    expect(
      await readFile(join(second.workingDirectory, "tracked.txt"), "utf8")
    ).toBe("committed source\n");
    expect(await readFile(join(source, "tracked.txt"), "utf8")).toBe(
      "uncommitted source\n"
    );
    expect(await git(source, ["worktree", "list", "--porcelain"])).toBe(
      sourceWorktrees
    );
  });

  it("freezes the committed base and preserves task edits and commits on retry", async () => {
    const base = await initializeRepository();
    const first = await prepare();
    await writeFile(
      join(first.workingDirectory, "tracked.txt"),
      "task committed edit\n"
    );
    await git(first.workingDirectory, ["add", "tracked.txt"]);
    await git(first.workingDirectory, ["commit", "-m", "Task commit"]);
    const taskCommit = await git(first.workingDirectory, ["rev-parse", "HEAD"]);
    await writeFile(
      join(first.workingDirectory, "task.txt"),
      "retained uncommitted task\n"
    );
    await writeFile(join(source, "tracked.txt"), "new source commit\n");
    await git(source, ["add", "tracked.txt"]);
    await git(source, ["commit", "-m", "Move source HEAD"]);
    expect(
      await prepare({
        context: {
          ...context,
          nativeConversationId: "retained-native",
          runtimeWorkspaceFingerprint: "retained-fingerprint",
        },
      })
    ).toEqual(first);
    expect(first.baseCommit).toBe(base);
    expect(await git(first.workingDirectory, ["rev-parse", "HEAD"])).toBe(
      taskCommit
    );
    expect(
      await readFile(join(first.workingDirectory, "task.txt"), "utf8")
    ).toBe("retained uncommitted task\n");
    const record = JSON.parse(
      await readFile(
        join(
          ledger,
          "execution-context-workspace-records",
          `${context.id}.json`
        ),
        "utf8"
      )
    );
    expect(record).toMatchObject({
      sourceWorkingDirectory: source,
      baseCommit: base,
      copiedUncommittedFiles: false,
      status: "completed",
    });
    await expect(
      prepare({
        context: {
          ...context,
          scope: { ...context.scope, spaceId: "other-space" },
        },
      })
    ).rejects.toThrow("workspace_identity_mismatch");
  });

  it.each([
    "ancestor",
    "descendant",
    "outside",
  ])("rejects %s policy denial before inspecting Git or creating the destination", async (kind) => {
    await symlink(join(root, "unavailable-private-git"), join(source, ".git"));
    const folder = kind === "ancestor" ? root : join(source, "private");
    const policy: ComputerFileAccessPolicy =
      kind === "outside"
        ? {
            ...defaultPolicy,
            mode: "only_selected_folders",
            folders: [join(root, "other")],
          }
        : {
            ...defaultPolicy,
            mode: "block_selected_folders",
            folders: [folder],
          };
    await expect(prepare({ policy })).rejects.toThrow(
      kind === "outside"
        ? "workspace_outside_computer_policy"
        : "workspace_overlaps_blocked_folder"
    );
    await expect(stat(ledger)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts an explicitly selected linked source worktree and checks its whole root", async () => {
    const base = await initializeRepository();
    const linked = join(root, "linked");
    await git(source, ["worktree", "add", "--detach", linked, base]);
    const result = await prepare({
      currentWorkingDirectory: linked,
      policy: {
        ...defaultPolicy,
        mode: "only_selected_folders",
        folders: [linked],
      },
    });
    expect(result.sourceWorkingDirectory).toBe(linked);
    expect(
      await readFile(join(result.workingDirectory, "tracked.txt"), "utf8")
    ).toBe("committed source\n");
    await expect(
      prepare({
        currentWorkingDirectory: linked,
        policy: {
          ...defaultPolicy,
          mode: "block_selected_folders",
          folders: [join(linked, "private")],
        },
      })
    ).rejects.toThrow("workspace_overlaps_blocked_folder");
  });

  it.each([
    "plain folder",
    "repository subfolder",
    "empty repository",
  ])("rejects an isolated %s instead of escalating or copying arbitrary files", async (kind) => {
    if (kind === "repository subfolder") {
      await initializeRepository();
      source = join(source, "subfolder");
      await mkdir(source);
    } else if (kind === "empty repository") {
      await git(source, ["init", "--template="]);
    }
    await expect(prepare()).rejects.toThrow(
      kind === "empty repository"
        ? "project_commit_required"
        : "project_repository_required"
    );
    await expect(
      stat(join(ledger, "execution-context-workspaces", context.id))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates an empty Space context and returns the canonical current directory without copying", async () => {
    const current = await prepare({
      context: { ...context, workspace: "current" },
    });
    expect(current).toEqual({ workingDirectory: source, boundaryRoot: source });
    await expect(stat(ledger)).rejects.toMatchObject({ code: "ENOENT" });
    const space = await prepare({
      context: { ...context, access: "space_context" },
    });
    expect(space.workingDirectory).toBe(
      join(ledger, "execution-context-workspaces", context.id)
    );
    expect(space.boundaryRoot).toBe(space.workingDirectory);
    expect(await readdir(space.workingDirectory)).toEqual([]);
    expect(
      await readExecutionContextWorkspace({
        ledgerRootPath: ledger,
        contextId: context.id,
      })
    ).toEqual(space);
    expect(
      await prepare({ context: { ...context, access: "space_context" } })
    ).toEqual(space);
  });

  it.each([
    "context root",
    "worktree",
    "repository",
    "registry root",
    "git file",
    "record file",
  ])("refuses a replaced %s symlink without touching its target", async (kind) => {
    await initializeRepository();
    const first = await prepare();
    let path = first.boundaryRoot;
    if (kind === "worktree") {
      path = first.workingDirectory;
    } else if (kind === "repository") {
      path = join(first.boundaryRoot, "repository.git");
    } else if (kind === "registry root") {
      path = join(ledger, "execution-context-workspaces");
    } else if (kind === "git file") {
      path = join(first.workingDirectory, ".git");
    } else if (kind === "record file") {
      path = join(
        ledger,
        "execution-context-workspace-records",
        `${context.id}.json`
      );
    }
    await rename(path, `${path}-retained`);
    await symlink(source, path);
    await expect(prepare()).rejects.toThrow("workspace_is_symlink");
    await expect(
      readExecutionContextWorkspace({
        ledgerRootPath: ledger,
        contextId: context.id,
      })
    ).rejects.toThrow("workspace_is_symlink");
    expect(await readFile(join(source, "tracked.txt"), "utf8")).toBe(
      "committed source\n"
    );
  });

  it.each([
    "record missing",
    "directory missing",
    "creation incomplete",
    "unknown directory",
  ])("retains evidence and refuses recreation when %s", async (kind) => {
    await initializeRepository();
    if (kind === "record missing") {
      await expect(
        prepare({
          context: { ...context, runtimeWorkspaceFingerprint: "retained" },
        })
      ).rejects.toThrow("workspace_record_missing");
      return;
    }
    if (kind === "unknown directory") {
      const unknown = join(ledger, "execution-context-workspaces", context.id);
      await mkdir(unknown, { recursive: true });
      await writeFile(join(unknown, "user.txt"), "preserve me");
      await expect(prepare()).rejects.toThrow("workspace_already_exists");
      expect(await readFile(join(unknown, "user.txt"), "utf8")).toBe(
        "preserve me"
      );
      return;
    }
    const first = await prepare();
    if (kind === "directory missing") {
      await rename(
        first.workingDirectory,
        `${first.workingDirectory}-retained`
      );
      await expect(
        prepare({
          context: { ...context, runtimeWorkspaceFingerprint: "retained" },
        })
      ).rejects.toThrow("workspace_directory_unavailable");
      await expect(stat(first.workingDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
      return;
    }
    const path = join(
      ledger,
      "execution-context-workspace-records",
      `${context.id}.json`
    );
    const record = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...record, status: "preparing" }));
    await writeFile(
      join(first.workingDirectory, "user.txt"),
      "uncertain task effects"
    );
    await expect(prepare()).rejects.toThrow("workspace_creation_incomplete");
    expect(
      await readFile(join(first.workingDirectory, "user.txt"), "utf8")
    ).toBe("uncertain task effects");
  });

  it("ignores inherited Git routing, global filters and hooks while materializing committed files", async () => {
    await initializeRepository();
    await writeFile(
      join(source, ".gitattributes"),
      "tracked.txt filter=untrusted\n"
    );
    await git(source, ["add", ".gitattributes"]);
    await git(source, ["commit", "-m", "Tracked filter attributes"]);
    const globalConfig = join(root, "global.gitconfig");
    const hooks = join(root, "hooks");
    await mkdir(hooks);
    const marker = join(root, "hook-executed");
    await writeFile(
      join(hooks, "post-checkout"),
      `#!/bin/sh\ntouch '${marker}'\n`,
      { mode: 0o700 }
    );
    await writeFile(
      globalConfig,
      `[core]\n hooksPath = ${hooks}\n[filter "untrusted"]\n smudge = echo altered-by-filter\n required = true\n`
    );
    vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);
    vi.stubEnv("GIT_DIR", join(root, "wrong-repository"));
    vi.stubEnv("GIT_WORK_TREE", join(root, "wrong-worktree"));
    vi.stubEnv("GIT_OBJECT_DIRECTORY", join(root, "wrong-objects"));
    const result = await prepare();
    expect(
      await readFile(join(result.workingDirectory, "tracked.txt"), "utf8")
    ).toBe("committed source\n");
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(root, "wrong-objects"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects context path traversal before creating any workspace", async () => {
    await expect(
      prepare({ context: { ...context, id: "../../outside" } })
    ).rejects.toThrow("invalid_workspace_context");
    await expect(stat(ledger)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns no retained workspace without a manifest and never creates directories during lookup", async () => {
    expect(
      await readExecutionContextWorkspace({
        ledgerRootPath: ledger,
        contextId: context.id,
      })
    ).toBeNull();
    await expect(stat(ledger)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    "identity",
    "path",
    "status",
  ])("rejects a retained manifest with changed %s", async (kind) => {
    await initializeRepository();
    await prepare();
    const path = join(
      ledger,
      "execution-context-workspace-records",
      `${context.id}.json`
    );
    const record = JSON.parse(await readFile(path, "utf8"));
    if (kind === "identity") {
      record.identity.id = "22222222-2222-4222-8222-222222222222";
    } else if (kind === "path") {
      record.workingDirectory = source;
    } else {
      record.status = "preparing";
    }
    await writeFile(path, JSON.stringify(record));
    await expect(
      readExecutionContextWorkspace({
        ledgerRootPath: ledger,
        contextId: context.id,
      })
    ).rejects.toThrow(
      kind === "status"
        ? "workspace_creation_incomplete"
        : "workspace_identity_mismatch"
    );
  });

  it.each([
    "worktree pointer",
    "object alternates",
  ])("rejects %s redirected to shared source Git metadata", async (kind) => {
    await initializeRepository();
    const first = await prepare();
    if (kind === "worktree pointer") {
      await writeFile(
        join(first.workingDirectory, ".git"),
        `gitdir: ${join(source, ".git")}\n`
      );
    } else {
      await writeFile(
        join(
          first.boundaryRoot,
          "repository.git",
          "objects",
          "info",
          "alternates"
        ),
        `${join(source, ".git", "objects")}\n`
      );
    }
    await expect(
      readExecutionContextWorkspace({
        ledgerRootPath: ledger,
        contextId: context.id,
      })
    ).rejects.toThrow("workspace_git_metadata_changed");
    expect(await readFile(join(source, "tracked.txt"), "utf8")).toBe(
      "committed source\n"
    );
  });
});
