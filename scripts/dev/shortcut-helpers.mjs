import { spawn } from "node:child_process";
import { chmod, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function installShortcutWrapper(input) {
  const globalBinDir = await resolveGlobalBinDir();
  await mkdir(globalBinDir, { recursive: true });
  const posixWrapperPath = join(globalBinDir, input.commandName);
  await writeShortcutFileAtomically(
    posixWrapperPath,
    buildPosixWrapper(input),
    {
      executable: process.platform !== "win32",
    }
  );
  if (process.platform === "win32") {
    const windowsWrapperPath = join(globalBinDir, `${input.commandName}.cmd`);
    await writeShortcutFileAtomically(
      windowsWrapperPath,
      buildWindowsWrapper(input)
    );
  }
  return {
    globalBinDir,
    wrapperPath: join(globalBinDir, input.commandName),
  };
}

export async function removeShortcutWrapper(input) {
  const globalBinDir = await resolveGlobalBinDir();
  await rm(join(globalBinDir, input.commandName), { force: true });
  await rm(join(globalBinDir, `${input.commandName}.cmd`), { force: true });
  return {
    globalBinDir,
    wrapperPath: join(globalBinDir, input.commandName),
  };
}

const ASSERT_FILE_EXISTS_TIMEOUT_MS = 2000;
const ASSERT_FILE_EXISTS_INTERVAL_MS = 50;

export async function assertFileExists(path, label, options = {}) {
  const timeoutMs = options.timeoutMs ?? ASSERT_FILE_EXISTS_TIMEOUT_MS;
  const deadlineMs = Date.now() + timeoutMs;
  while (Date.now() <= deadlineMs) {
    if (await pathExists(path)) {
      return;
    }
    await delay(ASSERT_FILE_EXISTS_INTERVAL_MS);
  }
  throw new Error(`${label} not found at ${path}`);
}

export async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeShortcutFileAtomically(
  targetPath,
  content,
  options = {}
) {
  const tempPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    await writeFile(tempPath, content, "utf8");
    if (options.executable) {
      await chmod(tempPath, 0o755);
    }
    await rename(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

export async function resolveGlobalBinDir() {
  const globalPrefix = await runCommandCapture("npm", ["prefix", "-g"]);
  const normalizedPrefix = globalPrefix.trim();
  if (!normalizedPrefix) {
    throw new Error("failed to resolve npm global prefix");
  }
  return process.platform === "win32"
    ? normalizedPrefix
    : join(normalizedPrefix, "bin");
}

export function normalizeAction(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export async function runCommand(command, args, options = {}) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      stdio: "inherit",
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${String(code)}`
        )
      );
    });
  });
}

export function runCommandCapture(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      rejectPromise(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${String(code)}\n${stderr}`
        )
      );
    });
  });
}

export function buildPosixWrapper(input) {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    `export OPENMELD_ENV_PRESET=${input.envPreset}`,
    `export OPENMELD_USER_FACING_CLI_COMMAND=${input.userFacingCommand}`,
    ...buildDefaultPosixEnvExports(input.defaultEnv),
    ...buildPosixFreshnessCheck(input.freshnessCheck),
    `exec node ${shellQuote(input.cliEntryPath)} "$@"`,
    "",
  ].join("\n");
}

export function buildWindowsWrapper(input) {
  return [
    "@echo off",
    "setlocal",
    `set "OPENMELD_ENV_PRESET=${input.envPreset}"`,
    `set "OPENMELD_USER_FACING_CLI_COMMAND=${input.userFacingCommand}"`,
    ...buildDefaultWindowsEnvExports(input.defaultEnv),
    ...buildWindowsFreshnessCheck(input.freshnessCheck),
    `node "${input.cliEntryPath}" %*`,
    "",
  ].join("\r\n");
}

function buildDefaultPosixEnvExports(defaultEnv) {
  if (!defaultEnv) {
    return [];
  }
  return Object.entries(defaultEnv).map(
    ([key, value]) =>
      `if [ -z "\${${key}:-}" ]; then export ${key}=${shellQuote(value)}; fi`
  );
}

function buildDefaultWindowsEnvExports(defaultEnv) {
  if (!defaultEnv) {
    return [];
  }
  return Object.entries(defaultEnv).map(
    ([key, value]) => `if "%${key}%"=="" set "${key}=${String(value)}"`
  );
}

function buildPosixFreshnessCheck(freshnessCheck) {
  if (!freshnessCheck) {
    return [];
  }
  return [
    [
      "node",
      shellQuote(freshnessCheck.checkerPath),
      shellQuote(freshnessCheck.cliEntryPath),
      shellQuote(freshnessCheck.buildCommand),
      ...freshnessCheck.sourcePaths.map((sourcePath) => shellQuote(sourcePath)),
    ].join(" "),
  ];
}

function buildWindowsFreshnessCheck(freshnessCheck) {
  if (!freshnessCheck) {
    return [];
  }
  return [
    [
      "node",
      windowsQuote(freshnessCheck.checkerPath),
      windowsQuote(freshnessCheck.cliEntryPath),
      windowsQuote(freshnessCheck.buildCommand),
      ...freshnessCheck.sourcePaths.map((sourcePath) =>
        windowsQuote(sourcePath)
      ),
    ].join(" "),
  ];
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function windowsQuote(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function delay(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
