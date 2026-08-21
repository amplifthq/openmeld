import { beforeEach, describe, expect, it, vi } from "vitest";
import { forkAgentSession } from "../src/local-service/session-control/fork-agent-session";

const mocks = vi.hoisted(() => ({
  discoverProviders: vi.fn(),
  forkClaude: vi.fn(),
  forkCodex: vi.fn(),
  forkOpenCode: vi.fn(),
  listBindings: vi.fn(),
  recordOrigin: vi.fn(),
  resolveCodex: vi.fn(),
  resolveOpenCode: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  forkSession: mocks.forkClaude,
}));
vi.mock("@openmeld/adapter-codex", () => ({
  forkCodexAppServerThread: mocks.forkCodex,
  resolveInstalledCodexLaunchCandidates: mocks.resolveCodex,
}));
vi.mock("@openmeld/adapter-opencode", () => ({
  forkOpenCodeServerSession: mocks.forkOpenCode,
  resolveInstalledOpenCodeLaunchCandidates: mocks.resolveOpenCode,
}));
vi.mock("../src/agent-activity/session-inventory-provider-adapters", () => ({
  discoverLocalAgentSessionProviders: mocks.discoverProviders,
}));
vi.mock("../src/agent-activity/session-inventory-origin-store", () => ({
  recordOpenMeldCreatedLocalAgentSession: mocks.recordOrigin,
}));
vi.mock("../src/agent-activity/project-bindings", () => ({
  listProjectBindings: mocks.listBindings,
}));

const launchContract = {
  commandPath: "/usr/local/bin/local-agent",
  kind: "executable" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listBindings.mockResolvedValue([
    { projectId: "project-1", repositoryPath: "/work/openmeld" },
  ]);
  mocks.resolveCodex.mockResolvedValue({
    candidates: [{ launchContract }],
    ok: true,
  });
  mocks.resolveOpenCode.mockResolvedValue({
    candidates: [{ launchContract }],
    ok: true,
  });
  mocks.recordOrigin.mockResolvedValue(undefined);
});

describe("native Agent Session Fork", () => {
  it.each([
    {
      childNativeSessionId: "codex-child",
      controller: "builtin:codex",
      providerFork: mocks.forkCodex,
      providerResult: { threadId: "codex-child" },
    },
    {
      childNativeSessionId: "claude-child",
      controller: "builtin:claude-code",
      providerFork: mocks.forkClaude,
      providerResult: { sessionId: "claude-child" },
    },
    {
      childNativeSessionId: "opencode-child",
      controller: "builtin:opencode",
      providerFork: mocks.forkOpenCode,
      providerResult: { sessionId: "opencode-child" },
    },
  ])("forks $controller from the exact native source and records the child", async ({
    childNativeSessionId,
    controller,
    providerFork,
    providerResult,
  }) => {
    mocks.discoverProviders.mockResolvedValue([
      {
        agentControllerRef: controller,
        result: "sessions",
        sessions: [
          {
            binding: {
              projectId: "project-1",
              repositoryPath: "/work/openmeld",
            },
            session: {
              canFork: true,
              nativeSessionId: "source-session-1",
            },
          },
        ],
      },
    ]);
    providerFork.mockResolvedValue(providerResult);

    const result = await forkAgentSession({
      request: requestFor(controller),
      rootDir: "/tmp/openmeld-test",
    });

    expect(result).toEqual({ childNativeSessionId });
    if (controller === "builtin:claude-code") {
      expect(providerFork).toHaveBeenCalledWith("source-session-1", {
        dir: "/work/openmeld",
        title: "OpenMeld · Research Agent",
      });
    } else {
      expect(providerFork).toHaveBeenCalledWith(
        expect.objectContaining({
          ...(controller === "builtin:codex"
            ? { sourceThreadId: "source-session-1" }
            : { sourceSessionId: "source-session-1" }),
          title: "OpenMeld · Research Agent",
        })
      );
    }
    expect(mocks.recordOrigin).toHaveBeenCalledWith({
      agentControllerRef: controller,
      nativeSessionId: childNativeSessionId,
      rootDir: "/tmp/openmeld-test",
    });
  });

  it("rejects a source Session that is no longer forkable", async () => {
    mocks.discoverProviders.mockResolvedValue([
      {
        agentControllerRef: "builtin:codex",
        result: "sessions",
        sessions: [
          {
            binding: {
              projectId: "project-1",
              repositoryPath: "/work/openmeld",
            },
            session: {
              canFork: false,
              nativeSessionId: "source-session-1",
            },
          },
        ],
      },
    ]);

    await expect(
      forkAgentSession({ request: requestFor("builtin:codex") })
    ).rejects.toMatchObject({
      code: "agent_session_fork.source_unavailable",
    });
    expect(mocks.forkCodex).not.toHaveBeenCalled();
  });
});

function requestFor(agentControllerRef: string) {
  return {
    agentControllerRef,
    operationId: "request-1",
    organizationId: "organization-1",
    profileName: "Research Agent",
    projectId: "project-1",
    sourceNativeSessionId: "source-session-1",
  };
}
