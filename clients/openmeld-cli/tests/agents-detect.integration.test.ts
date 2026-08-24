import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { detectInstalledSkillsAgentsMock } = vi.hoisted(() => ({
  detectInstalledSkillsAgentsMock: vi.fn(),
}));

const { resolveBuiltinControllerInstallResolutionMock } = vi.hoisted(() => ({
  resolveBuiltinControllerInstallResolutionMock: vi.fn(),
}));

vi.mock("../src/skills/agents", async () => {
  const actual = await vi.importActual<typeof import("../src/skills/agents")>(
    "../src/skills/agents"
  );
  return {
    ...actual,
    detectInstalledRuntimeAgents: detectInstalledSkillsAgentsMock,
    detectInstalledSkillsAgents: detectInstalledSkillsAgentsMock,
  };
});

vi.mock("../src/agents/local-controller-install", async () => {
  const actual = await vi.importActual<
    typeof import("../src/agents/local-controller-install")
  >("../src/agents/local-controller-install");
  return {
    ...actual,
    resolveBuiltinControllerInstallResolution:
      resolveBuiltinControllerInstallResolutionMock,
  };
});

import { runAgentsDetect } from "../src/commands/agents";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("openmeld agents detect", () => {
  beforeEach(() => {
    detectInstalledSkillsAgentsMock.mockResolvedValue(["cursor", "codex"]);
    resolveBuiltinControllerInstallResolutionMock.mockImplementation(
      (input: { agentId: string; runtimeSupported: boolean }) => {
        if (!input.runtimeSupported) {
          return {
            detail: null,
            launchContract: null,
            status: "not_available" as const,
          };
        }
        if (input.agentId === "codex") {
          return {
            detail: null,
            launchContract: {
              kind: "executable" as const,
              commandPath: process.execPath,
            },
            status: "ready" as const,
          };
        }
        return {
          detail: "Needs repair on this computer before OpenMeld can start it.",
          launchContract: null,
          status: "needs_repair" as const,
        };
      }
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    detectInstalledSkillsAgentsMock.mockReset();
    resolveBuiltinControllerInstallResolutionMock.mockReset();
  });

  it("emits detected built-ins in structured agent output", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsDetect({
          view: "agent",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.detect.result");
      const payload = envelope.payload as
        | {
            count?: number;
            inventorySource?: string;
            source?: string;
            detectedAgents?: Array<{
              blockerReasonCodes?: string[];
              id?: string;
              displayName?: string;
              lifecycleStatus?: string;
              launchability?: string;
              launchStatus?: string;
            }>;
          }
        | undefined;
      expect(payload?.source).toBe("builtin_detect");
      expect(payload?.inventorySource).toBe("local_runtime_inventory");
      expect(payload?.count).toBe(2);
      expect(payload?.detectedAgents?.map((item) => item.id)).toEqual([
        "codex",
        "cursor",
      ]);
      const codexAgent = payload?.detectedAgents?.find(
        (item) => item.id === "codex"
      );
      expect(codexAgent?.launchability).toBe("launchable");
      expect(codexAgent?.launchStatus).toBe("available");
      expect(codexAgent?.lifecycleStatus).toBe("active");
      expect(codexAgent?.blockerReasonCodes).toEqual([]);
    });
  });

  it("does not surface unconfigured suspended agents as detected choices", async () => {
    await withTempHome(async () => {
      detectInstalledSkillsAgentsMock.mockResolvedValue(["codex", "openclaw"]);

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsDetect({
          view: "agent",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.detect.result");
      const payload = envelope.payload as
        | {
            count?: number;
            detectedAgents?: Array<{
              id?: string;
              lifecycleStatus?: string;
            }>;
          }
        | undefined;

      expect(payload?.count).toBe(1);
      expect(payload?.detectedAgents).toEqual([
        {
          blockerReasonCodes: [],
          displayName: "Codex",
          id: "codex",
          launchability: "launchable",
          launchStatus: "available",
          launchStatusDetail: null,
          lifecycleStatus: "active",
          selectable: true,
        },
      ]);
    });
  });

  it("emits a canonical JSON envelope with --json", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsDetect({
          json: true,
        });
      });

      const envelope = parseJsonEnvelope(stdout, "agents.detect") as
        | {
            schemaVersion?: number;
            count?: number;
            inventorySource?: string;
            source?: string;
            detectedAgents?: Array<{ id?: string }>;
          }
        | undefined;
      expect(envelope?.schemaVersion).toBe(1);
      expect(envelope?.source).toBe("builtin_detect");
      expect(envelope?.inventorySource).toBe("local_runtime_inventory");
      expect(envelope?.count).toBe(2);
      expect(envelope?.detectedAgents?.map((item) => item.id)).toEqual([
        "codex",
        "cursor",
      ]);
      expect(stdout).not.toContain("Agents Found Here");
    });
  });

  it("marks detected supported agents that need repair in human output", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsDetect({
          view: "human",
        });
      });

      expect(stdout).toContain("Agents Found Here");
      expect(stdout).toContain("Available Now (1)");
      expect(stdout).toContain("@codex");
      expect(stdout).toContain("Codex");
      expect(stdout).toContain("Needs Repair (1)");
      expect(stdout).not.toContain("✅ @codex");
      expect(stdout).toContain("@cursor");
      expect(stdout).toContain("Cursor");
      expect(stdout).toContain(
        "Needs repair on this computer before OpenMeld can start it."
      );
      expect(stdout).not.toContain("\u0336");
    });
  });

  it("surfaces a detected agent that cannot launch with its real reason, not as not-found", async () => {
    await withTempHome(async () => {
      detectInstalledSkillsAgentsMock.mockResolvedValue(["codex"]);
      resolveBuiltinControllerInstallResolutionMock.mockImplementation(() => ({
        detail:
          "Codex is installed, but OpenMeld can't start it on this device.",
        launchContract: null,
        status: "needs_repair" as const,
      }));

      const { stdout: humanStdout } = await withCapturedStdio(async () => {
        await runAgentsDetect({ view: "human" });
      });

      expect(humanStdout).toContain("Needs Repair (1)");
      expect(humanStdout).toContain(
        "Codex is installed, but OpenMeld can't start it on this device."
      );
      // The old generic placeholder must not paper over the real reason.
      expect(humanStdout).not.toContain(
        "Repair on this computer before OpenMeld can start it"
      );

      const { stdout: agentStdout } = await withCapturedStdio(async () => {
        await runAgentsDetect({ view: "agent" });
      });
      const envelope = parseAgentResultEnvelope(
        agentStdout,
        "agents.detect.result"
      );
      const payload = envelope.payload as
        | {
            detectedAgents?: Array<{
              id?: string;
              blockerReasonCodes?: string[];
              launchability?: string;
              launchStatus?: string;
              launchStatusDetail?: string | null;
              selectable?: boolean;
            }>;
          }
        | undefined;
      const codexAgent = payload?.detectedAgents?.find(
        (item) => item.id === "codex"
      );
      // A launch-verification failure ("not_launchable") is still a detection:
      // codex must show up here at all, with a machine-readable status and
      // reason, instead of being dropped from detectedAgents entirely.
      expect(codexAgent).toBeDefined();
      expect(codexAgent?.launchability).toBe("needs_repair");
      expect(codexAgent?.launchStatus).toBe("needs_repair");
      expect(codexAgent?.launchStatusDetail).toBe(
        "Codex is installed, but OpenMeld can't start it on this device."
      );
      expect(codexAgent?.blockerReasonCodes).toEqual([
        "controller.launch.needs_repair",
      ]);
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
