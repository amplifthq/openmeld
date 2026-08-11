import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAgentsEnable, runAgentsList } from "../src/commands/agents";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("openmeld agents config schema contracts", () => {
  it("emits parse fallback event for malformed runtime config in agent view", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        "{broken-json",
        "utf8"
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsList({ view: "agent" });
      });

      const fallbackEvent = parseAgentEnvelope(
        stdout,
        "line",
        "agents.config_parse_fallback"
      );
      expect(fallbackEvent?.data?.reason).toBe("invalid_json");
      expect(fallbackEvent?.data?.strategy).toBe("fallback_to_empty_config");

      const result = parseAgentEnvelope(stdout, "result", "agents.list.result");
      expect(result?.payload?.count).toBe(0);
    });
  });

  it("uses machine-readable validation code for register input errors", async () => {
    await withTempHome(async () => {
      await expect(
        runAgentsEnable({
          view: "agent",
        })
      ).rejects.toThrow("agents.enable_invalid:");
    });
  });
});

function parseAgentEnvelope(
  stdout: string,
  type: "line" | "result",
  code: string
):
  | {
      data?: { reason?: string; strategy?: string };
      payload?: { count?: number };
    }
  | undefined {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        code?: string;
        data?: { reason?: string; strategy?: string };
        payload?: { count?: number };
      };
      if (parsed.type === type && parsed.code === code) {
        return {
          ...(parsed.data ? { data: parsed.data } : {}),
          ...(parsed.payload ? { payload: parsed.payload } : {}),
        };
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return undefined;
}
