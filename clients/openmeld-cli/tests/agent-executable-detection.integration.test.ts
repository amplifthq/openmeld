import { constants } from "node:fs";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgentTargetState } from "../src/agents/registry";
import { withTempHome } from "./helpers/fs";

const DETECTION_ENV_KEYS = [
  "PATH",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "SHELL",
  "NVM_DIR",
  "PNPM_HOME",
  "BUN_INSTALL",
  "VOLTA_HOME",
  "ASDF_DIR",
  "FNM_DIR",
  "NPM_CONFIG_PREFIX",
  "OPENMELD_AGENT_DETECTION_PROBE_TIMEOUT_MS",
  "OPENMELD_EXECUTABLE_LOGIN_SHELL_TIMEOUT_MS",
  "OPENMELD_DAEMON_RUNTIME_REQUEST_TIMEOUT_MS",
  "OPENMELD_DAEMON_RUNTIME_CODEX_BIN",
  "OPENMELD_DAEMON_RUNTIME_CLAUDE_CODE_BIN",
  "OPENMELD_DAEMON_RUNTIME_OPENCODE_BIN",
  "OPENMELD_DAEMON_RUNTIME_OPENCLAW_BIN",
] as const;

describe("built-in agent executable detection", () => {
  it("detects a launchable agent even when its config directory has not been initialized", async () => {
    await withTempHome(async (home) => {
      await withAgentDetectionEnv(async ({ binDir }) => {
        await writeExecutableCommand({
          binDir,
          commandName: "codex",
          script:
            '#!/bin/sh\nif [ "$1" = "--version" ]; then echo \'codex 1.0.0\'; exit 0; fi\nexit 0\n',
        });

        const state = await resolveAgentTargetState("codex");

        expect(state).toMatchObject({
          agentId: "codex",
          detected: true,
          launchStatus: "ready",
          selectable: true,
          selectableReason: null,
        });
        expect(await pathExists(join(home, ".codex"))).toBe(false);
      });
    });
  });

  it("does not detect a built-in agent from stale config alone when no launchable executable exists", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".codex"), { recursive: true });

      await withAgentDetectionEnv(async () => {
        const state = await resolveAgentTargetState("codex");

        expect(state).toMatchObject({
          agentId: "codex",
          detected: false,
          launchStatus: "not_available",
          selectable: false,
          selectableReason: "not_detected",
        });
      });
    });
  });

  it("does not detect a built-in agent when neither executable nor config evidence exists", async () => {
    await withTempHome(async () => {
      await withAgentDetectionEnv(async () => {
        const state = await resolveAgentTargetState("codex");

        expect(state).toMatchObject({
          agentId: "codex",
          detected: false,
          launchStatus: "not_available",
          selectable: false,
          selectableReason: "not_detected",
        });
      });
    });
  });

  it("keeps a detected built-in agent ready when its executable probe times out", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".codex"), { recursive: true });

      await withAgentDetectionEnv(async ({ binDir }) => {
        await writeExecutableCommand({
          binDir,
          commandName: "codex",
          script: "#!/bin/sh\nsleep 2\n",
        });

        const startedAt = Date.now();
        const state = await resolveAgentTargetState("codex");
        const elapsedMs = Date.now() - startedAt;

        // A command that exists on PATH but never completes its --version
        // probe (timeout, or a real-world OS permission block like macOS
        // Gatekeeper) is still evidence the agent is installed on this
        // computer. An incomplete check must preserve that install evidence;
        // only a completed negative check may relabel it as needing repair.
        expect(state).toMatchObject({
          agentId: "codex",
          detected: true,
          launchStatus: "ready",
          launchStatusDetail: null,
          selectable: true,
          selectableReason: null,
        });
        expect(state?.launchContract).not.toBeNull();
        expect(elapsedMs).toBeLessThan(1500);
      });
    });
  });
});

async function withAgentDetectionEnv<T>(
  fn: (input: { binDir: string }) => Promise<T>
): Promise<T> {
  const previousEnv = new Map(
    DETECTION_ENV_KEYS.map((key) => [key, process.env[key]])
  );
  const home = process.env.HOME ?? "";
  const binDir = join(home, "bin");
  await mkdir(binDir, { recursive: true });
  // Keep the fixture isolated from user-installed agents while preserving the
  // POSIX tools used by probe scripts and process-tree cleanup.
  process.env.PATH = [binDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(
    delimiter
  );
  process.env.CODEX_HOME = join(home, ".codex");
  process.env.CLAUDE_CONFIG_DIR = join(home, ".claude");
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  process.env.SHELL = "/bin/false";
  process.env.NVM_DIR = join(home, ".nvm");
  process.env.PNPM_HOME = join(home, ".local", "share", "pnpm");
  process.env.BUN_INSTALL = join(home, ".bun");
  process.env.VOLTA_HOME = join(home, ".volta");
  process.env.ASDF_DIR = join(home, ".asdf");
  process.env.FNM_DIR = join(home, ".fnm");
  process.env.NPM_CONFIG_PREFIX = join(home, ".npm-global");
  process.env.OPENMELD_AGENT_DETECTION_PROBE_TIMEOUT_MS = "100";
  process.env.OPENMELD_EXECUTABLE_LOGIN_SHELL_TIMEOUT_MS = "100";
  // resolveAgentTargetState probes an agent's launch contract twice: once to
  // decide `detected` (gated by the probe timeout above), and again inside
  // install resolution to decide `launchStatus` -- that second probe has its
  // own, separate timeout knob. Keep both fast so a genuinely-unresponsive
  // fixture command stays a fast test instead of falling back to
  // verifyCliLaunchContract's much longer built-in default.
  process.env.OPENMELD_DAEMON_RUNTIME_REQUEST_TIMEOUT_MS = "100";
  Reflect.deleteProperty(process.env, "OPENMELD_DAEMON_RUNTIME_CODEX_BIN");
  Reflect.deleteProperty(
    process.env,
    "OPENMELD_DAEMON_RUNTIME_CLAUDE_CODE_BIN"
  );
  Reflect.deleteProperty(process.env, "OPENMELD_DAEMON_RUNTIME_OPENCODE_BIN");
  Reflect.deleteProperty(process.env, "OPENMELD_DAEMON_RUNTIME_OPENCLAW_BIN");
  try {
    return await fn({ binDir });
  } finally {
    for (const key of DETECTION_ENV_KEYS) {
      restoreEnv(key, previousEnv.get(key));
    }
  }
}

async function writeExecutableCommand(input: {
  binDir: string;
  commandName: string;
  script: string;
}): Promise<void> {
  const commandPath = join(input.binDir, input.commandName);
  await writeFile(commandPath, input.script, "utf8");
  await chmod(commandPath, 0o755);
}

async function pathExists(path: string): Promise<boolean> {
  return await access(path, constants.F_OK)
    .then(() => true)
    .catch(() => false);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }
  process.env[name] = value;
}
