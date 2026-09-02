import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProfileCurrentSession } from "../src/profile/current-session-command";

const { getCurrentSessionMock, presenter } = vi.hoisted(() => ({
  getCurrentSessionMock: vi.fn(),
  presenter: {
    data: vi.fn(),
    event: vi.fn(),
    line: vi.fn(),
    view: "agent" as const,
  },
}));

vi.mock("@openmeld/api-client", () => ({
  createAgentProfileBindingApi: vi.fn(() => ({
    getCurrentSession: getCurrentSessionMock,
  })),
}));
vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: vi.fn(async () => "http://localhost:8787"),
}));
vi.mock("../src/runtime/context", () => ({
  resolveRuntimeContext: vi.fn(async () => ({ resolvedView: "agent" })),
}));
vi.mock("../src/runtime/presenter", () => ({
  createPresenter: vi.fn(() => presenter),
}));
vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: vi.fn(() => ({})),
}));

describe("profiles current-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CODEX_THREAD_ID", "thread-current");
    getCurrentSessionMock.mockResolvedValue({
      currentOrganizationId: "org-1",
      status: "not_found",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("looks up the detected Codex thread directly", async () => {
    await runProfileCurrentSession({ view: "agent" });

    expect(getCurrentSessionMock).toHaveBeenCalledOnce();
    expect(getCurrentSessionMock).toHaveBeenCalledWith({
      agentControllerConversationId: "thread-current",
      agentControllerRef: "builtin:codex",
    });
    expect(presenter.data).toHaveBeenCalledWith({
      code: "profile.current_session",
      payload: { currentOrganizationId: "org-1", status: "not_found" },
    });
  });

  it("requires an explicit provider and Session ID as one pair", async () => {
    await expect(
      runProfileCurrentSession({ provider: "codex", view: "agent" })
    ).rejects.toThrow("Pass both --provider and --native-session");
    expect(getCurrentSessionMock).not.toHaveBeenCalled();
  });
});
