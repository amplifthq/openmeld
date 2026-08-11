import { describe, expect, it } from "vitest";
import {
  runAgents,
  runAgentsConfig,
  runAgentsCustomAdd,
  runAgentsCustomList,
  runAgentsCustomRemove,
  runAgentsCustomUpdate,
  runAgentsDetect,
  runAgentsDisable,
  runAgentsEnable,
  runAgentsList,
  runAgentsManage,
  runAgentsRepair,
  runAgentsShow,
} from "../src/commands/agents";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("agents agent overview", () => {
  it("emits overview before menu payload in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAgents({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("agents.menu.agent_overview");
      expect(envelopes[1]?.code).toBe("agents.menu.result");
      const payload = envelopes[1]?.payload as
        | { commands?: string[] }
        | undefined;
      expect(payload?.commands).toContain("openmeld agents repair --all");
    });
  });

  it("emits overview before manage payload in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsManage({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("agents.manage.agent_overview");
      expect(envelopes[1]?.code).toBe("agents.manage.result");
      const payload = envelopes[1]?.payload as
        | { commands?: string[] }
        | undefined;
      expect(payload?.commands).toContain("openmeld agents repair --all");
      expect(payload?.commands).toContain(
        "openmeld agents repair --agent <id> --install <install-id>"
      );
    });
  });

  it("emits overview before detect payload in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsDetect({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("agents.detect.agent_overview");
      expect(envelopes[1]?.code).toBe("agents.detect.result");
    });
  });

  it("emits overview before list payload in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsList({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("agents.list.agent_overview");
      expect(envelopes[1]?.code).toBe("agents.list.result");
    });
  });

  it("emits overview before enable validation failure in agent view", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runAgentsEnable({ view: "agent" });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("agents.enable.agent_overview");
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "agents.enable_invalid"
      );
    });
  });

  it("omits enable overview in setup handoff mode", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runAgentsEnable({ view: "agent", presentation: "handoff" });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(
        envelopes.some((item) => item.code === "agents.enable.agent_overview")
      ).toBe(false);
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "agents.enable_invalid"
      );
    });
  });

  it("emits overview before repair validation failure in agent view", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runAgentsRepair({ view: "agent" });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("agents.repair.agent_overview");
      const payload = envelopes[0]?.payload as
        | {
            commands?: string[];
            optionalArguments?: string[];
            requiredArguments?: string[];
          }
        | undefined;
      expect(payload?.requiredArguments).toEqual([
        "one selection mode: --all | --agent <id...>",
      ]);
      expect(payload?.optionalArguments).toEqual([
        "--install <install-id> with one --agent <id>",
      ]);
      expect(payload?.commands).toContain(
        "openmeld agents repair --all --view agent"
      );
      expect(payload?.commands).toContain(
        "openmeld agents repair --agent <id> --install <install-id> --view agent"
      );
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "agents.repair_invalid"
      );
    });
  });

  it("emits overview before custom add validation failure in agent view", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runAgentsCustomAdd({ view: "agent" });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("agents.custom_add.agent_overview");
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "agents.custom.invalid_argument"
      );
    });
  });

  it("emits overview before disable validation failure in agent view", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runAgentsDisable({ view: "agent" });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("agents.disable.agent_overview");
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "agents.disable_invalid"
      );
    });
  });

  it("emits overview before show validation failure in agent view", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runAgentsShow({ view: "agent" });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("agents.show.agent_overview");
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "agents.invalid_agent_id"
      );
    });
  });

  it("emits overview before config validation failure in agent view", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runAgentsConfig({ view: "agent" });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("agents.config.agent_overview");
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "agents.invalid_agent_id"
      );
    });
  });

  it("emits overview before custom list result in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsCustomList({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("agents.custom_list.agent_overview");
      expect(envelopes[1]?.code).toBe("agents.custom.list.result");
    });
  });

  it("emits overview before custom update validation failure in agent view", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runAgentsCustomUpdate({ view: "agent" });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("agents.custom_update.agent_overview");
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "agents.custom.invalid_argument"
      );
    });
  });

  it("emits overview before custom remove validation failure in agent view", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runAgentsCustomRemove({ view: "agent" });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("agents.custom_remove.agent_overview");
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "agents.custom.invalid_argument"
      );
    });
  });
});

function parseAgentEnvelopes(
  stdout: string
): Array<{ code?: string; payload?: unknown }> {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const envelopes: Array<{ code?: string; payload?: unknown }> = [];
  for (const line of lines) {
    try {
      envelopes.push(JSON.parse(line) as { code?: string; payload?: unknown });
    } catch {
      // Ignore non-JSON stdout lines in mixed human/agent captures.
    }
  }
  return envelopes;
}
