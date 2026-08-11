import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPENCLAW_AUTH_PROFILE_FILENAME,
  resolveOpenClawAuthStatus,
} from "../src/provider-hosts/openclaw/local-state";
import { withTempHome } from "./helpers/fs";

describe("resolveOpenClawAuthStatus", () => {
  it("returns present when the target agent auth file exists", async () => {
    await withTempHome(async (home) => {
      const targetAgentDir = join(home, "target-agent");
      await mkdir(targetAgentDir, { recursive: true });
      await writeFile(
        join(targetAgentDir, OPENCLAW_AUTH_PROFILE_FILENAME),
        "{}\n",
        "utf8"
      );
      const targetAgent = {
        agentDir: targetAgentDir,
        agentId: "agent-target",
        isDefault: false,
        name: "Target",
        workspace: null,
      };

      const authStatus = await resolveOpenClawAuthStatus({
        agents: [targetAgent],
        targetAgent,
      });

      expect(authStatus).toBe("present");
    });
  });

  it("returns copied when the default agent auth file exists", async () => {
    await withTempHome(async (home) => {
      const targetAgentDir = join(home, "target-agent");
      const defaultAgentDir = join(home, "default-agent");
      await mkdir(targetAgentDir, { recursive: true });
      await mkdir(defaultAgentDir, { recursive: true });
      await writeFile(
        join(defaultAgentDir, OPENCLAW_AUTH_PROFILE_FILENAME),
        "{}\n",
        "utf8"
      );
      const defaultAgent = {
        agentDir: defaultAgentDir,
        agentId: "main",
        isDefault: true,
        name: "Default",
        workspace: null,
      };
      const targetAgent = {
        agentDir: targetAgentDir,
        agentId: "agent-target",
        isDefault: false,
        name: "Target",
        workspace: null,
      };

      const authStatus = await resolveOpenClawAuthStatus({
        agents: [defaultAgent, targetAgent],
        targetAgent,
      });

      expect(authStatus).toBe("copied");
    });
  });

  it("returns source_missing when neither target nor default auth file exists", async () => {
    await withTempHome(async (home) => {
      const targetAgentDir = join(home, "target-agent");
      const defaultAgentDir = join(home, "default-agent");
      await mkdir(targetAgentDir, { recursive: true });
      await mkdir(defaultAgentDir, { recursive: true });
      const defaultAgent = {
        agentDir: defaultAgentDir,
        agentId: "main",
        isDefault: true,
        name: "Default",
        workspace: null,
      };
      const targetAgent = {
        agentDir: targetAgentDir,
        agentId: "agent-target",
        isDefault: false,
        name: "Target",
        workspace: null,
      };

      const authStatus = await resolveOpenClawAuthStatus({
        agents: [defaultAgent, targetAgent],
        targetAgent,
      });

      expect(authStatus).toBe("source_missing");
    });
  });

  it("returns source_missing when targetAgent is null and no default agent exists", async () => {
    await withTempHome(async () => {
      const authStatus = await resolveOpenClawAuthStatus({
        agents: [],
        targetAgent: null,
      });

      expect(authStatus).toBe("source_missing");
    });
  });

  it("returns copied when targetAgent is null and the default agent auth file exists", async () => {
    await withTempHome(async (home) => {
      const defaultAgentDir = join(home, "default-agent");
      await mkdir(defaultAgentDir, { recursive: true });
      await writeFile(
        join(defaultAgentDir, OPENCLAW_AUTH_PROFILE_FILENAME),
        "{}\n",
        "utf8"
      );
      const defaultAgent = {
        agentDir: defaultAgentDir,
        agentId: "main",
        isDefault: true,
        name: "Default",
        workspace: null,
      };

      const authStatus = await resolveOpenClawAuthStatus({
        agents: [defaultAgent],
        targetAgent: null,
      });

      expect(authStatus).toBe("copied");
    });
  });
});
