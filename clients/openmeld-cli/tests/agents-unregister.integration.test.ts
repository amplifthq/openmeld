import { describe, expect, it } from "vitest";

import { runAgentsDisable, runAgentsUnregister } from "../src/commands/agents";
import {
  getConfiguredDeviceRuntimeState,
  setConfiguredDeviceRuntimeState,
} from "../src/config/runtime-config";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("openmeld agents disable", () => {
  it("disables a registered agent", async () => {
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
        await runAgentsDisable({
          view: "agent",
          agent: ["codex"],
        });
      });

      const envelope = parseAgentResultEnvelope(
        stdout,
        "agents.disable.result"
      );
      const payload = envelope.payload as
        | {
            requested?: string[];
            disabled?: string[];
            skipped?: Array<{ agentId?: string; reason?: string }>;
          }
        | undefined;
      expect(payload?.requested).toEqual(["codex"]);
      expect(payload?.disabled).toEqual(["codex"]);
      const controllers = (await getConfiguredDeviceRuntimeState())
        ?.controllers;
      expect(controllers?.[0]?.agentId).toBe("codex");
      expect(controllers?.[0]?.enabled).toBe(false);
    });
  });

  it("emits a canonical JSON envelope with --json", async () => {
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
        await runAgentsDisable({
          json: true,
          agent: ["codex"],
        });
      });

      const envelope = parseJsonEnvelope(stdout, "agents.disable") as
        | { schemaVersion?: number; requested?: string[]; disabled?: string[] }
        | undefined;
      expect(envelope?.schemaVersion).toBe(1);
      expect(envelope?.requested).toEqual(["codex"]);
      expect(envelope?.disabled).toEqual(["codex"]);
      const controllers = (await getConfiguredDeviceRuntimeState())
        ?.controllers;
      expect(controllers?.[0]?.enabled).toBe(false);
    });
  });

  it("supports unregister compatibility alias", async () => {
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

      await runAgentsUnregister({
        view: "human",
        agentId: "codex",
      });

      const controllers = (await getConfiguredDeviceRuntimeState())
        ?.controllers;
      expect(controllers?.[0]?.enabled).toBe(false);
    });
  });

  it("reports errors when disabling unknown agent", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsDisable({
          view: "human",
          agent: ["missing"],
        });
      });
      expect(stdout).toContain("Needs Attention");
      expect(stdout).toContain("Not currently connected to OpenMeld");
    });
  });
});

function parseJsonEnvelope(
  stdout: string,
  type: string
): Record<string, unknown> | undefined {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { type?: string };
      if (parsed.type === type) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return undefined;
}

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
