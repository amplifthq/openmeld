import { execFile, spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { RuntimeAgentControllerLaunchContract } from "@openmeld/adapter-core";

const execute = promisify(execFile);
const VERSION = /^(\d+\.\d+\.\d+(?:-[\w.-]+)?)\s+\(Claude Code\)\s*$/u;

// The native updater switches its managed launcher and keeps running versions.
// Package managers, custom launchers, and app bundles have different owners.
export async function resolveClaudeNativeUpdateCommand(
  contract: RuntimeAgentControllerLaunchContract
): Promise<string | null> {
  if (
    process.platform === "win32" ||
    contract.kind !== "executable" ||
    contract.argsPrefix?.length
  ) {
    return null;
  }
  const home = process.env.HOME?.trim() || homedir();
  const launcher = join(home, ".local/bin/claude");
  if (resolve(contract.commandPath) !== resolve(launcher)) {
    return null;
  }
  try {
    if (!(await lstat(launcher)).isSymbolicLink()) {
      return null;
    }
    const target = await realpath(launcher);
    const versions = await realpath(join(home, ".local/share/claude/versions"));
    return dirname(target) === versions && (await lstat(target)).isFile()
      ? launcher
      : null;
  } catch {
    return null;
  }
}

export async function readClaudeNativeVersion(
  command: string
): Promise<string> {
  const result = await execute(command, ["--version"], {
    cwd: homedir(),
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    encoding: "utf8",
  });
  const version = result.stdout.trim().match(VERSION)?.[1];
  if (!version) {
    throw new Error("Could not verify the Claude Code version.");
  }
  return version;
}

export async function updateClaudeNativeInstallation(
  command: string
): Promise<void> {
  // Let the vendor own channel/policy/installer locks. Never parse UI shell text
  // or override settings to force an update. No total timeout kills an installer.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, ["update"], {
      cwd: homedir(),
      stdio: "ignore",
      shell: false,
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Claude Code updater exited with ${signal ?? code}.`));
      }
    });
  });
}
