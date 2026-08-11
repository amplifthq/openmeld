import { describe, expect, it } from "vitest";

import { runAgentsConfig } from "../src/commands/agents";
import {
  getConfiguredDeviceRuntimeState,
  setConfiguredDeviceRuntimeState,
} from "../src/config/runtime-config";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("openmeld agents config", () => {
  it("updates enabled field", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsConfig({
          view: "agent",
          agentId: "codex",
          enabled: "false",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.config.result");
      const payload = envelope.payload as
        | {
            agentId?: string;
            updatedFields?: string[];
            effectiveConfig?: { enabled?: boolean };
          }
        | undefined;
      expect(payload?.agentId).toBe("codex");
      expect(payload?.updatedFields).toEqual(["enabled"]);
      expect(payload?.effectiveConfig?.enabled).toBe(false);

      const controllers =
        (await getConfiguredDeviceRuntimeState())?.controllers ?? [];
      expect(controllers[0]?.enabled).toBe(false);
    });
  });

  it("validates enabled option value", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      await expect(
        runAgentsConfig({
          view: "human",
          agentId: "codex",
          enabled: "maybe",
        })
      ).rejects.toThrow("agents.config_invalid:");
    });
  });
});

function parseAgentResultEnvelope(
  stdout: string,
  code: string
): { payload?: unknown } {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        code?: string;
        payload?: unknown;
      };
      if (parsed.type === "result" && parsed.code === code) {
        return { payload: parsed.payload };
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return {};
}
