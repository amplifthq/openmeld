import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
vi.mock("../src/agent-activity/session-inventory-provider-adapters", () => ({
  discoverLocalAgentSessionProviders: mocks.discoverLocalAgentSessionProviders,
}));

let root: string | null = null;

beforeEach(() => {
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
});
