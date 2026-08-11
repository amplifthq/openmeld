import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runAuthLogin,
  runAuthLogout,
  runAuthMenu,
  runAuthStatus,
} from "../src/commands/auth";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const { listDaemonOwnedProcessesMock } = vi.hoisted(() => ({
  listDaemonOwnedProcessesMock: vi.fn(),
}));

vi.mock(
  "../src/local-service/lifecycle/daemon-service-process-inventory",
  async () => {
    const actual = await vi.importActual<
      typeof import("../src/local-service/lifecycle/daemon-service-process-inventory")
    >("../src/local-service/lifecycle/daemon-service-process-inventory");
    return {
      ...actual,
      listDaemonOwnedProcesses: (...args: unknown[]) =>
        listDaemonOwnedProcessesMock(...args),
    };
  }
);

describe("auth agent overview", () => {
  beforeEach(() => {
    listDaemonOwnedProcessesMock.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  it("emits auth menu overview before auth status in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAuthMenu({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("auth.menu.agent_overview");
      expect(envelopes[1]?.code).toBe("auth.status.session");
    });
  });

  it("emits auth status overview before session payload in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAuthStatus({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("auth.status.agent_overview");
      expect(envelopes[1]?.code).toBe("auth.status.session");
    });
  });

  it("emits auth login overview before ott guidance failure in agent view", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runAuthLogin({
            view: "agent",
            authUrl: "https://auth.openmeld.invalid",
          });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("auth.login.agent_overview");
      expect(envelopes[1]?.code).toBe("auth.login.ott.required");
      expect(thrown).toBeInstanceOf(Error);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("emits auth logout overview before no-session result in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAuthLogout({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("auth.logout.agent_overview");
      expect(envelopes[1]?.code).toBe("auth.logout.cleanup");
      expect(envelopes[2]?.code).toBe("auth.logout.no_session");
    });
  });
});

function parseAgentEnvelopes(stdout: string): Array<{ code?: string }> {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { code?: string });
}
