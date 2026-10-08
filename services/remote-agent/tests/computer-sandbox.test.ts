import type { WorkspaceClient } from "@cloudflare/computer";
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
  createRemoteAgentComputerCapability as createComputerCapability,
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
} from "../flue-adapter/organization-document-computer-snapshot";
import { ORGANIZATION_DOCUMENT_COMPUTER_TOOL_NAMES } from "../flue-adapter/organization-document-computer-tools";
import { executionAccessFixture } from "./execution-access-fixture";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";

const cloudflareComputerMock = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
}));

vi.mock("@cloudflare/computer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cloudflare/computer")>()),
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

function createRemoteAgentComputerCapability(
  input: Parameters<typeof createComputerCapability>[0]
) {
  return createComputerCapability({
    ...input,
    coreWorker: {
      authorizeRemoteAgentExecutionAccess: executionAccessFixture(
        input.context
      ),
      ...input.coreWorker,
    },
  });
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
    includeOrganizationDocuments: true,
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

  it("keeps personal DM and Space files in different durable workspaces", () => {
    const directMessage = buildAgentComputerName("agt_123", "dm_1");
    expect(buildAgentComputerName("agt_123", "dm_1")).toBe(directMessage);
    expect(buildAgentComputerName("agt_123", "space_1")).not.toBe(
      directMessage
    );
    expect(buildAgentComputerName("agt_456", "dm_1")).not.toBe(directMessage);
    expect(buildAgentComputerName("agt_123")).not.toBe(directMessage);
    expect(() => buildAgentComputerName("agt_123", " ")).toThrow();
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
    ).toBe("/computer/routines/routine-weekly");
  });
});

describe("Organization Documents computer scope", () => {
  it("declares authorized tools without contacting unavailable Computer, browser or document resources", async () => {
    const get = vi.fn(() => {
      throw new Error("Computer offline");
    });
    const snapshot = vi.fn(() => {
      throw new Error("Document snapshot offline");
    });
    const capability = await createRemoteAgentComputerCapability({
      context: createComputerContext(),
      coreWorker: {
        centerAgentOrganizationDocumentsComputerSnapshot: snapshot,
      },
      env: { AGENT_COMPUTER: { get, idFromName: () => ({}) }, BROWSER: {} },
      includeOrganizationDocuments: true,
    });
    expect(capability.definitions.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "computer",
        "browser_execute",
        "openmeld_checkout_org_document",
      ])
    );
    expect(get).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(cloudflareComputerMock.getWorkspace).not.toHaveBeenCalled();
    const computer = capability.definitions.find(
      (tool) => tool.name === "computer"
    );
    if (!computer) {
      throw new Error("Missing Computer tool");
    }
    await expect(computer.execute({ action: "describe" })).rejects.toThrow(
      "Computer offline"
    );
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("shares successful lazy preparation and can retry failed preparation without replaying an operation", async () => {
    const fixture = createWorkspaceFake();
    cloudflareComputerMock.getWorkspace
      .mockRejectedValueOnce(new Error("Connection closed"))
      .mockRejectedValueOnce(new Error("Connection closed"))
      .mockResolvedValue(fixture.workspace);
    const computerOperation = vi.fn(async () => ({ kind: "capabilities" }));
    const id = { name: "original-computer" };
    const namespace = {
      idFromName: vi.fn(() => id),
      get: vi.fn((_target: unknown) => ({ computerOperation })),
    };
    const capability = await createRemoteAgentComputerCapability({
      context: createComputerContext(),
      coreWorker: {},
      env: { AGENT_COMPUTER: namespace },
      includeOrganizationDocuments: false,
    });
    const computer = capability.definitions.find(
      (tool) => tool.name === "computer"
    );
    if (!computer) {
      throw new Error("Missing Computer tool");
    }
    await expect(computer.execute({ action: "describe" })).rejects.toThrow(
      "Connection closed"
    );
    expect(computerOperation).not.toHaveBeenCalled();
    await Promise.all([
      computer.execute({ action: "describe" }),
      computer.execute({ action: "describe" }),
    ]);
    expect(computerOperation).toHaveBeenCalledTimes(2);
    expect(cloudflareComputerMock.getWorkspace).toHaveBeenCalledTimes(3);
    expect(namespace.idFromName).toHaveBeenCalledOnce();
    expect(namespace.get.mock.calls.every(([target]) => target === id)).toBe(
      true
    );
  });

  it("keeps parallel conversation checkouts independent", async () => {
    const { allowedInput, fixture } =
      createOrganizationDocumentsComputerFixture();
    const envelope = allowedInput.context.turnEnvelope;
    if (!envelope) {
      throw new Error("Expected an admitted turn envelope");
    }
    const [first, second] = await Promise.all([
      createRemoteAgentComputerCapability({
        ...allowedInput,
        context: {
          ...allowedInput.context,
          conversationId: "space-one",
          submissionId: "task-one",
          spaceId: "space-one",
          turnEnvelope: {
            ...envelope,
            space: {
              ...envelope.space,
              id: "space-one",
            },
          },
        },
      }),
      createRemoteAgentComputerCapability({
        ...allowedInput,
        context: {
          ...allowedInput.context,
          conversationId: "space-two",
          submissionId: "task-two",
          spaceId: "space-two",
          turnEnvelope: {
            ...envelope,
            space: {
              ...envelope.space,
              id: "space-two",
            },
          },
        },
      }),
    ]);
    const checkouts = [first, second].map((capability) => {
      const tool = capability.definitions.find(
        (item) => item.name === "openmeld_checkout_org_document"
      );
      if (!tool) {
        throw new Error("Missing checkout tool");
      }
      return tool;
    });
    const copies = await Promise.all(
      checkouts.map(
        async (tool) =>
          (await tool.execute({ documentId: "doc_private" }, undefined)) as {
            path: string;
          }
      )
    );
    const [one, two] = copies;
    if (!(one && two)) {
      throw new Error("Missing checkout results");
    }
    expect(one.path).toContain("/computer/tasks/task-one/");
    expect(two.path).toContain("/computer/tasks/task-two/");
    const original = fixture.files.get(two.path);
    fixture.files.set(one.path, "# First session draft");
    await createRemoteAgentComputerCapability({
      ...allowedInput,
      includeOrganizationDocuments: false,
    });
    expect(fixture.files.get(one.path)).toBe("# First session draft");
    expect(fixture.files.get(two.path)).toBe(original);
    expect(fixture.files.has(ORGANIZATION_DOCUMENTS_COMPUTER_MANIFEST)).toBe(
      false
    );
  });

  it("reacquires the same durable computer after a disconnected layout operation", async () => {
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
    const firstMkdir = (
      firstWorkspace.workspace.fs as unknown as {
        mkdir: ReturnType<typeof vi.fn>;
      }
    ).mkdir;
    firstMkdir.mockRejectedValueOnce(disconnected);
    cloudflareComputerMock.getWorkspace
      .mockResolvedValueOnce(firstWorkspace.workspace)
      .mockResolvedValueOnce(replacementWorkspace.workspace);
    const durableComputerId = { name: "agent-computer:agt_test" };
    const namespace = {
      get: vi.fn(() => ({
        computerOperation: vi.fn(async () => ({ kind: "capabilities" })),
      })),
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
      includeOrganizationDocuments: true,
    });

    expect(namespace.get).not.toHaveBeenCalled();
    expect(
      centerAgentOrganizationDocumentsComputerSnapshot
    ).not.toHaveBeenCalled();
    const computer = capability.definitions.find(
      (definition) => definition.name === "computer"
    );
    if (!computer) {
      throw new Error("Missing Computer tool");
    }
    await computer.execute({ action: "describe" });
    expect(namespace.idFromName).toHaveBeenCalledOnce();
    expect(namespace.get).toHaveBeenCalledTimes(3);
    expect(namespace.get).toHaveBeenNthCalledWith(1, durableComputerId);
    expect(namespace.get).toHaveBeenNthCalledWith(2, durableComputerId);
    expect(cloudflareComputerMock.getWorkspace).toHaveBeenCalledTimes(2);
    expect(
      centerAgentOrganizationDocumentsComputerSnapshot
    ).not.toHaveBeenCalled();
    expect(firstWorkspace.dispose).toHaveBeenCalledOnce();
    expect(replacementWorkspace.dispose).toHaveBeenCalledOnce();
    expect(state.files.has(oldProjectionPath)).toBe(true);
    expect(
      state.files.has(
        `${ORGANIZATION_DOCUMENTS_COMPUTER_ROOT}/Private-Launch-Plan--doc_private.md`
      )
    ).toBe(false);
    expect(
      ORGANIZATION_DOCUMENT_COMPUTER_TOOL_NAMES.every((toolName) =>
        capability.definitions.some(
          (definition) => definition.name === toolName
        )
      )
    ).toBe(true);
  });

  it("routes later model operations to the same Computer owner without holding a Workspace client", async () => {
    const materializationWorkspace = createWorkspaceFake();
    cloudflareComputerMock.getWorkspace.mockResolvedValueOnce(
      materializationWorkspace.workspace
    );
    const computerOperation = vi.fn(async () => ({
      kind: "files",
      result: { isError: false },
    }));
    const namespace = {
      get: vi.fn((_target: unknown) => ({ computerOperation })),
      idFromName: vi.fn(() => ({})),
    };
    const capability = await createRemoteAgentComputerCapability({
      context: createComputerContext(),
      coreWorker: {
        centerAgentOrganizationDocumentsComputerSnapshot: vi.fn(async () =>
          organizationDocumentsSnapshot()
        ),
      },
      env: { AGENT_COMPUTER: namespace },
      includeOrganizationDocuments: true,
    });
    const computer = capability.definitions.find(
      (definition) => definition.name === "computer"
    );
    if (!computer) {
      throw new Error("Computer tool missing");
    }
    await computer.execute({
      action: "files",
      tool: "grep",
      input: { path: "/computer", query: "launch" },
    });
    expect(computerOperation).toHaveBeenCalledWith({
      action: "files",
      tool: "grep",
      input: { path: "/computer", query: "launch" },
    });
    expect(cloudflareComputerMock.getWorkspace).toHaveBeenCalledOnce();
    expect(materializationWorkspace.dispose).toHaveBeenCalledOnce();
  });

  it("keeps document contents off shared disk and preserves an explicit checkout across a restricted turn", async () => {
    const {
      allowedInput,
      centerAgentOrganizationDocumentsComputerSnapshot,
      fixture,
    } = createOrganizationDocumentsComputerFixture();

    const allowed = await createRemoteAgentComputerCapability(allowedInput);

    expect(
      centerAgentOrganizationDocumentsComputerSnapshot
    ).not.toHaveBeenCalled();
    expect(
      fixture.files.has(
        `${ORGANIZATION_DOCUMENTS_COMPUTER_ROOT}/Private-Launch-Plan--doc_private.md`
      )
    ).toBe(false);
    expect(
      ORGANIZATION_DOCUMENT_COMPUTER_TOOL_NAMES.every((toolName) =>
        allowed.definitions.some((definition) => definition.name === toolName)
      )
    ).toBe(true);

    const checkout = allowed.definitions.find(
      (tool) => tool.name === "openmeld_checkout_org_document"
    );
    if (!checkout) {
      throw new Error("Missing checkout tool");
    }
    const copy = (await checkout.execute(
      { documentId: "doc_private" },
      undefined
    )) as { path: string };
    expect(
      centerAgentOrganizationDocumentsComputerSnapshot
    ).toHaveBeenCalledOnce();
    const original = fixture.files.get(copy.path);
    expect(original).toBeTruthy();
    centerAgentOrganizationDocumentsComputerSnapshot.mockClear();
    const restricted = await createRemoteAgentComputerCapability({
      ...allowedInput,
      includeOrganizationDocuments: false,
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
    expect(fixture.files.get(copy.path)).toBe(original);
    expect(
      ORGANIZATION_DOCUMENT_COMPUTER_TOOL_NAMES.some((toolName) =>
        restricted.definitions.some(
          (definition) => definition.name === toolName
        )
      )
    ).toBe(false);
  });

  it("does not remove personal files while preparing a restricted turn", async () => {
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
        includeOrganizationDocuments: false,
      })
    ).resolves.toBeDefined();
    expect(
      centerAgentOrganizationDocumentsComputerSnapshot
    ).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
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
          "space_123",
          "submission_computer",
          expect.any(String),
        ],
      })
    );
  });
});
