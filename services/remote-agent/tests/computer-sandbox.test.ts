import type { WorkspaceClient } from "@cloudflare/computer";
import { createSandboxSessionEnv } from "@flue/runtime";
import type { CenterAgentOrganizationDocumentsComputerSnapshotResponse } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
} from "../agent-core/callback-context";
import { createAgentComputerWorkspaceAccess } from "../flue-adapter/agent-computer-workspace-access";
import { buildAgentComputerName } from "../flue-adapter/computer-identity";
import {
  AgentComputerSandboxApi,
  createRemoteAgentComputerCapability,
  instrumentRemoteAgentComputerSandboxApi,
  isRemoteAgentComputerEnabled,
} from "../flue-adapter/computer-sandbox";
import {
  AGENT_COMPUTER_LAYOUT_DIRECTORIES,
  ensureAgentComputerLayout,
  resolveAgentComputerWorkingDirectory,
} from "../flue-adapter/computer-workspace";
import {
  ORGANIZATION_DOCUMENTS_COMPUTER_MANIFEST,
  ORGANIZATION_DOCUMENTS_COMPUTER_ROOT,
} from "../flue-adapter/organization-document-computer-projection";
import { ORGANIZATION_DOCUMENT_COMPUTER_TOOL_NAMES } from "../flue-adapter/organization-document-computer-tools";
import { getRemoteAgentSandboxToolDefinitions } from "../flue-adapter/sandbox-tools";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";

const cloudflareComputerMock = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
}));

vi.mock("@cloudflare/computer", () => ({
  getWorkspace: cloudflareComputerMock.getWorkspace,
}));

const MISSING_COMPUTER_BINDING_RE = /requires the AGENT_COMPUTER binding/u;
const EMPTY_PROFILE_ID_RE = /non-empty agent profile id/u;

beforeEach(() => {
  cloudflareComputerMock.getWorkspace.mockReset();
});

type WorkspaceFakeState = {
  directories: Set<string>;
  files: Map<string, string>;
  modes: Map<string, number>;
};

function createWorkspaceFake(
  state: WorkspaceFakeState = {
    directories: new Set<string>(["/"]),
    files: new Map<string, string>(),
    modes: new Map<string, number>(),
  }
) {
  const { directories, files, modes } = state;
  const dispose = vi.fn();
  const execHandleDispose = vi.fn();
  const fs = {
    chmod: vi.fn((path: string, mode: number) => {
      if (!(files.has(path) || directories.has(path))) {
        return Promise.reject(
          Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" })
        );
      }
      modes.set(path, mode);
      return Promise.resolve();
    }),
    grep: vi.fn(() =>
      Promise.resolve([] as { line: number; path: string; text: string }[])
    ),
    mkdir: vi.fn((path: string) => {
      directories.add(path);
      return Promise.resolve();
    }),
    readFile: vi.fn((path: string, encoding?: unknown) => {
      const content = files.get(path);
      if (content === undefined) {
        return Promise.reject(
          Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" })
        );
      }
      if (encoding === "utf8") {
        return Promise.resolve(content);
      }
      return Promise.resolve(new Blob([content]).stream());
    }),
    readdir: vi.fn(() =>
      Promise.resolve([
        {
          isDirectory: false,
          isFile: true,
          isSymbolicLink: false,
          name: "a.md",
        },
        {
          isDirectory: true,
          isFile: false,
          isSymbolicLink: false,
          name: "sub",
        },
      ])
    ),
    rm: vi.fn((path: string) => {
      for (const file of files.keys()) {
        if (file === path || file.startsWith(`${path}/`)) {
          files.delete(file);
          modes.delete(file);
        }
      }
      for (const directory of directories) {
        if (directory === path || directory.startsWith(`${path}/`)) {
          directories.delete(directory);
          modes.delete(directory);
        }
      }
      return Promise.resolve();
    }),
    stat: vi.fn((path: string) => {
      if (!(files.has(path) || directories.has(path))) {
        return Promise.reject(
          Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" })
        );
      }
      const isDirectory = directories.has(path);
      return Promise.resolve({
        inode: 1,
        isDirectory,
        isFile: !isDirectory,
        isSymbolicLink: false,
        mode: modes.get(path) ?? (isDirectory ? 0o755 : 0o644),
        mtime: TEST_NOW_MS,
        name: path,
        size: files.get(path)?.length ?? 0,
      });
    }),
    writeFile: vi.fn((path: string, content: string | Uint8Array) => {
      files.set(
        path,
        typeof content === "string"
          ? content
          : new TextDecoder().decode(content)
      );
      return Promise.resolve();
    }),
  };
  const runtime = {
    exec: vi.fn(() =>
      Promise.resolve({
        [Symbol.dispose]: execHandleDispose,
        result: () =>
          Promise.resolve({
            exitCode: 0,
            pulled: 0,
            pushed: 0,
            skipped: [],
            status: "completed" as const,
            stderr: "",
            stdout: "hello\n",
          }),
      })
    ),
  };
  return {
    directories,
    dispose,
    execHandleDispose,
    files,
    modes,
    workspace: {
      [Symbol.dispose]: dispose,
      fs,
      runtime,
    } as unknown as WorkspaceClient,
  };
}

function organizationDocumentsSnapshot(): CenterAgentOrganizationDocumentsComputerSnapshotResponse {
  return {
    documents: [
      {
        content: "# Private launch plan\n",
        folderId: null,
        id: "doc_private",
        kind: "knowledge",
        subjectUserId: null,
        title: "Private Launch Plan",
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
    ],
    folders: [],
    organizationId: "org_123",
    revision: "a".repeat(64),
  };
}

function createComputerContext() {
  const request = createSubmitTurnRequest();
  return createRemoteAgentCallbackContext({
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: "request_computer",
      status: "pending",
      submissionId: "submission_computer",
    },
    nowMs: TEST_NOW_MS,
    request,
  });
}

function createOrganizationDocumentsComputerFixture() {
  const fixture = createWorkspaceFake();
  cloudflareComputerMock.getWorkspace.mockResolvedValue(fixture.workspace);
  const centerAgentOrganizationDocumentsComputerSnapshot = vi.fn(() =>
    Promise.resolve(organizationDocumentsSnapshot())
  );
  const coreWorker = {
    centerAgentOrganizationDocumentsComputerSnapshot,
  } satisfies RemoteAgentCoreWorkerBinding;
  const allowedInput = {
    context: createComputerContext(),
    coreWorker,
    env: {
      AGENT_COMPUTER: {
        get: vi.fn(() => ({})),
        idFromName: vi.fn(() => ({})),
      },
    },
    materializeOrganizationDocuments: true,
  };
  return {
    allowedInput,
    centerAgentOrganizationDocumentsComputerSnapshot,
    fixture,
  };
}

describe("Agent computer identity", () => {
  it("keys the computer by the owning agent profile", () => {
    expect(buildAgentComputerName("agt_123")).toBe("agent-computer:agt_123");
  });

  it("rejects an empty agent profile id", () => {
    expect(() => buildAgentComputerName("  ")).toThrow(EMPTY_PROFILE_ID_RE);
  });

  it("enables the computer only when its binding is present", () => {
    expect(isRemoteAgentComputerEnabled({ AGENT_COMPUTER: {} })).toBe(true);
    expect(
      isRemoteAgentComputerEnabled({
        OPENMELD_WORKER_ENVIRONMENT: "local",
      })
    ).toBe(false);
    expect(() =>
      isRemoteAgentComputerEnabled({ OPENMELD_WORKER_ENVIRONMENT: "prod" })
    ).toThrow(MISSING_COMPUTER_BINDING_RE);
  });
});

describe("Agent computer Workspace RPC lifecycle", () => {
  it("disposes a cancelled client and reacquires the same durable identity for continuation", async () => {
    const cancelledWorkspace = createWorkspaceFake();
    const continuationWorkspace = createWorkspaceFake();
    cloudflareComputerMock.getWorkspace
      .mockResolvedValueOnce(cancelledWorkspace.workspace)
      .mockResolvedValueOnce(continuationWorkspace.workspace);
    const durableComputerId = { name: "agent-computer:agt_test" };
    const namespace = {
      get: vi.fn(() => ({})),
      idFromName: vi.fn(() => durableComputerId),
    };
    const access = createAgentComputerWorkspaceAccess({
      computerId: durableComputerId as unknown as DurableObjectId,
      namespace: namespace as unknown as Parameters<
        typeof createAgentComputerWorkspaceAccess
      >[0]["namespace"],
    });
    const controller = new AbortController();
    const stopReason = new Error("Stop requested");
    controller.abort(stopReason);

    await expect(
      access.withWorkspace(() => Promise.reject(controller.signal.reason))
    ).rejects.toBe(stopReason);
    await expect(
      access.withWorkspace(() => Promise.resolve("continued"))
    ).resolves.toBe("continued");

    expect(namespace.get).toHaveBeenNthCalledWith(1, durableComputerId);
    expect(namespace.get).toHaveBeenNthCalledWith(2, durableComputerId);
    expect(cancelledWorkspace.dispose).toHaveBeenCalledOnce();
    expect(continuationWorkspace.dispose).toHaveBeenCalledOnce();
  });

  it("disposes both the exec handle and workspace client when command results reject", async () => {
    const failedWorkspace = createWorkspaceFake();
    const commandFailure = new Error("Computer command failed");
    const runtimeExec = (
      failedWorkspace.workspace.runtime as unknown as {
        exec: ReturnType<typeof vi.fn>;
      }
    ).exec;
    runtimeExec.mockResolvedValueOnce({
      [Symbol.dispose]: failedWorkspace.execHandleDispose,
      result: () => Promise.reject(commandFailure),
    });
    cloudflareComputerMock.getWorkspace.mockResolvedValueOnce(
      failedWorkspace.workspace
    );
    const durableComputerId = { name: "agent-computer:agt_test" };
    const workspaceAccess = createAgentComputerWorkspaceAccess({
      computerId: durableComputerId as unknown as DurableObjectId,
      namespace: {
        get: vi.fn(() => ({})),
        idFromName: vi.fn(() => durableComputerId),
      } as unknown as Parameters<
        typeof createAgentComputerWorkspaceAccess
      >[0]["namespace"],
    });

    await expect(
      new AgentComputerSandboxApi(workspaceAccess).exec("exit 1")
    ).rejects.toBe(commandFailure);

    expect(failedWorkspace.execHandleDispose).toHaveBeenCalledOnce();
    expect(failedWorkspace.dispose).toHaveBeenCalledOnce();
  });
});

describe("Agent computer layout", () => {
  it("creates the base layout and the Space working directory", async () => {
    const { directories, workspace } = createWorkspaceFake();

    const { workingDirectory } = await ensureAgentComputerLayout(workspace, {
      spaceId: "space-1",
    });

    expect(workingDirectory).toBe("/computer/spaces/space-1");
    for (const directory of AGENT_COMPUTER_LAYOUT_DIRECTORIES) {
      expect(directories.has(directory)).toBe(true);
    }
    expect(directories.has("/computer/spaces/space-1")).toBe(true);
  });

  it("falls back to the home directory without a Space id", async () => {
    const { workspace } = createWorkspaceFake();

    const { workingDirectory } = await ensureAgentComputerLayout(workspace, {
      spaceId: null,
    });

    expect(workingDirectory).toBe("/computer/home");
  });

  it("keeps each Center Agent Task in its own durable working directory", async () => {
    const { directories, workspace } = createWorkspaceFake();

    const firstAttempt = await ensureAgentComputerLayout(workspace, {
      conversationId: "center-agent-task:task 123/launch",
      spaceId: "space-1",
    });
    const retryAttempt = await ensureAgentComputerLayout(workspace, {
      conversationId: "center-agent-task:task 123/launch",
      spaceId: "space-2",
    });

    expect(firstAttempt.workingDirectory).toBe(
      "/computer/tasks/task%20123%2Flaunch"
    );
    expect(retryAttempt.workingDirectory).toBe(firstAttempt.workingDirectory);
    expect(directories.has(firstAttempt.workingDirectory)).toBe(true);
  });

  it("keeps Routine runs together without mixing them into the destination Space", () => {
    expect(
      resolveAgentComputerWorkingDirectory({
        routineId: "routine-weekly",
        spaceId: "space-reports",
      })
    ).toBe("/computer/routines/routine-weekly");
    expect(
      resolveAgentComputerWorkingDirectory({
        conversationId: "center-agent-task:task-one",
        routineId: "routine-weekly",
        spaceId: "space-reports",
      })
    ).toBe("/computer/tasks/task-one");
  });
});

describe("Organization Documents computer scope", () => {
  it("reacquires the same durable computer and idempotently finishes a disconnected projection", async () => {
    const oldProjectionPath = `${ORGANIZATION_DOCUMENTS_COMPUTER_ROOT}/stale.md`;
    const state = {
      directories: new Set<string>(["/", ORGANIZATION_DOCUMENTS_COMPUTER_ROOT]),
      files: new Map<string, string>([[oldProjectionPath, "# Stale\n"]]),
      modes: new Map<string, number>(),
    };
    const firstWorkspace = createWorkspaceFake(state);
    const replacementWorkspace = createWorkspaceFake(state);
    const disconnected = new Error(
      "Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request."
    );
    const firstRm = (
      firstWorkspace.workspace.fs as unknown as {
        rm: ReturnType<typeof vi.fn>;
      }
    ).rm;
    firstRm.mockImplementationOnce((path: string) => {
      for (const file of state.files.keys()) {
        if (file === path || file.startsWith(`${path}/`)) {
          state.files.delete(file);
        }
      }
      for (const directory of state.directories) {
        if (directory === path || directory.startsWith(`${path}/`)) {
          state.directories.delete(directory);
        }
      }
      return Promise.reject(disconnected);
    });
    cloudflareComputerMock.getWorkspace
      .mockResolvedValueOnce(firstWorkspace.workspace)
      .mockResolvedValueOnce(replacementWorkspace.workspace);
    const durableComputerId = { name: "agent-computer:agt_test" };
    const namespace = {
      get: vi.fn(() => ({})),
      idFromName: vi.fn(() => durableComputerId),
    };
    const centerAgentOrganizationDocumentsComputerSnapshot = vi.fn(() =>
      Promise.resolve(organizationDocumentsSnapshot())
    );

    const capability = await createRemoteAgentComputerCapability({
      context: createComputerContext(),
      coreWorker: {
        centerAgentOrganizationDocumentsComputerSnapshot,
      },
      env: { AGENT_COMPUTER: namespace },
      materializeOrganizationDocuments: true,
    });

    expect(namespace.idFromName).toHaveBeenCalledOnce();
    expect(namespace.get).toHaveBeenCalledTimes(2);
    expect(namespace.get).toHaveBeenNthCalledWith(1, durableComputerId);
    expect(namespace.get).toHaveBeenNthCalledWith(2, durableComputerId);
    expect(cloudflareComputerMock.getWorkspace).toHaveBeenCalledTimes(2);
    expect(
      centerAgentOrganizationDocumentsComputerSnapshot
    ).toHaveBeenCalledOnce();
    expect(firstWorkspace.dispose).toHaveBeenCalledOnce();
    expect(replacementWorkspace.dispose).toHaveBeenCalledOnce();
    expect(state.files.has(oldProjectionPath)).toBe(false);
    expect(
      state.files.has(
        `${ORGANIZATION_DOCUMENTS_COMPUTER_ROOT}/Private-Launch-Plan--doc_private.md`
      )
    ).toBe(true);
    expect(
      ORGANIZATION_DOCUMENT_COMPUTER_TOOL_NAMES.every((toolName) =>
        capability.definitions.some(
          (definition) => definition.name === toolName
        )
      )
    ).toBe(true);
  });

  it("uses a fresh disposable workspace client for later Computer operations", async () => {
    const materializationWorkspace = createWorkspaceFake();
    const toolWorkspace = createWorkspaceFake();
    cloudflareComputerMock.getWorkspace
      .mockResolvedValueOnce(materializationWorkspace.workspace)
      .mockResolvedValueOnce(toolWorkspace.workspace);
    const namespace = {
      get: vi.fn(() => ({})),
      idFromName: vi.fn(() => ({})),
    };
    const capability = await createRemoteAgentComputerCapability({
      context: createComputerContext(),
      coreWorker: {
        centerAgentOrganizationDocumentsComputerSnapshot: vi.fn(() =>
          Promise.resolve(organizationDocumentsSnapshot())
        ),
      },
      env: { AGENT_COMPUTER: namespace },
      materializeOrganizationDocuments: true,
    });
    const grep = capability.definitions.find(
      (definition) => definition.name === "grep"
    );
    if (!grep) {
      throw new Error("grep tool missing");
    }

    await grep.execute({ pattern: "launch" }, undefined);

    expect(cloudflareComputerMock.getWorkspace).toHaveBeenCalledTimes(2);
    expect(materializationWorkspace.dispose).toHaveBeenCalledOnce();
    expect(toolWorkspace.dispose).toHaveBeenCalledOnce();
    expect(
      (
        toolWorkspace.workspace.fs as unknown as {
          grep: ReturnType<typeof vi.fn>;
        }
      ).grep
    ).toHaveBeenCalledOnce();
  });

  it("clears an earlier projection when the current turn cannot materialize documents", async () => {
    const {
      allowedInput,
      centerAgentOrganizationDocumentsComputerSnapshot,
      fixture,
    } = createOrganizationDocumentsComputerFixture();

    const allowed = await createRemoteAgentComputerCapability(allowedInput);

    expect(
      centerAgentOrganizationDocumentsComputerSnapshot
    ).toHaveBeenCalledOnce();
    expect(
      fixture.files.has(
        `${ORGANIZATION_DOCUMENTS_COMPUTER_ROOT}/Private-Launch-Plan--doc_private.md`
      )
    ).toBe(true);
    expect(
      ORGANIZATION_DOCUMENT_COMPUTER_TOOL_NAMES.every((toolName) =>
        allowed.definitions.some((definition) => definition.name === toolName)
      )
    ).toBe(true);

    centerAgentOrganizationDocumentsComputerSnapshot.mockClear();
    const restricted = await createRemoteAgentComputerCapability({
      ...allowedInput,
      materializeOrganizationDocuments: false,
    });

    expect(
      centerAgentOrganizationDocumentsComputerSnapshot
    ).not.toHaveBeenCalled();
    expect(
      [...fixture.files.keys()].filter((path) =>
        path.startsWith(`${ORGANIZATION_DOCUMENTS_COMPUTER_ROOT}/`)
      )
    ).toEqual([]);
    expect(fixture.files.has(ORGANIZATION_DOCUMENTS_COMPUTER_MANIFEST)).toBe(
      false
    );
    expect(fixture.modes.get(ORGANIZATION_DOCUMENTS_COMPUTER_ROOT)).toBe(0o555);
    expect(
      ORGANIZATION_DOCUMENT_COMPUTER_TOOL_NAMES.some((toolName) =>
        restricted.definitions.some(
          (definition) => definition.name === toolName
        )
      )
    ).toBe(false);
  });

  it("fails the turn when an earlier projection cannot be cleared", async () => {
    const {
      allowedInput,
      centerAgentOrganizationDocumentsComputerSnapshot,
      fixture,
    } = createOrganizationDocumentsComputerFixture();
    await createRemoteAgentComputerCapability(allowedInput);
    centerAgentOrganizationDocumentsComputerSnapshot.mockClear();
    const rm = (
      fixture.workspace.fs as unknown as { rm: ReturnType<typeof vi.fn> }
    ).rm;
    rm.mockRejectedValue(new Error("Computer storage unavailable"));

    await expect(
      createRemoteAgentComputerCapability({
        ...allowedInput,
        materializeOrganizationDocuments: false,
      })
    ).rejects.toThrow("Computer storage unavailable");
    expect(
      centerAgentOrganizationDocumentsComputerSnapshot
    ).not.toHaveBeenCalled();
    expect(fixture.dispose).toHaveBeenCalledTimes(3);
  });
});

describe("AgentComputerSandboxApi", () => {
  it("reads and writes durable files, creating parent directories", async () => {
    const { directories, workspace } = createWorkspaceFake();
    const api = new AgentComputerSandboxApi(workspace);

    await api.writeFile("/computer/spaces/space-1/notes/todo.md", "ship it");

    expect(directories.has("/computer/spaces/space-1/notes")).toBe(true);
    await expect(
      api.readFile("/computer/spaces/space-1/notes/todo.md")
    ).resolves.toBe("ship it");
    await expect(
      api.exists("/computer/spaces/space-1/notes/todo.md")
    ).resolves.toBe(true);
    await expect(api.exists("/computer/missing.md")).resolves.toBe(false);
  });

  it("maps workspace stat results onto Flue's FileStat", async () => {
    const { workspace } = createWorkspaceFake();
    const api = new AgentComputerSandboxApi(workspace);
    await api.writeFile("/computer/home/a.txt", "abc");

    const stat = await api.stat("/computer/home/a.txt");

    expect(stat.isFile).toBe(true);
    expect(stat.isDirectory).toBe(false);
    expect(stat.size).toBe(3);
    expect(stat.mtime).toEqual(new Date(TEST_NOW_MS));
  });

  it("preserves workspace failures when checking whether a path exists", async () => {
    const { workspace } = createWorkspaceFake();
    const stat = (workspace.fs as unknown as { stat: ReturnType<typeof vi.fn> })
      .stat;
    const workspaceFailure = Object.assign(new Error("workspace unavailable"), {
      code: "EIO",
    });
    stat.mockRejectedValueOnce(workspaceFailure);
    const api = new AgentComputerSandboxApi(workspace);

    await expect(api.exists("/computer/home/a.txt")).rejects.toBe(
      workspaceFailure
    );
  });

  it("lists directory entry names", async () => {
    const { workspace } = createWorkspaceFake();
    const api = new AgentComputerSandboxApi(workspace);

    await expect(api.readdir("/computer/home")).resolves.toEqual([
      "a.md",
      "sub",
    ]);
  });

  it("runs bash on the worker-shell backend with a bounded timeout", async () => {
    const { execHandleDispose, workspace } = createWorkspaceFake();
    const api = new AgentComputerSandboxApi(workspace);

    const result = await api.exec("echo hello", {
      cwd: "/computer/spaces/space-1",
    });

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "hello\n" });
    expect(
      (workspace.runtime as unknown as { exec: ReturnType<typeof vi.fn> }).exec
    ).toHaveBeenCalledWith("echo hello", {
      backend: "worker-shell",
      cwd: "/computer/spaces/space-1",
      encoding: "utf8",
      env: undefined,
      timeoutMs: 120_000,
    });
    expect(execHandleDispose).toHaveBeenCalledOnce();
  });

  it("routes exec to the container backend when the caller selects it", async () => {
    const { workspace } = createWorkspaceFake();
    const api = new AgentComputerSandboxApi(workspace);

    await api.exec("python3 -V", { backend: "container" });

    expect(
      (workspace.runtime as unknown as { exec: ReturnType<typeof vi.fn> }).exec
    ).toHaveBeenCalledWith("python3 -V", {
      backend: "container",
      cwd: undefined,
      encoding: "utf8",
      env: undefined,
      timeoutMs: 120_000,
    });
  });

  it("kills an in-flight command when the execution is stopped", async () => {
    const { workspace } = createWorkspaceFake();
    const runtimeExec = (
      workspace.runtime as unknown as { exec: ReturnType<typeof vi.fn> }
    ).exec;
    let resolveResult!: (result: {
      exitCode: number;
      pulled: number;
      pushed: number;
      skipped: never[];
      status: "completed";
      stderr: string;
      stdout: string;
    }) => void;
    const resultPromise = new Promise<{
      exitCode: number;
      pulled: number;
      pushed: number;
      skipped: never[];
      status: "completed";
      stderr: string;
      stdout: string;
    }>((resolve) => {
      resolveResult = resolve;
    });
    const kill = vi.fn(() => Promise.resolve());
    const dispose = vi.fn();
    runtimeExec.mockResolvedValueOnce({
      [Symbol.dispose]: dispose,
      kill,
      result: () => resultPromise,
    });
    const api = new AgentComputerSandboxApi(workspace);
    const controller = new AbortController();
    const stopReason = new Error("Stop requested");

    const execution = api.exec("while true; do work; done", {
      signal: controller.signal,
    });
    const stopped = expect(execution).rejects.toBe(stopReason);
    await vi.waitFor(() => expect(runtimeExec).toHaveBeenCalledOnce());
    controller.abort(stopReason);
    resolveResult({
      exitCode: 0,
      pulled: 0,
      pushed: 0,
      skipped: [],
      status: "completed",
      stderr: "",
      stdout: "too late",
    });

    await stopped;
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe("bash tool backend selection", () => {
  it("passes the model-chosen backend through the computer exec channel", async () => {
    const { workspace } = createWorkspaceFake();
    const computerExec = vi.fn(() =>
      Promise.resolve({ exitCode: 0, stderr: "", stdout: "ok\n" })
    );
    const definitions = getRemoteAgentSandboxToolDefinitions({
      computerExec,
      env: createSandboxSessionEnv(
        new AgentComputerSandboxApi(workspace),
        "/computer/spaces/space-1"
      ),
      workingDirectory: "/computer/spaces/space-1",
    });
    const bash = definitions.find((definition) => definition.name === "bash");
    if (!bash) {
      throw new Error("bash tool missing");
    }

    await bash.execute(
      { backend: "container", command: "python3 -V", timeout: 60 },
      undefined
    );

    expect(computerExec).toHaveBeenCalledWith("python3 -V", {
      backend: "container",
      cwd: "/computer/spaces/space-1",
      signal: undefined,
      timeoutMs: 60_000,
    });
  });

  it("rejects an unknown bash backend value", async () => {
    const { workspace } = createWorkspaceFake();
    const definitions = getRemoteAgentSandboxToolDefinitions({
      computerExec: vi.fn(),
      env: createSandboxSessionEnv(
        new AgentComputerSandboxApi(workspace),
        "/computer/spaces/space-1"
      ),
      workingDirectory: "/computer/spaces/space-1",
    });
    const bash = definitions.find((definition) => definition.name === "bash");
    if (!bash) {
      throw new Error("bash tool missing");
    }

    await expect(
      bash.execute({ backend: "warp-drive", command: "ls" }, undefined)
    ).rejects.toThrow();
  });
});

describe("computer-native grep", () => {
  function createGrepTool(
    matches: { line: number; path: string; text: string }[]
  ) {
    const { workspace } = createWorkspaceFake();
    const grep = (workspace.fs as unknown as { grep: ReturnType<typeof vi.fn> })
      .grep;
    grep.mockResolvedValue(matches);
    const definitions = getRemoteAgentSandboxToolDefinitions({
      computerSearch: {
        grep: (pattern, path, options) =>
          workspace.fs.grep(pattern, path, options),
      },
      env: createSandboxSessionEnv(
        new AgentComputerSandboxApi(workspace),
        "/computer/spaces/space-1"
      ),
      workingDirectory: "/computer/spaces/space-1",
    });
    const tool = definitions.find((definition) => definition.name === "grep");
    if (!tool) {
      throw new Error("grep tool missing");
    }
    return { grep, tool };
  }

  it("searches the durable filesystem natively and formats matches", async () => {
    const { grep, tool } = createGrepTool([
      { line: 3, path: "/computer/spaces/space-1/a.md", text: "TODO ship" },
    ]);

    const result = (await tool.execute({ pattern: "TODO" }, undefined)) as {
      matches: string[];
      truncated: boolean;
    };

    expect(grep).toHaveBeenCalledWith(
      "TODO",
      "/computer/spaces/space-1",
      undefined
    );
    expect(result.matches).toEqual([
      "/computer/spaces/space-1/a.md:3:TODO ship",
    ]);
    expect(result.truncated).toBe(false);
  });

  it("escapes literal patterns and resolves relative search paths", async () => {
    const { grep, tool } = createGrepTool([]);

    await tool.execute(
      { literal: true, path: "notes", pattern: "a.b(c)" },
      undefined
    );

    expect(grep).toHaveBeenCalledWith(
      "a\\.b\\(c\\)",
      "/computer/spaces/space-1/notes",
      undefined
    );
  });

  it("filters matches by include pattern and reports truncation", async () => {
    const matches = Array.from({ length: 120 }, (_, index) => ({
      line: index + 1,
      path: `/computer/spaces/space-1/file-${index}.ts`,
      text: "match",
    }));
    matches.push({
      line: 1,
      path: "/computer/spaces/space-1/readme.md",
      text: "match",
    });
    const { tool } = createGrepTool(matches);

    const result = (await tool.execute(
      { include: "*.ts", pattern: "match" },
      undefined
    )) as { matches: string[]; truncated: boolean };

    expect(result.matches).toHaveLength(100);
    expect(result.matches.every((line) => line.includes(".ts:"))).toBe(true);
    expect(result.truncated).toBe(true);
  });
});

describe("computer observability", () => {
  it("emits raw operation usage with the cloudflare_computer provider", async () => {
    const { workspace } = createWorkspaceFake();
    const writeDataPoint = vi.fn();
    const instrumented = instrumentRemoteAgentComputerSandboxApi({
      api: new AgentComputerSandboxApi(workspace),
      context: createComputerContext(),
      env: {
        OPENMELD_OBSERVABILITY: {
          writeDataPoint,
        } as unknown as AnalyticsEngineDataset,
      },
    });

    await instrumented.exec("echo hi", { cwd: "/computer/home" });

    expect(writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        blobs: [
          "remote_agent.tool_usage.v1",
          "bash",
          "cloudflare_computer",
          "exec",
          "succeeded",
          expect.any(String),
        ],
      })
    );
  });
});
