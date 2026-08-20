import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindProject,
  listProjectBindings,
  unbindProject,
} from "../src/agent-activity/project-bindings";
import { syncLocalAgentSessionInventory } from "../src/agent-activity/session-inventory-sync";

const mocks = vi.hoisted(() => ({
  discoverLocalAgentSessionProviders: vi.fn(),
  getAuthSessionState: vi.fn(),
  readDaemonServiceContract: vi.fn(),
  submitAgentActivitySessionReconciliation: vi.fn(),
  submitRegistration: vi.fn(),
}));

vi.mock("@openmeld/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openmeld/api-client")>();
  return {
    ...actual,
    createRuntimeReportingApi: vi.fn(() => ({
      submitAgentActivitySessionReconciliation:
        mocks.submitAgentActivitySessionReconciliation,
      submitRegistration: mocks.submitRegistration,
    })),
  };
});
vi.mock("../src/config/daemon-service-contract", () => ({
  readDaemonServiceContract: mocks.readDaemonServiceContract,
}));
vi.mock("../src/config/auth-session", () => ({
  getAuthSessionState: mocks.getAuthSessionState,
}));
vi.mock("../src/agent-activity/session-inventory-provider-adapters", () => ({
  discoverLocalAgentSessionProviders: mocks.discoverLocalAgentSessionProviders,
}));

let root: string | null = null;

beforeEach(() => {
  mocks.getAuthSessionState.mockResolvedValue({
    session: { user: { id: "user-1" } },
    state: "valid",
  });
  mocks.readDaemonServiceContract.mockResolvedValue({
    deviceId: "private-device-1",
    gatewayUrl: "https://gateway.openmeld.test",
    lane: "dev-local",
  });
  mocks.submitRegistration.mockResolvedValue({
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority",
      value: "runtime-1",
    },
    status: "accepted",
  });
  mocks.submitAgentActivitySessionReconciliation.mockResolvedValue({
    acceptedPageIndex: 0,
    publishedSessionCount: null,
    reconciliationId: "accepted",
    status: "accepted",
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  if (root) {
    await rm(root, { force: true, recursive: true });
    root = null;
  }
});

describe("Local Agent Session Inventory reconciliation", () => {
  it("does not publish or overwrite state when the source store cannot be read", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-session-store-error-"));
    const repositoryPath = join(root, "repository");
    await mkdir(repositoryPath, { recursive: true });
    const binding = await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir: root,
    });
    mocks.discoverLocalAgentSessionProviders.mockResolvedValue([
      {
        agentControllerRef: "builtin:codex",
        provider: "codex",
        result: "sessions",
        sessions: [
          {
            binding,
            session: {
              canFork: false,
              canResume: true,
              lastActiveAtMs: 10_000,
              nativeSessionId: "native-preserved",
              nativeSessionTitle: "Preserved Session",
              origin: "local",
              startedAtMs: 9000,
              status: "idle",
            },
          },
        ],
      },
    ]);
    await syncLocalAgentSessionInventory({
      foundation: {} as never,
      nowMs: 20_000,
      rootDir: root,
    });

    const sourceStorePath = join(
      root,
      "device",
      "agent-activity",
      "session-inventory-sources.json"
    );
    const preservedPath = `${sourceStorePath}.preserved`;
    await rename(sourceStorePath, preservedPath);
    await symlink(sourceStorePath, sourceStorePath);
    mocks.submitAgentActivitySessionReconciliation.mockClear();

    await expect(
      syncLocalAgentSessionInventory({
        foundation: {} as never,
        nowMs: 30_000,
        rootDir: root,
      })
    ).rejects.toThrow("Failed to read the Session Inventory source store");
    expect(
      mocks.submitAgentActivitySessionReconciliation
    ).not.toHaveBeenCalled();
    expect(await readFile(preservedPath, "utf8")).toContain("project-1");
  });

  it("disconnects an obsolete Project connection before publishing its replacement", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-session-rebind-"));
    const repositoryPath = join(root, "repository");
    await mkdir(repositoryPath, { recursive: true });
    const firstBinding = await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir: root,
    });
    mocks.discoverLocalAgentSessionProviders.mockResolvedValue([
      {
        agentControllerRef: "builtin:codex",
        provider: "codex",
        result: "sessions",
        sessions: [
          {
            binding: firstBinding,
            session: {
              canFork: false,
              canResume: true,
              lastActiveAtMs: 10_000,
              nativeSessionId: "native-rebound",
              nativeSessionTitle: "Rebound Session",
              origin: "local",
              startedAtMs: 9000,
              status: "idle",
            },
          },
        ],
      },
    ]);
    await syncLocalAgentSessionInventory({
      foundation: {} as never,
      nowMs: 20_000,
      rootDir: root,
    });

    const replacementBinding = await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: `sha256:${"a".repeat(64)}`,
      repositoryPath,
      rootDir: root,
    });
    expect(replacementBinding.bindingGeneration).not.toBe(
      firstBinding.bindingGeneration
    );
    mocks.discoverLocalAgentSessionProviders.mockResolvedValue([
      {
        agentControllerRef: "builtin:codex",
        provider: "codex",
        result: "sessions",
        sessions: [
          {
            binding: replacementBinding,
            session: {
              canFork: false,
              canResume: true,
              lastActiveAtMs: 30_000,
              nativeSessionId: "native-rebound",
              nativeSessionTitle: "Rebound Session",
              origin: "local",
              startedAtMs: 9000,
              status: "idle",
            },
          },
        ],
      },
    ]);
    mocks.submitAgentActivitySessionReconciliation.mockClear();

    const result = await syncLocalAgentSessionInventory({
      foundation: {} as never,
      nowMs: 30_000,
      rootDir: root,
    });

    expect(result).toMatchObject({
      sessionCount: 1,
      status: "submitted",
      submittedSourceCount: 2,
    });
    const requests =
      mocks.submitAgentActivitySessionReconciliation.mock.calls.map(
        ([request]) => request as { localConnectionId: string; result: string }
      );
    expect(requests.map(({ result: requestResult }) => requestResult)).toEqual([
      "disconnected",
      "sessions",
    ]);
    expect(requests[0]?.localConnectionId).not.toBe(
      requests[1]?.localConnectionId
    );
  });

  it("retains a source after an accepted page so a later Project removal can disconnect it", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-session-partial-page-"));
    const repositoryPath = join(root, "repository");
    await mkdir(repositoryPath, { recursive: true });
    const binding = await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir: root,
    });
    mocks.discoverLocalAgentSessionProviders.mockResolvedValue([
      {
        agentControllerRef: "builtin:codex",
        provider: "codex",
        result: "sessions",
        sessions: Array.from({ length: 205 }, (_, index) => ({
          binding,
          session: {
            canFork: false,
            canResume: true,
            lastActiveAtMs: 10_000 + index,
            nativeSessionId: `native-${String(index).padStart(3, "0")}`,
            nativeSessionTitle: null,
            origin: "unknown",
            startedAtMs: null,
            status: "unknown",
          },
        })),
      },
    ]);
    mocks.submitAgentActivitySessionReconciliation
      .mockResolvedValueOnce({
        acceptedPageIndex: 0,
        publishedSessionCount: null,
        reconciliationId: "accepted",
        status: "accepted",
      })
      .mockRejectedValueOnce(new Error("later page failed"));

    await expect(
      syncLocalAgentSessionInventory({
        foundation: {} as never,
        nowMs: 20_000,
        rootDir: root,
      })
    ).resolves.toMatchObject({
      reason: "inventory_write_transport_failure",
      status: "unavailable",
    });
    expect(
      mocks.submitAgentActivitySessionReconciliation
    ).toHaveBeenCalledTimes(2);
    expect(
      await readFile(
        join(
          root,
          "device",
          "agent-activity",
          "session-inventory-sources.json"
        ),
        "utf8"
      )
    ).toContain("project-1");

    await unbindProject({
      organizationId: "org-1",
      projectId: "project-1",
      rootDir: root,
    });
    mocks.submitAgentActivitySessionReconciliation.mockClear();

    await expect(
      syncLocalAgentSessionInventory({
        foundation: {} as never,
        nowMs: 30_000,
        rootDir: root,
      })
    ).resolves.toMatchObject({
      status: "submitted",
      submittedSourceCount: 1,
    });
    expect(mocks.submitAgentActivitySessionReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        result: "disconnected",
      })
    );
  });

  it("submits every Session in stable pages and then disconnects the removed Project source", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-session-sync-"));
    const repositoryPath = join(root, "repository");
    await mkdir(repositoryPath, { recursive: true });
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir: root,
    });
    const [binding] = await listProjectBindings({ rootDir: root });
    if (!binding) {
      throw new Error("Expected the Project binding fixture.");
    }
    mocks.discoverLocalAgentSessionProviders.mockResolvedValue([
      {
        agentControllerRef: "builtin:codex",
        provider: "codex",
        result: "sessions",
        sessions: Array.from({ length: 205 }, (_, index) => ({
          binding,
          session: {
            canFork: false,
            canResume: true,
            lastActiveAtMs: 10_000 + index,
            nativeSessionId: `native-${String(204 - index).padStart(3, "0")}`,
            nativeSessionTitle: null,
            origin: "unknown",
            startedAtMs: null,
            status: "unknown",
          },
        })),
      },
    ]);

    const first = await syncLocalAgentSessionInventory({
      foundation: {} as never,
      nowMs: 20_000,
      rootDir: root,
    });
    expect(first).toEqual({
      reason: null,
      sessionCount: 205,
      sourceCount: 1,
      status: "submitted",
      submittedSourceCount: 1,
    });
    const sessionPages = mocks.submitAgentActivitySessionReconciliation.mock
      .calls as [{ [key: string]: unknown; sessions: unknown[] }][];
    expect(sessionPages.map(([request]) => request.sessions.length)).toEqual([
      100, 100, 5,
    ]);
    expect(sessionPages.map(([request]) => request.pageIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(sessionPages.map(([request]) => request.terminal)).toEqual([
      false,
      false,
      true,
    ]);
    expect(
      new Set(sessionPages.map(([request]) => request.reconciliationId)).size
    ).toBe(1);
    expect(
      sessionPages
        .flatMap(([request]) => request.sessions)
        .map((session) =>
          String((session as { nativeSessionId: string }).nativeSessionId)
        )
    ).toEqual(
      Array.from(
        { length: 205 },
        (_, index) => `native-${String(index).padStart(3, "0")}`
      )
    );

    const sourceStorePath = join(
      root,
      "device",
      "agent-activity",
      "session-inventory-sources.json"
    );
    expect((await stat(sourceStorePath)).mode % 0o1000).toBe(0o600);
    const sourceStore = await readFile(sourceStorePath, "utf8");
    expect(sourceStore).not.toContain(repositoryPath);
    expect(sourceStore).not.toContain("private-device-1");

    await unbindProject({
      organizationId: "org-1",
      projectId: "project-1",
      rootDir: root,
    });
    mocks.submitAgentActivitySessionReconciliation.mockClear();
    const disconnected = await syncLocalAgentSessionInventory({
      foundation: {} as never,
      nowMs: 30_000,
      rootDir: root,
    });
    expect(disconnected).toMatchObject({
      sessionCount: 0,
      sourceCount: 1,
      status: "submitted",
      submittedSourceCount: 1,
    });
    expect(mocks.submitAgentActivitySessionReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        result: "disconnected",
        sessions: [],
        terminal: true,
      })
    );
  });

  it("never submits another signed-in owner's stored sources after an account switch", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-session-owner-switch-"));
    const firstRepositoryPath = join(root, "first-repository");
    const secondRepositoryPath = join(root, "second-repository");
    await mkdir(firstRepositoryPath, { recursive: true });
    await mkdir(secondRepositoryPath, { recursive: true });
    const firstBinding = await bindProject({
      organizationId: "org-first",
      projectId: "project-first",
      projectSlug: "first",
      repositoryFingerprint: null,
      repositoryPath: firstRepositoryPath,
      rootDir: root,
    });
    mocks.discoverLocalAgentSessionProviders.mockResolvedValue([
      discoveryFor(firstBinding, "native-first"),
    ]);
    await syncLocalAgentSessionInventory({
      foundation: {} as never,
      nowMs: 20_000,
      rootDir: root,
    });

    await unbindProject({
      organizationId: "org-first",
      projectId: "project-first",
      rootDir: root,
    });
    const secondBinding = await bindProject({
      organizationId: "org-second",
      projectId: "project-second",
      projectSlug: "second",
      repositoryFingerprint: null,
      repositoryPath: secondRepositoryPath,
      rootDir: root,
    });
    mocks.getAuthSessionState.mockResolvedValue({
      session: { user: { id: "user-2" } },
      state: "valid",
    });
    mocks.discoverLocalAgentSessionProviders.mockResolvedValue([
      discoveryFor(secondBinding, "native-second"),
    ]);
    mocks.submitAgentActivitySessionReconciliation.mockClear();

    await expect(
      syncLocalAgentSessionInventory({
        foundation: {} as never,
        nowMs: 30_000,
        rootDir: root,
      })
    ).resolves.toMatchObject({
      sessionCount: 1,
      sourceCount: 1,
      status: "submitted",
      submittedSourceCount: 1,
    });
    expect(
      mocks.submitAgentActivitySessionReconciliation
    ).toHaveBeenCalledTimes(1);
    expect(mocks.submitAgentActivitySessionReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-second",
        projectId: "project-second",
        result: "sessions",
      })
    );
    const stored = await readFile(
      join(root, "device", "agent-activity", "session-inventory-sources.json"),
      "utf8"
    );
    expect(stored).toContain('"ownerUserId":"user-1"');
    expect(stored).toContain('"ownerUserId":"user-2"');
  });

  it("does not adopt a legacy ownerless source as the current owner's source", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-session-legacy-owner-"));
    const repositoryPath = join(root, "repository");
    await mkdir(repositoryPath, { recursive: true });
    const binding = await bindProject({
      organizationId: "org-current",
      projectId: "project-current",
      projectSlug: "current",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir: root,
    });
    const storePath = join(
      root,
      "device",
      "agent-activity",
      "session-inventory-sources.json"
    );
    await mkdir(join(root, "device", "agent-activity"), { recursive: true });
    await writeFile(
      storePath,
      `${JSON.stringify({
        sources: [
          {
            agentControllerRef: "builtin:codex",
            localConnectionId: `sha256:${"f".repeat(64)}`,
            organizationId: "org-legacy",
            projectId: "project-legacy",
            provider: "codex",
            repositoryFingerprint: null,
          },
        ],
        version: 1,
      })}\n`,
      "utf8"
    );
    mocks.getAuthSessionState.mockResolvedValue({
      session: { user: { id: "user-current" } },
      state: "valid",
    });
    mocks.discoverLocalAgentSessionProviders.mockResolvedValue([
      discoveryFor(binding, "native-current"),
    ]);

    await syncLocalAgentSessionInventory({
      foundation: {} as never,
      nowMs: 40_000,
      rootDir: root,
    });

    expect(
      mocks.submitAgentActivitySessionReconciliation
    ).toHaveBeenCalledTimes(1);
    expect(mocks.submitAgentActivitySessionReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-current",
        projectId: "project-current",
        result: "sessions",
      })
    );
    expect(await readFile(storePath, "utf8")).toContain(
      '"ownerUserId":"user-current"'
    );
    expect(await readFile(storePath, "utf8")).not.toContain("project-legacy");
  });
});

function discoveryFor(
  binding: Awaited<ReturnType<typeof bindProject>>,
  nativeSessionId: string
) {
  return {
    agentControllerRef: "builtin:codex",
    provider: "codex" as const,
    result: "sessions" as const,
    sessions: [
      {
        binding,
        session: {
          canFork: false,
          canResume: true,
          lastActiveAtMs: 10_000,
          nativeSessionId,
          nativeSessionTitle: null,
          origin: "local" as const,
          startedAtMs: 9000,
          status: "idle" as const,
        },
      },
    ],
  };
}
