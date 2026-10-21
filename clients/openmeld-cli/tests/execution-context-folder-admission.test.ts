import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ExecutionContextTask } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertExecutionContextAdmittedFolder,
  executionContextFolderKey,
  resolveExecutionContextAdmissionWithoutFolder,
  resolveExecutionContextFolderAdmission,
  runInLocalAdmissionOrder,
} from "../src/local-service/dispatch/execution-context-folder-admission";
import { captureExecutionContextCompletion } from "../src/local-service/dispatch/execution-context-session";
import { renderSharedFolderSection } from "../src/local-service/dispatch/parse-dispatch-task";

const execFileAsync = promisify(execFile);

const baseContext: ExecutionContextTask = {
  version: 1,
  id: "22222222-2222-4222-8222-222222222222",
  access: "workspace",
  workspace: "current",
  scope: {
    organizationId: "org",
    requesterProfileId: "colleague",
    spaceId: "space",
    targetProfileId: "agent",
    threadId: null,
  },
  nativeConversationId: null,
  runtimeWorkspaceFingerprint: null,
};

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function createFolder(kind: "git" | "plain"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openmeld-folder-admission-"));
  roots.push(root);
  const folder = join(root, "work");
  await mkdir(folder);
  if (kind === "git") {
    const git = (args: string[]) =>
      execFileAsync("git", args, {
        cwd: folder,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Test",
          GIT_AUTHOR_EMAIL: "test@example.com",
          GIT_COMMITTER_NAME: "Test",
          GIT_COMMITTER_EMAIL: "test@example.com",
        },
      });
    await git(["init", "--quiet"]);
    await writeFile(join(folder, "README.md"), "hello\n");
    await git(["add", "README.md"]);
    await git(["commit", "--quiet", "-m", "init"]);
  }
  return await realpath(folder);
}

describe("Execution Context folder admission", () => {
  it("resolves a non-owner default to an isolated copy of a git folder", async () => {
    const folder = await createFolder("git");
    const admission = await resolveExecutionContextFolderAdmission({
      context: { ...baseContext, workspaceDefault: "isolated_if_git" },
      resolveFolder: async () => folder,
    });
    expect(admission.context).toEqual({
      ...baseContext,
      workspace: "isolated",
    });
    expect(admission.context).not.toHaveProperty("workspaceDefault");
    expect(admission.workspaceChosen).toBe(true);
    expect(admission.folderKey).toBe(executionContextFolderKey(folder));
  });

  it("keeps direct edit for a non-owner default when the folder is not a git repository", async () => {
    const folder = await createFolder("plain");
    const admission = await resolveExecutionContextFolderAdmission({
      context: { ...baseContext, workspaceDefault: "isolated_if_git" },
      resolveFolder: async () => folder,
    });
    expect(admission.context?.workspace).toBe("current");
    expect(admission.workspaceChosen).toBe(true);
  });

  it("keeps the owner's direct edit in a git folder (no default from Core)", async () => {
    const folder = await createFolder("git");
    const admission = await resolveExecutionContextFolderAdmission({
      context: baseContext,
      resolveFolder: async () => folder,
    });
    expect(admission.context).toEqual(baseContext);
    expect(admission.workspaceChosen).toBe(false);
    expect(admission.folderKey).toBe(executionContextFolderKey(folder));
    expect(admission.folderRoots).toContain(folder);
  });

  it("leaves a task without an Execution Context to its route's legacy claim", async () => {
    let resolved = false;
    const admission = await resolveExecutionContextFolderAdmission({
      resolveFolder: () => {
        resolved = true;
        return Promise.resolve("/unused");
      },
    });
    expect(admission).toEqual({ context: undefined, workspaceChosen: false });
    expect(resolved).toBe(false);
  });

  it("gives Space-only work no folder and drops a stray workspace default", () => {
    const admission = resolveExecutionContextAdmissionWithoutFolder({
      ...baseContext,
      access: "space_context",
      workspace: "isolated",
      workspaceDefault: "isolated_if_git",
    });
    expect(admission.context).not.toHaveProperty("workspaceDefault");
    expect(admission.folderKey).toBeUndefined();
  });

  it("keeps a pending default undecided when the folder is unresolved, so the run fails closed", async () => {
    const admission = await resolveExecutionContextFolderAdmission({
      context: { ...baseContext, workspaceDefault: "isolated_if_git" },
      resolveFolder: () =>
        Promise.reject(new Error("profile.workspace.missing")),
    });
    expect(admission.folderKey).toBeUndefined();
    expect(admission.workspaceChosen).toBe(true);
    // The folder recovers before the run: it must not edit it directly.
    const folder = await createFolder("git");
    await expect(
      assertExecutionContextAdmittedFolder({
        admission,
        context: admission.context,
        workingDirectory: folder,
      })
    ).rejects.toMatchObject({
      code: "execution_context.folder_changed_while_queued",
    });
  });

  it("isolates a git repository even when an isolated copy cannot be made yet", async () => {
    const folder = await createFolder("plain");
    await execFileAsync("git", ["init", "--quiet"], { cwd: folder });
    const admission = await resolveExecutionContextFolderAdmission({
      context: { ...baseContext, workspaceDefault: "isolated_if_git" },
      resolveFolder: async () => folder,
    });
    expect(admission.context?.workspace).toBe("isolated");
  });

  it("fails closed when the task would run in another folder than it was admitted with", async () => {
    const admitted = await createFolder("plain");
    const other = await createFolder("plain");
    const admission = {
      folderKey: executionContextFolderKey(admitted),
      workspaceChosen: false,
    };
    await expect(
      assertExecutionContextAdmittedFolder({
        admission,
        context: baseContext,
        workingDirectory: admitted,
      })
    ).resolves.toBe(admitted);
    const failure = assertExecutionContextAdmittedFolder({
      admission,
      context: baseContext,
      workingDirectory: other,
    });
    await expect(failure).rejects.toMatchObject({
      code: "execution_context.folder_changed_while_queued",
    });
    await expect(failure).rejects.not.toThrow(other);
  });

  it("reports a vanished folder without its path and continues in the canonical folder", async () => {
    const admitted = await createFolder("plain");
    const alias = join(admitted, "..", "alias");
    await symlink(admitted, alias);
    const admission = {
      folderKey: executionContextFolderKey(admitted),
      workspaceChosen: false,
    };
    await expect(
      assertExecutionContextAdmittedFolder({
        admission,
        context: baseContext,
        workingDirectory: alias,
      })
    ).resolves.toBe(admitted);
    const missing = join(admitted, "..", "missing");
    const failure = assertExecutionContextAdmittedFolder({
      admission,
      context: baseContext,
      workingDirectory: missing,
    });
    await expect(failure).rejects.toMatchObject({
      code: "execution_context.folder_changed_while_queued",
    });
    await expect(failure).rejects.not.toThrow("missing");
  });

  it("reports the chosen workspace in the completion only when the Service chose it", async () => {
    const chosen = await captureExecutionContextCompletion({
      context: { ...baseContext, workspace: "isolated" },
      reportWorkspace: true,
      nativeConversationId: "native",
      agentControllerRef: "builtin:codex",
      workingDirectory: "/tmp/task",
      completedTurnId: null,
      providerSucceeded: false,
    });
    expect(chosen?.workspace).toBe("isolated");
    const assigned = await captureExecutionContextCompletion({
      context: baseContext,
      nativeConversationId: "native",
      agentControllerRef: "builtin:codex",
      workingDirectory: "/tmp/task",
      completedTurnId: null,
      providerSucceeded: false,
    });
    expect(assigned).not.toHaveProperty("workspace");
  });

  it("admits in arrival order while an earlier task's folder is still resolving", async () => {
    const order = {};
    const admitted: string[] = [];
    let releaseFirst: (value: string) => void = () => undefined;
    const firstFolder = new Promise<string>((resolve) => {
      releaseFirst = resolve;
    });
    runInLocalAdmissionOrder({
      order,
      prepare: () => firstFolder,
      ready: () => "never",
      admit: (value) => admitted.push(value),
      onError: () => undefined,
    });
    runInLocalAdmissionOrder({
      order,
      prepare: null,
      ready: () => "second",
      admit: (value) => admitted.push(value),
      onError: () => undefined,
    });
    expect(admitted).toEqual([]);
    releaseFirst("first");
    await expect.poll(() => admitted).toEqual(["first", "second"]);
    runInLocalAdmissionOrder({
      order,
      prepare: null,
      ready: () => "third",
      admit: (value) => admitted.push(value),
      onError: () => undefined,
    });
    expect(admitted).toEqual(["first", "second", "third"]);
  });

  it("lists the other Sessions in the folder without paths or other Space ids", () => {
    const section = renderSharedFolderSection({
      sharedFolderSessions: [
        { executionContextId: "ctx-1", sameSpace: true, targetLabel: "@codex" },
        {
          executionContextId: "ctx-2",
          sameSpace: false,
          targetLabel: "@claude",
        },
      ],
    });
    expect(section).toContain('"@codex", Session ctx-1, in this Space.');
    expect(section).toContain('"@claude", Session ctx-2, in another Space.');
    expect(section).toContain("isolated copy");
    expect(renderSharedFolderSection({ sharedFolderSessions: [] })).toBeNull();
    // A request not verified as the owner's gets no Session ids.
    const forColleague = renderSharedFolderSection({
      sharedFolderSessions: [
        { executionContextId: null, sameSpace: false, targetLabel: "@codex" },
      ],
    });
    expect(forColleague).toContain('"@codex", in another Space.');
    expect(forColleague).not.toContain("Session ");
  });
});
