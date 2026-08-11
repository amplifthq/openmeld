import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cliVersionStatus,
  disableAgents,
  disableServiceAutoStart,
  enableAgents,
  enableServiceAutoStart,
  installCli,
  serviceStatus,
  showAgent,
  upgradeCli,
} from "../src/main/cli/commands";
import type { ExecFileFn } from "../src/main/cli/driver";
import { readOpenMeldCliSetupProblem } from "../src/main/cli/install-cli";
import { resolveOpenMeldBin } from "../src/main/cli/resolve-openmeld";

type Sink = { file?: string; args?: readonly string[] };

const tempRoots: string[] = [];

function capturingExec(sink: Sink): ExecFileFn {
  return (file, args, _options, callback) => {
    sink.file = file;
    sink.args = args;
    callback(null, '{"schemaVersion":1,"type":"ok"}', "");
    return {};
  };
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openmeld-desktop-command-"));
  tempRoots.push(root);
  return root;
}

async function writeExecutable(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  await chmod(path, 0o755);
}

async function writeActiveBundle(input: {
  openMeldHome: string;
  bundleId: string;
  entryScriptRelativePath: string;
}): Promise<void> {
  await mkdir(join(input.openMeldHome, "runtime", "daemon", "state"), {
    recursive: true,
  });
  await writeFile(
    join(
      input.openMeldHome,
      "runtime",
      "daemon",
      "state",
      "active-bundle.json"
    ),
    JSON.stringify({
      v: 2,
      schema: "openmeld-daemon-active-bundle-v2",
      bundleId: input.bundleId,
      daemonVersion: "0.7.70",
      entryScriptRelativePath: input.entryScriptRelativePath,
      bundleFormat: "self_contained_v1",
      sourceKind: "package_install",
    })
  );
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("cli commands", () => {
  it("serviceStatus runs `service status --json`", async () => {
    const sink: Sink = {};
    await serviceStatus({ exec: capturingExec(sink) });
    expect(sink.args).toEqual(["service", "status", "--json"]);
  });

  it("upgradeCli runs non-interactive agent-view upgrade", async () => {
    const sink: Sink = {};
    await upgradeCli({ exec: capturingExec(sink) });
    expect(sink.args).toEqual(["upgrade", "--yes", "--view", "agent"]);
  });

  it("installCli installs the official global OpenMeld CLI npm package", async () => {
    const root = await tempRoot();
    const binDir = join(root, "bin");
    const npmBin = join(binDir, "npm");
    const nodeBin = join(binDir, "node");
    await writeExecutable(npmBin, "#!/bin/sh\n");
    await writeExecutable(nodeBin, "#!/bin/sh\n");
    const sink: Sink = {};

    await installCli({
      env: {
        OPENMELD_DESKTOP_DISABLE_COMMON_PATH_DIRS: "1",
        PATH: binDir,
      },
      exec: capturingExec(sink),
    });

    expect(sink.file).toBe(npmBin);
    expect(sink.args).toEqual(["install", "--global", "openmeld@latest"]);
  });

  it("installCli reports missing Node.js before trying npm", async () => {
    await expect(
      installCli({
        env: { OPENMELD_DESKTOP_DISABLE_COMMON_PATH_DIRS: "1", PATH: "" },
        exec: capturingExec({}),
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "desktop.node_missing" },
    });
  });

  it("detects the first-run OpenMeld CLI missing state after Node.js and npm exist", async () => {
    const root = await tempRoot();
    const binDir = join(root, "bin");
    await writeExecutable(join(binDir, "node"), "#!/bin/sh\n");
    await writeExecutable(join(binDir, "npm"), "#!/bin/sh\n");

    expect(
      readOpenMeldCliSetupProblem({
        env: {
          OPENMELD_BIN: "",
          OPENMELD_HOME: join(root, ".openmeld-empty"),
          OPENMELD_DESKTOP_DISABLE_COMMON_PATH_DIRS: "1",
          PATH: binDir,
        },
      })
    ).toMatchObject({
      code: "desktop.openmeld_cli_missing",
    });
  });

  it("cliVersionStatus reads current and latest versions from legacy agent view", async () => {
    const calls: string[][] = [];
    const exec: ExecFileFn = (_file, args, _options, callback) => {
      calls.push([...args]);
      if (args[0] === "--version") {
        callback(null, "0.7.78\n", "");
        return {};
      }
      callback(
        null,
        [
          '{"type":"result","code":"upgrade.agent_overview","payload":{}}',
          '{"type":"result","code":"upgrade.check","payload":{"status":"outdated","currentVersion":"0.7.78","latestVersion":"0.7.81","requiredFloor":"0.7.80","checkedAt":"2026-06-23T11:16:28.187Z"}}',
          "",
        ].join("\n"),
        ""
      );
      return {};
    };

    await expect(cliVersionStatus({ exec })).resolves.toEqual({
      checked: true,
      currentVersion: "0.7.78",
      latestVersion: "0.7.81",
      requiredVersion: "0.7.80",
      updateAvailable: true,
    });
    expect(calls).toEqual([
      ["--version"],
      ["upgrade", "--check", "--view", "agent"],
    ]);
  });

  it("enableServiceAutoStart runs `service autostart enable --json`", async () => {
    const sink: Sink = {};
    await enableServiceAutoStart({ exec: capturingExec(sink) });
    expect(sink.args).toEqual(["service", "autostart", "enable", "--json"]);
  });

  it("disableServiceAutoStart runs `service autostart disable --json`", async () => {
    const sink: Sink = {};
    await disableServiceAutoStart({ exec: capturingExec(sink) });
    expect(sink.args).toEqual(["service", "autostart", "disable", "--json"]);
  });

  it("serviceStatus uses the active bundle when openmeld is not on PATH", async () => {
    const root = await tempRoot();
    const openMeldHome = join(root, ".openmeld-fixture");
    const entryScriptRelativePath = "dist/openmeld";
    const entryPath = join(
      openMeldHome,
      "runtime",
      "daemon",
      "bundles",
      "bundle-1",
      entryScriptRelativePath
    );
    const statusEnvelope = JSON.stringify({
      schemaVersion: 1,
      type: "daemon.status",
      result: {
        installed: true,
        runtime: { status: "running" },
      },
    });
    await writeExecutable(
      entryPath,
      ["#!/bin/sh", `printf '%s\\n' '${statusEnvelope}'`, ""].join("\n")
    );
    await writeActiveBundle({
      openMeldHome,
      bundleId: "bundle-1",
      entryScriptRelativePath,
    });

    const result = await serviceStatus({
      env: { OPENMELD_BIN: "", OPENMELD_HOME: openMeldHome, PATH: "" },
      timeoutMs: 5000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.type).toBe("daemon.status");
      expect(result.data.result).toEqual({
        installed: true,
        runtime: { status: "running" },
      });
    }
  });

  it("enableAgents({ all }) passes --all", async () => {
    const sink: Sink = {};
    await enableAgents({ all: true }, { exec: capturingExec(sink) });
    expect(sink.args).toEqual(["agents", "enable", "--all", "--json"]);
  });

  it("enableAgents with explicit ids expands to repeated --agent", async () => {
    const sink: Sink = {};
    await enableAgents(
      { agentIds: ["codex", "claude-code"] },
      { exec: capturingExec(sink) }
    );
    expect(sink.args).toEqual([
      "agents",
      "enable",
      "--agent",
      "codex",
      "--agent",
      "claude-code",
      "--json",
    ]);
  });

  it("disableAgents with explicit ids", async () => {
    const sink: Sink = {};
    await disableAgents({ agentIds: ["codex"] }, { exec: capturingExec(sink) });
    expect(sink.args).toEqual([
      "agents",
      "disable",
      "--agent",
      "codex",
      "--json",
    ]);
  });

  it("showAgent runs `agents show <agent-id> --json`", async () => {
    const sink: Sink = {};
    await showAgent("codex", { exec: capturingExec(sink) });
    expect(sink.args).toEqual(["agents", "show", "codex", "--json"]);
  });

  it("resolveOpenMeldBin honors an explicit override", () => {
    expect(resolveOpenMeldBin({ override: "/opt/openmeld/bin/openmeld" })).toBe(
      "/opt/openmeld/bin/openmeld"
    );
  });

  it("resolveOpenMeldBin falls back to `openmeld` when nothing is configured", () => {
    expect(
      resolveOpenMeldBin({
        env: { OPENMELD_BIN: "", PATH: "" },
        homeDir: "/tmp/openmeld-desktop-no-home-fixture",
        override: "  ",
      })
    ).toBe("openmeld");
  });
});
