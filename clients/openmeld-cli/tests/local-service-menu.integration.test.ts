import { describe, expect, it } from "vitest";
import { runDaemon } from "../src/commands/service";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("openmeld service menu", () => {
  it("renders human menu output", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemon({ view: "human" });
      });

      expect(stdout).toContain("OpenMeld Service commands:");
      expect(stdout).toContain("openmeld service start");
      expect(stdout).toContain("openmeld service status");
      expect(stdout).toContain("openmeld service install");
      expect(stdout).toContain("openmeld service repair");
      expect(stdout).toContain("openmeld service update");
      expect(stdout).toContain("openmeld service uninstall");
    });
  });

  it("emits structured payload in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemon({ view: "agent" });
      });

      const envelope = parseAgentResultEnvelope(stdout, "daemon.menu.result");
      const payload = envelope.payload as
        | {
            commands?: string[];
            notes?: string[];
            actions?: Array<{ command?: string; description?: string }>;
          }
        | undefined;

      expect(Array.isArray(payload?.commands)).toBe(true);
      expect(payload?.commands).toContain("openmeld service start");
      expect(payload?.commands).toContain("openmeld service status");
      expect(payload?.commands).toContain("openmeld service install");
      expect(payload?.commands).toContain("openmeld service repair");
      expect(payload?.commands).toContain("openmeld service update");
      expect(payload?.commands).toContain("openmeld service uninstall");
      expect(payload?.notes).toContain(
        "status reports install state and current runtime status"
      );
      expect(
        payload?.actions?.some(
          (item) => item.command === "openmeld service install"
        )
      ).toBe(true);
      expect(
        payload?.actions?.some(
          (item) => item.command === "openmeld service repair"
        )
      ).toBe(true);
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
