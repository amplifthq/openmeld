import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgents } from "../src/commands/agents";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("openmeld agents menu", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders human menu output", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAgents({ view: "human" });
      });

      expect(stdout).toContain("OpenMeld agents commands:");
      expect(stdout).toContain("openmeld agents detect");
      expect(stdout).toContain("openmeld agents enable --all");
      expect(stdout).toContain("openmeld agents manage");
      expect(stdout).toContain("openmeld agents disable --all");
    });
  });

  it("emits structured payload in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAgents({ view: "agent" });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.menu.result");
      const payload = envelope.payload as
        | {
            commands?: string[];
            notes?: string[];
            selection?: {
              enableCandidates?: Array<{
                agentId?: string;
                selectable?: boolean;
                selectableReason?: string | null;
                status?: string;
              }>;
              selectableAgentIds?: string[];
              disableCandidates?: Array<{ agentId?: string }>;
              customAgents?: {
                supported?: boolean;
                message?: string;
                commands?: string[];
              };
            };
          }
        | undefined;
      expect(Array.isArray(payload?.commands)).toBe(true);
      expect(payload?.commands).toContain("openmeld agents detect");
      expect(payload?.commands).toContain("openmeld agents manage");
      expect(payload?.commands).toContain("openmeld agents disable --all");
      expect(payload?.commands).toContain("openmeld agents custom list");
      expect(payload?.notes).toContain(
        "Agents are AI tools on this computer. When you enable one, people in a Space can mention `@agent-id` to wake it and get a reply."
      );
      expect(payload?.notes).toContain(
        "Use `openmeld agents manage` to review enabled agents and change them later."
      );
      expect(payload?.notes).toContain(
        "Manage custom agents with `openmeld agents custom`."
      );
      expect(Array.isArray(payload?.selection?.enableCandidates)).toBe(true);
      expect(Array.isArray(payload?.selection?.selectableAgentIds)).toBe(true);
      expect(Array.isArray(payload?.selection?.disableCandidates)).toBe(true);
      expect(payload?.selection?.customAgents?.supported).toBe(false);
      expect(payload?.selection?.customAgents?.message).toContain(
        "not available in this list yet"
      );
      expect(payload?.selection?.customAgents?.message).toContain(
        "`openmeld agents custom`"
      );
      expect(payload?.selection?.customAgents?.commands).toContain(
        "openmeld agents custom add --name <name> --dir <dir> [--id <id>]"
      );
      expect(
        payload?.selection?.enableCandidates?.some(
          (candidate) =>
            typeof candidate.status === "string" &&
            typeof candidate.selectable === "boolean"
        )
      ).toBe(true);
    });
  });

  it("uses the active user-facing CLI command in agent view payload commands", async () => {
    await withTempHome(async () => {
      vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
      const { stdout } = await withCapturedStdio(async () => {
        await runAgents({ view: "agent" });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.menu.result");
      const payload = envelope.payload as
        | {
            actions?: Array<{ command?: string }>;
            commands?: string[];
            notes?: string[];
            selection?: {
              customAgents?: {
                commands?: string[];
                message?: string;
              };
            };
          }
        | undefined;

      expect(payload?.commands).toContain("openmeld-dev agents detect");
      expect(payload?.actions?.map((action) => action.command)).toContain(
        "openmeld-dev agents list"
      );
      expect(payload?.notes).toContain(
        "Use `openmeld-dev agents manage` to review enabled agents and change them later."
      );
      expect(payload?.selection?.customAgents?.message).toContain(
        "`openmeld-dev agents custom`"
      );
      expect(payload?.selection?.customAgents?.commands).toContain(
        "openmeld-dev agents custom add --name <name> --dir <dir> [--id <id>]"
      );
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
