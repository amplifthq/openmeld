import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../src/commands/doctor";
import { runRepairLocalState } from "../src/commands/repair";
import { runReset } from "../src/commands/reset";
import { emitTopLevelCliAgentOverview } from "../src/commands/top-level-agent-overview";
import { runUpgrade } from "../src/commands/upgrade";
import { runWhoami } from "../src/commands/whoami";
import { setAuthSession } from "../src/config/auth-session";
import { formatCliVersionSummary } from "../src/runtime/cli-version";
import { MANUAL_OPENMELD_UPGRADE_COMMAND } from "../src/runtime/manual-upgrade";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { seedVersionState } from "./helpers/version";

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

describe("top-level agent overview", () => {
  beforeEach(() => {
    listDaemonOwnedProcessesMock.mockReset().mockResolvedValue([]);
  });

  it("emits structured helper output for root, view, and reset", async () => {
    const { stdout } = await withCapturedStdio(async () => {
      await Promise.resolve();
      emitTopLevelCliAgentOverview("root");
      emitTopLevelCliAgentOverview("view");
      emitTopLevelCliAgentOverview("uninstall");
      emitTopLevelCliAgentOverview("reset");
    });

    const envelopes = parseAgentEnvelopes(stdout);
    expect(envelopes[0]?.code).toBe("root.agent_overview");
    expect(envelopes[0]?.payload?.cli?.summary).toBe(formatCliVersionSummary());
    expect(envelopes[1]?.code).toBe("view.agent_overview");
    expect(envelopes[2]?.code).toBe("uninstall.agent_overview");
    expect(envelopes[3]?.code).toBe("reset.agent_overview");
  });

  it("emits doctor overview with details before doctor checks in agent view", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ service: "openmeld-gateway" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withDetailsArgv(async () => {
        return await withCapturedStdio(async () => {
          await runDoctor({
            view: "agent",
            baseUrl: "https://gateway.openmeld.invalid",
          });
        });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("doctor.agent_overview");
      expect(envelopes[1]?.code).toBe("doctor.check.info");
    });
  });

  it("formats top-level overview commands and human steps with the resolved CLI entry", async () => {
    const previousCliEntry = process.env.OPENMELD_USER_FACING_CLI_COMMAND;
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-canary";

    try {
      const { stdout } = await withCapturedStdio(async () => {
        emitTopLevelCliAgentOverview("doctor");
        await Promise.resolve();
      });

      const payload = parseAgentEnvelopes(stdout)[0]?.payload;
      expect(payload?.commands).toContain(
        "openmeld-canary doctor --view agent"
      );
      expect(payload?.commands).toContain(
        "openmeld-canary doctor --repair --view agent"
      );
      expect(payload?.humanActionRequired?.steps).toContain(
        "If auth is missing or expired, ask a human to complete `openmeld-canary login`."
      );
    } finally {
      if (previousCliEntry === undefined) {
        Reflect.deleteProperty(process.env, "OPENMELD_USER_FACING_CLI_COMMAND");
      } else {
        process.env.OPENMELD_USER_FACING_CLI_COMMAND = previousCliEntry;
      }
    }
  });

  it("omits whoami overview from the default agent-view success path", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runWhoami({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("whoami.loaded");
      expect(
        envelopes.some((item) => item.code === "whoami.agent_overview")
      ).toBe(false);
    });
  });

  it("emits upgrade overview before metadata-missing failure in agent view", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runUpgrade({
            view: "agent",
            check: true,
          });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("upgrade.agent_overview");
      expect(envelopes[1]?.code).toBe("upgrade.metadata.missing");
      expect(envelopes[1]?.payload?.nextSteps).toContain(
        MANUAL_OPENMELD_UPGRADE_COMMAND
      );
      expect(thrown).toBeInstanceOf(Error);
    });
  });

  it("emits upgrade overview before check result in agent view", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ version: "9.9.9" }), {
            status: 200,
          })
        )
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runUpgrade({
          view: "agent",
          check: true,
        });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("upgrade.agent_overview");
      expect(envelopes[1]?.code).toBe("upgrade.checking.started");
      expect(envelopes[2]?.code).toBe("upgrade.checking.completed");
      expect(envelopes[3]?.code).toBe("upgrade.check");
    });
  });

  it("emits repair overview before completion in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runRepairLocalState({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("repair.local_state.agent_overview");
      expect(envelopes[1]?.code).toBe("repair.local_state.completed");
    });
  });

  it("emits reset overview before completion in agent view", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-reset-overview",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runReset({
          view: "agent",
          yes: true,
        });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("reset.agent_overview");
      expect(
        envelopes.some((envelope) => envelope.code === "reset.completed")
      ).toBe(true);
      expect(home.length).toBeGreaterThan(0);
    });
  });
});

function parseAgentEnvelopes(stdout: string): Array<{
  code?: string;
  payload?: {
    cli?: {
      summary?: string;
    };
    commands?: string[];
    humanActionRequired?: {
      steps?: string[];
    };
    nextSteps?: string[];
  };
}> {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map(
      (line) =>
        JSON.parse(line) as {
          code?: string;
          payload?: {
            cli?: {
              summary?: string;
            };
            commands?: string[];
            humanActionRequired?: {
              steps?: string[];
            };
            nextSteps?: string[];
          };
        }
    );
}

async function withDetailsArgv<T>(fn: () => Promise<T>): Promise<T> {
  const previousArgv = process.argv;
  process.argv = ["node", "openmeld", "--details"];
  try {
    return await fn();
  } finally {
    process.argv = previousArgv;
  }
}
