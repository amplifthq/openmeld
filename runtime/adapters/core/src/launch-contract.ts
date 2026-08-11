import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync } from "node:fs";
import { access, open, realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, extname, isAbsolute, join } from "node:path";
import type {
  RuntimeAgentControllerLaunchCandidate,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/schemas/types";
import { CliDriverError, runCliDriver } from "./drivers/cli-driver.js";

export type CliLaunchCommand = {
  argsPrefix: string[];
  bin: string;
  shell?: boolean;
};

export type LaunchContractVerificationFailureKind =
  | "completed_negative"
  | "incomplete_check";

export type LaunchContractVerificationResult =
  | {
      launchCommand: CliLaunchCommand;
      ok: true;
    }
  | {
      errorMessage: string;
      failureKind: LaunchContractVerificationFailureKind;
      ok: false;
    };

export type InstalledLaunchContractResolution =
  | {
      commandPath: string;
      launchContract: RuntimeAgentControllerLaunchContract;
      ok: true;
    }
  | {
      errorMessage: string;
      ok: false;
    };

// "not_installed": no command path for this agent exists on this device at
// all -- there is nothing to launch. "not_launchable": OpenMeld found the
// agent (a command path exists, and it inspected as a real launch candidate)
// but every candidate failed launch verification (spawn failure, timeout, or
// exited non-zero) -- e.g. an OS permission check (Gatekeeper) blocking the
// process, or a corrupted install. Consumers must not fold "not_launchable"
// into "not found on this computer": the agent is there, it just cannot
// start right now, and that distinction is what lets detection surfaces show
// it instead of silently dropping it.
export type InstalledLaunchCandidatesFailureReason =
  | "not_installed"
  | "not_launchable";

export type InstalledLaunchCandidatesResolution =
  | {
      candidates: RuntimeAgentControllerLaunchCandidate[];
      ok: true;
    }
  | {
      errorMessage: string;
      reason: InstalledLaunchCandidatesFailureReason;
      ok: false;
    };

const ENV_NODE_SHEBANG = "#!/usr/bin/env node";
const WINDOWS_PATHEXT = [".com", ".exe", ".bat", ".cmd"] as const;
const SHEBANG_ARGS_SPLIT_RE = /\s+/;
const FIRST_LINE_SPLIT_RE = /\r?\n/u;
const LOGIN_SHELL_OUTPUT_LINE_SPLIT_RE = /\r?\n/u;
const SAFE_POSIX_SHELL_TOKEN_RE = /^[A-Za-z0-9_./:@%+=,-]+$/u;
const NVM_VERSION_VALUE_RE = /^v?\d+(?:\.\d+){0,2}$/u;
const NODE_VERSION_PATH_RE = /(?:^|\/)v?(\d+\.\d+\.\d+)(?:\/|$)/u;
const MACOS_TEMP_FOLDER_RE = /^\/var\/folders\/[^/]+\/[^/]+\/t(?:\/|$)/u;
const WRAPPER_PATH_SEGMENT_RE =
  /(?:^|[-_.])(?:shim|shims|wrapper|wrappers)(?:$|[-_.])/u;
const MAX_LAUNCH_SCRIPT_INSPECTION_BYTES = 64 * 1024;
const DEFAULT_LOGIN_SHELL_LOOKUP_TIMEOUT_MS = 1500;
const HOME_DIR = normalizeOptionalText(homedir());
const TEMP_DIR = normalizeOptionalText(tmpdir());
const loginShellExecutablePathsCache = new Map<string, Promise<string[]>>();

export function buildExecutableLaunchContract(input: {
  argsPrefix?: string[];
  commandPath: string;
}): RuntimeAgentControllerLaunchContract {
  return {
    kind: "executable",
    commandPath: input.commandPath,
    ...(input.argsPrefix && input.argsPrefix.length > 0
      ? { argsPrefix: [...input.argsPrefix] }
      : {}),
  };
}

export function materializeCliLaunchCommand(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
}): CliLaunchCommand {
  if (input.launchContract.kind === "executable") {
    const shell = commandPathRequiresShell(input.launchContract.commandPath);
    return {
      argsPrefix: [...(input.launchContract.argsPrefix ?? [])],
      bin: input.launchContract.commandPath,
      ...(shell ? { shell: true } : {}),
    };
  }

  return {
    argsPrefix: [
      input.launchContract.scriptPath,
      ...(input.launchContract.argsPrefix ?? []),
    ],
    bin: input.launchContract.nodePath,
  };
}

export function buildCliLaunchInvocation(input: {
  args: string[];
  launchContract: RuntimeAgentControllerLaunchContract;
}): {
  args: string[];
  bin: string;
  shell?: boolean;
} {
  const launchCommand = materializeCliLaunchCommand({
    launchContract: input.launchContract,
  });
  return {
    args: [...launchCommand.argsPrefix, ...input.args],
    bin: launchCommand.bin,
    ...(launchCommand.shell ? { shell: true } : {}),
  };
}

export async function verifyLaunchContractFiles(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
}): Promise<LaunchContractVerificationResult> {
  try {
    const launchCommand = materializeCliLaunchCommand(input);
    if (input.launchContract.kind === "executable") {
      await assertExecutablePath(input.launchContract.commandPath);
    } else {
      await assertExecutablePath(input.launchContract.nodePath);
      await assertReadablePath(input.launchContract.scriptPath);
    }
    return {
      launchCommand,
      ok: true,
    };
  } catch (error) {
    return {
      errorMessage: toErrorMessage(error),
      failureKind: "completed_negative",
      ok: false,
    };
  }
}

export async function verifyCliLaunchContract(input: {
  cwd: string;
  displayName: string;
  env?: Record<string, string | undefined>;
  launchContract: RuntimeAgentControllerLaunchContract;
  probeArgs: string[];
  timeoutMs?: number | null;
}): Promise<LaunchContractVerificationResult> {
  const fileCheck = await verifyLaunchContractFiles({
    launchContract: input.launchContract,
  });
  if (!fileCheck.ok) {
    return {
      errorMessage: `${input.displayName} launch contract is broken on this device: ${fileCheck.errorMessage}`,
      failureKind: "completed_negative",
      ok: false,
    };
  }

  try {
    const invocation = buildCliLaunchInvocation({
      args: input.probeArgs,
      launchContract: input.launchContract,
    });
    await runCliDriver({
      allowNonZeroExit: false,
      args: invocation.args,
      bin: invocation.bin,
      cwd: input.cwd,
      env: input.env,
      timeoutMs: input.timeoutMs ?? 15_000,
    });
    return fileCheck;
  } catch (error) {
    return {
      errorMessage: `${input.displayName} can't start on this device: ${toErrorMessage(error)}`,
      failureKind: classifyLaunchContractVerificationFailure(error),
      ok: false,
    };
  }
}

export async function resolveLaunchCandidatesAfterVerification(input: {
  candidates: readonly RuntimeAgentControllerLaunchCandidate[];
  verify: (
    candidate: RuntimeAgentControllerLaunchCandidate
  ) => Promise<LaunchContractVerificationResult>;
}): Promise<RuntimeAgentControllerLaunchCandidate[]> {
  const outcomes = await Promise.all(
    input.candidates.map(async (candidate) => ({
      candidate,
      verification: await input.verify(candidate),
    }))
  );
  const verifiedCandidates = outcomes
    .filter(({ verification }) => verification.ok)
    .map(({ candidate }) => candidate);
  if (verifiedCandidates.length > 0) {
    return verifiedCandidates;
  }
  return outcomes
    .filter(
      ({ verification }) =>
        !verification.ok && verification.failureKind === "incomplete_check"
    )
    .map(({ candidate }) => candidate);
}

function classifyLaunchContractVerificationFailure(
  error: unknown
): LaunchContractVerificationFailureKind {
  return error instanceof CliDriverError &&
    error.code === "process.non_zero_exit" &&
    typeof error.exitCode === "number"
    ? "completed_negative"
    : "incomplete_check";
}

export async function resolveInstalledNodeScriptLaunchContract(input: {
  additionalCommandDirectories?: readonly string[] | null;
  commandName: string;
  configuredCommand?: string | null;
  displayName: string;
}): Promise<InstalledLaunchContractResolution> {
  const candidates = await resolveInstalledNodeScriptLaunchCandidates({
    additionalCommandDirectories: input.additionalCommandDirectories ?? null,
    commandName: input.commandName,
    configuredCommand: input.configuredCommand ?? null,
    displayName: input.displayName,
  });
  if (!candidates.ok) {
    return candidates;
  }

  const candidate = candidates.candidates[0] ?? null;
  if (!candidate) {
    return {
      errorMessage: `${input.displayName} is not installed on this device.`,
      ok: false,
    };
  }
  return {
    commandPath: candidate.commandPath,
    launchContract: candidate.launchContract,
    ok: true,
  };
}

export async function resolveInstalledNodeScriptLaunchCandidates(input: {
  additionalCommandDirectories?: readonly string[] | null;
  commandName: string;
  configuredCommand?: string | null;
  displayName: string;
}): Promise<InstalledLaunchCandidatesResolution> {
  const commandPaths = await resolveInstalledCommandPathsForLaunch({
    additionalCommandDirectories: input.additionalCommandDirectories ?? null,
    commandName: input.commandName,
    configuredCommand: input.configuredCommand ?? null,
  });
  if (commandPaths.length === 0) {
    return {
      errorMessage: `${input.displayName} is not installed on this device.`,
      reason: "not_installed",
      ok: false,
    };
  }

  const candidates: Array<{
    dedupeId: string;
    launchCandidate: RuntimeAgentControllerLaunchCandidate;
    transientWrapper: boolean;
  }> = [];
  const candidateIds = new Set<string>();
  const inspectionErrors: string[] = [];

  for (const commandPath of commandPaths) {
    const candidate = await inspectInstalledNodeScriptLaunchCandidate({
      commandPath,
      displayName: input.displayName,
    });
    if (!candidate.ok) {
      inspectionErrors.push(candidate.errorMessage);
      continue;
    }
    if (candidateIds.has(candidate.dedupeId)) {
      continue;
    }
    candidateIds.add(candidate.dedupeId);
    candidates.push(candidate);
  }

  if (candidates.length === 0) {
    return {
      errorMessage:
        inspectionErrors[0] ??
        `${input.displayName} is installed, but OpenMeld could not inspect its launch files.`,
      reason: "not_launchable",
      ok: false,
    };
  }

  const stableCandidates = candidates.filter(
    (candidate) => !candidate.transientWrapper
  );
  const selectedCandidates =
    stableCandidates.length > 0 ? stableCandidates : candidates;

  return {
    candidates: finalizeLaunchCandidateDisplayMetadata(
      selectedCandidates.map((candidate) => candidate.launchCandidate)
    ),
    ok: true,
  };
}

async function inspectInstalledNodeScriptLaunchCandidate(input: {
  commandPath: string;
  displayName: string;
}): Promise<
  | {
      dedupeId: string;
      launchCandidate: RuntimeAgentControllerLaunchCandidate;
      ok: true;
      transientWrapper: boolean;
    }
  | {
      errorMessage: string;
      ok: false;
    }
> {
  try {
    await assertExecutablePath(input.commandPath);
    const resolvedScriptPath = await realpath(input.commandPath);
    const script = await readLaunchScriptInspection(resolvedScriptPath);
    const nodePath = await resolvePinnedNodePath({
      firstLine: script.firstLine,
      commandPath: input.commandPath,
      scriptPath: resolvedScriptPath,
    });
    const transientWrapper = isTransientPathWrapper({
      commandPath: input.commandPath,
      contents: script.contents,
      firstLine: script.firstLine,
      scriptPath: resolvedScriptPath,
    });
    const launchContract = nodePath
      ? ({
          kind: "node_script",
          nodePath,
          // Keep the user-facing command entrypoint in the launch contract.
          // Managed CLIs such as cursor-agent update this symlink in place;
          // persisting its resolved version file would pin OpenMeld to the old
          // release forever even though the official command has moved on.
          scriptPath: input.commandPath,
        } satisfies RuntimeAgentControllerLaunchContract)
      : buildExecutableLaunchContract({
          commandPath: input.commandPath,
        });
    const canonicalLaunchContract = nodePath
      ? ({
          kind: "node_script",
          nodePath,
          scriptPath: resolvedScriptPath,
        } satisfies RuntimeAgentControllerLaunchContract)
      : buildExecutableLaunchContract({
          commandPath: resolvedScriptPath,
        });

    return {
      dedupeId: buildLaunchCandidateInstallId(canonicalLaunchContract),
      launchCandidate: buildLaunchCandidate({
        commandPath: input.commandPath,
        launchContract,
        transientWrapper,
      }),
      ok: true,
      transientWrapper,
    };
  } catch (error) {
    return {
      errorMessage: `${input.displayName} is installed, but OpenMeld could not inspect its launch files: ${toErrorMessage(error)}`,
      ok: false,
    };
  }
}

export function resolveInstalledCommandPath(input: {
  commandName: string;
  configuredCommand?: string | null;
}): string | null {
  return resolveInstalledCommandPaths(input)[0] ?? null;
}

export function resolveInstalledCommandPaths(input: {
  commandName: string;
  configuredCommand?: string | null;
}): string[] {
  const configuredCommand = normalizeOptionalText(input.configuredCommand);
  if (configuredCommand) {
    if (isAbsolute(configuredCommand)) {
      return [configuredCommand];
    }
    if (configuredCommand.includes("/") || configuredCommand.includes("\\")) {
      return [];
    }
    return resolveExecutablePathsOnPath(configuredCommand);
  }
  return resolveExecutablePathsOnPath(input.commandName);
}

async function resolveInstalledCommandPathsForLaunch(input: {
  additionalCommandDirectories?: readonly string[] | null;
  commandName: string;
  configuredCommand?: string | null;
}): Promise<string[]> {
  const configuredCommand = normalizeOptionalText(input.configuredCommand);
  if (configuredCommand) {
    if (isAbsolute(configuredCommand)) {
      return [configuredCommand];
    }
    if (configuredCommand.includes("/") || configuredCommand.includes("\\")) {
      return [];
    }
    return await resolveExecutablePathsFromSearchSurface({
      additionalCommandDirectories: input.additionalCommandDirectories ?? null,
      commandName: configuredCommand,
    });
  }
  return await resolveExecutablePathsFromSearchSurface({
    additionalCommandDirectories: input.additionalCommandDirectories ?? null,
    commandName: input.commandName,
  });
}

export function resolveExecutableOnPath(commandName: string): string | null {
  return resolveExecutablePathsOnPath(commandName)[0] ?? null;
}

export function resolveExecutablePathsOnPath(commandName: string): string[] {
  const normalizedCommandName = normalizeOptionalText(commandName);
  if (!normalizedCommandName) {
    return [];
  }
  const resolvedPaths: string[] = [];
  for (const directory of resolvePathDirectories()) {
    for (const candidateName of resolveCommandFileNameCandidates(
      normalizedCommandName
    )) {
      const candidate = join(directory, candidateName);
      if (
        pathLooksExecutable(candidate) &&
        !resolvedPaths.includes(candidate)
      ) {
        resolvedPaths.push(candidate);
      }
    }
  }
  return resolvedPaths;
}

async function resolveExecutablePathsFromSearchSurface(input: {
  additionalCommandDirectories?: readonly string[] | null;
  commandName: string;
}): Promise<string[]> {
  const pathMatches = resolveExecutablePathsOnPath(input.commandName);
  const additionalDirectoryMatches = resolveExecutablePathsFromDirectories({
    commandName: input.commandName,
    directories: input.additionalCommandDirectories ?? [],
  });
  const knownInstallMatches = resolveExecutablePathsFromKnownInstallDirectories(
    input.commandName
  );
  const localMatches = mergeUniquePaths(
    mergeUniquePaths(pathMatches, additionalDirectoryMatches),
    knownInstallMatches
  );
  if (localMatches.length > 0) {
    return localMatches;
  }

  const loginShellPaths = await resolveExecutablePathsFromLoginShell(
    input.commandName
  );
  return mergeUniquePaths(localMatches, loginShellPaths);
}

function resolvePathDirectories(): string[] {
  const directories: string[] = [];
  const pathValue = normalizeOptionalText(process.env.PATH);
  for (const pathEntry of pathValue?.split(delimiter) ?? []) {
    addUniqueDirectory(directories, pathEntry);
  }
  return directories;
}

function resolveExecutablePathsFromKnownInstallDirectories(
  commandName: string
): string[] {
  return resolveExecutablePathsFromDirectories({
    commandName,
    directories: resolveKnownInstallDirectories(),
  });
}

function resolveExecutablePathsFromDirectories(input: {
  commandName: string;
  directories: readonly string[];
}): string[] {
  const normalizedCommandName = normalizeOptionalText(input.commandName);
  if (!normalizedCommandName) {
    return [];
  }
  const resolvedPaths: string[] = [];
  for (const directory of input.directories) {
    for (const candidateName of resolveCommandFileNameCandidates(
      normalizedCommandName
    )) {
      const candidate = join(directory, candidateName);
      if (
        pathLooksExecutable(candidate) &&
        !resolvedPaths.includes(candidate)
      ) {
        resolvedPaths.push(candidate);
      }
    }
  }
  return resolvedPaths;
}

function resolveKnownInstallDirectories(): string[] {
  const directories: string[] = [];
  if (process.platform === "win32") {
    return directories;
  }

  const home = resolveHomeDirectory();
  const nvmDir =
    normalizeOptionalText(process.env.NVM_DIR) ?? join(home, ".nvm");
  const pnpmHome =
    normalizeOptionalText(process.env.PNPM_HOME) ??
    (process.platform === "darwin"
      ? join(home, "Library", "pnpm")
      : join(home, ".local", "share", "pnpm"));
  const bunHome =
    normalizeOptionalText(process.env.BUN_INSTALL) ?? join(home, ".bun");
  const voltaHome =
    normalizeOptionalText(process.env.VOLTA_HOME) ?? join(home, ".volta");
  const asdfHome =
    normalizeOptionalText(process.env.ASDF_DIR) ?? join(home, ".asdf");
  const fnmHome =
    normalizeOptionalText(process.env.FNM_DIR) ?? join(home, ".fnm");

  addUniqueDirectory(directories, join(home, ".local", "bin"));
  addUniqueDirectory(directories, "/usr/local/bin");
  addUniqueDirectory(directories, "/opt/homebrew/bin");
  addUniqueDirectory(directories, join(bunHome, "bin"));
  addUniqueDirectory(directories, pnpmHome);
  addUniqueDirectory(directories, join(home, ".npm-global", "bin"));
  addUniqueDirectory(directories, join(home, ".yarn", "bin"));
  addUniqueDirectory(
    directories,
    join(home, ".config", "yarn", "global", "node_modules", ".bin")
  );
  addUniqueDirectory(directories, join(voltaHome, "bin"));
  addUniqueDirectory(directories, join(asdfHome, "shims"));
  addUniqueDirectory(directories, join(fnmHome, "aliases", "default", "bin"));
  addUniqueDirectory(
    directories,
    join(home, ".local", "share", "fnm", "aliases", "default", "bin")
  );
  addUniqueDirectory(
    directories,
    join(home, ".local", "share", "fnm", "current", "bin")
  );

  for (const nvmBinDir of resolveNvmDefaultBinDirectories(nvmDir)) {
    addUniqueDirectory(directories, nvmBinDir);
  }

  const npmConfigPrefix = normalizeOptionalText(process.env.NPM_CONFIG_PREFIX);
  if (npmConfigPrefix) {
    addUniqueDirectory(directories, join(npmConfigPrefix, "bin"));
  }

  return directories;
}

function addUniqueDirectory(directories: string[], value: unknown): void {
  const directory = normalizeOptionalText(value);
  if (directory && !directories.includes(directory)) {
    directories.push(directory);
  }
}

async function resolveExecutablePathsFromLoginShell(
  commandName: string
): Promise<string[]> {
  const normalizedCommandName = normalizeOptionalText(commandName);
  if (!(normalizedCommandName && process.platform !== "win32")) {
    return [];
  }
  const shell = normalizeOptionalText(process.env.SHELL);
  if (!(shell && isAbsolute(shell) && pathLooksExecutable(shell))) {
    return [];
  }
  const cacheKey = [
    shell,
    normalizedCommandName,
    process.env.HOME ?? "",
    process.env.PATH ?? "",
  ].join("\0");
  let cached = loginShellExecutablePathsCache.get(cacheKey);
  if (!cached) {
    cached = runLoginShellExecutableLookup({
      commandName: normalizedCommandName,
      shell,
    });
    loginShellExecutablePathsCache.set(cacheKey, cached);
  }
  return await cached;
}

async function runLoginShellExecutableLookup(input: {
  commandName: string;
  shell: string;
}): Promise<string[]> {
  const timeoutMs = resolveLoginShellLookupTimeoutMs();
  return await new Promise((resolve) => {
    const child = spawn(
      input.shell,
      ["-lic", `command -v ${quotePosixShellToken(input.commandName)}`],
      {
        env: process.env,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }
    );
    let stdout = "";
    let settled = false;
    const finish = (paths: string[]) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(paths);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish([]);
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.once("error", () => {
      finish([]);
    });
    child.once("close", (code) => {
      if (code !== 0) {
        finish([]);
        return;
      }
      finish(
        stdout
          .split(LOGIN_SHELL_OUTPUT_LINE_SPLIT_RE)
          .map((line) => normalizeOptionalText(line))
          .filter((line): line is string =>
            Boolean(line && isAbsolute(line) && pathLooksExecutable(line))
          )
      );
    });
  });
}

function resolveNvmDefaultBinDirectories(nvmDir: string): string[] {
  const version = resolveNvmDefaultVersion(nvmDir);
  if (!version) {
    return [];
  }
  return [join(nvmDir, "versions", "node", version, "bin")];
}

function resolveNvmDefaultVersion(nvmDir: string): string | null {
  let value = readNvmAlias(nvmDir, "default");
  const seenAliases = new Set<string>();
  for (let depth = 0; depth < 4; depth += 1) {
    const normalizedValue = normalizeOptionalText(value);
    if (!normalizedValue) {
      return null;
    }
    if (isNvmVersionValue(normalizedValue)) {
      return normalizedValue.startsWith("v")
        ? normalizedValue
        : `v${normalizedValue}`;
    }
    if (seenAliases.has(normalizedValue)) {
      return null;
    }
    seenAliases.add(normalizedValue);
    value = readNvmAlias(nvmDir, normalizedValue);
  }
  return null;
}

function readNvmAlias(nvmDir: string, alias: string): string | null {
  try {
    return normalizeOptionalText(
      readFileSync(join(nvmDir, "alias", alias), "utf8")
    );
  } catch {
    return null;
  }
}

function isNvmVersionValue(value: string): boolean {
  return NVM_VERSION_VALUE_RE.test(value);
}

function resolveHomeDirectory(): string {
  return normalizeOptionalText(process.env.HOME) ?? homedir();
}

function resolveLoginShellLookupTimeoutMs(): number {
  const raw = normalizeOptionalText(
    process.env.OPENMELD_EXECUTABLE_LOGIN_SHELL_TIMEOUT_MS
  );
  if (!raw) {
    return DEFAULT_LOGIN_SHELL_LOOKUP_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_LOGIN_SHELL_LOOKUP_TIMEOUT_MS;
}

function mergeUniquePaths(left: string[], right: string[]): string[] {
  const merged = [...left];
  for (const path of right) {
    if (!merged.includes(path)) {
      merged.push(path);
    }
  }
  return merged;
}

function quotePosixShellToken(value: string): string {
  if (SAFE_POSIX_SHELL_TOKEN_RE.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function resolveSiblingCommandPath(input: {
  anchorPath: string;
  commandName: string;
}): string | null {
  const normalizedCommandName = normalizeOptionalText(input.commandName);
  if (!normalizedCommandName) {
    return null;
  }

  const siblingDirectory = dirname(input.anchorPath);
  for (const candidateName of resolveCommandFileNameCandidates(
    normalizedCommandName
  )) {
    const candidate = join(siblingDirectory, candidateName);
    if (pathLooksExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function resolvePinnedNodePath(input: {
  commandPath: string;
  firstLine: string | null;
  scriptPath: string;
}): Promise<string | null> {
  const firstLine = normalizeOptionalText(input.firstLine);
  if (!firstLine) {
    return null;
  }
  if (firstLine === ENV_NODE_SHEBANG) {
    const nodeSiblings = [
      join(dirname(input.commandPath), "node"),
      join(dirname(input.scriptPath), "node"),
    ].filter((candidate, index, candidates) => {
      return candidates.indexOf(candidate) === index;
    });
    for (const nodeSibling of nodeSiblings) {
      if (await canAccessExecutablePath(nodeSibling)) {
        return nodeSibling;
      }
    }
    return null;
  }
  if (!firstLine.startsWith("#!")) {
    return null;
  }
  const interpreter = normalizeOptionalText(firstLine.slice(2));
  if (!(interpreter && isAbsolute(interpreter))) {
    return null;
  }
  const normalizedInterpreter =
    interpreter.split(SHEBANG_ARGS_SPLIT_RE, 1)[0] ?? interpreter;
  try {
    await assertExecutablePath(normalizedInterpreter);
    return normalizedInterpreter;
  } catch {
    return null;
  }
}

async function assertExecutablePath(path: string): Promise<void> {
  await access(path, resolveRunnablePathAccessMode());
}

async function canAccessExecutablePath(path: string): Promise<boolean> {
  try {
    await assertExecutablePath(path);
    return true;
  } catch {
    return false;
  }
}

async function assertReadablePath(path: string): Promise<void> {
  await access(path, constants.R_OK);
}

function pathLooksExecutable(path: string): boolean {
  try {
    accessSync(path, resolveRunnablePathAccessMode());
    return true;
  } catch {
    return false;
  }
}

function commandPathRequiresShell(commandPath: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  const normalizedExtension = extname(commandPath).toLowerCase();
  return normalizedExtension === ".cmd" || normalizedExtension === ".bat";
}

function resolveCommandFileNameCandidates(commandName: string): string[] {
  if (process.platform !== "win32") {
    return [commandName];
  }

  const normalizedExtension = extname(commandName).toLowerCase();
  if (normalizedExtension.length > 0) {
    return [commandName];
  }

  return [
    ...resolveWindowsPathExtensions(process.env.PATHEXT).map(
      (extension) => `${commandName}${extension}`
    ),
    commandName,
  ].filter((candidate, index, candidates) => {
    return candidates.indexOf(candidate) === index;
  });
}

function resolveRunnablePathAccessMode(): number {
  return process.platform === "win32" ? constants.F_OK : constants.X_OK;
}

function resolveWindowsPathExtensions(value: string | undefined): string[] {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return [...WINDOWS_PATHEXT];
  }
  return normalized
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry, index, values) => entry && values.indexOf(entry) === index)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function buildLaunchCandidate(input: {
  commandPath: string;
  launchContract: RuntimeAgentControllerLaunchContract;
  transientWrapper?: boolean;
}): RuntimeAgentControllerLaunchCandidate {
  const installId = buildLaunchCandidateInstallId(input.launchContract);
  const sourceLabel = input.transientWrapper
    ? "Temporary wrapper"
    : resolveLaunchCandidateSourceLabel(input.commandPath);
  const detail = resolveLaunchCandidateDetail({
    commandPath: input.commandPath,
    launchContract: input.launchContract,
    transientWrapper: input.transientWrapper,
  });

  return {
    installId,
    label: sourceLabel,
    detail,
    commandPath: input.commandPath,
    launchContract: input.launchContract,
  };
}

function buildLaunchCandidateInstallId(
  launchContract: RuntimeAgentControllerLaunchContract
): string {
  const canonical = JSON.stringify(canonicalizeLaunchContract(launchContract));
  const digest = createHash("sha256").update(canonical).digest("hex");
  return `install_${digest.slice(0, 12)}`;
}

function canonicalizeLaunchContract(
  launchContract: RuntimeAgentControllerLaunchContract
): Record<string, unknown> {
  if (launchContract.kind === "executable") {
    return {
      kind: launchContract.kind,
      commandPath: launchContract.commandPath,
      argsPrefix: [...(launchContract.argsPrefix ?? [])],
    };
  }
  return {
    kind: launchContract.kind,
    nodePath: launchContract.nodePath,
    scriptPath: launchContract.scriptPath,
    argsPrefix: [...(launchContract.argsPrefix ?? [])],
  };
}

function finalizeLaunchCandidateDisplayMetadata(
  candidates: RuntimeAgentControllerLaunchCandidate[]
): RuntimeAgentControllerLaunchCandidate[] {
  const candidateIndexesByLabel = new Map<string, number[]>();
  for (const [index, candidate] of candidates.entries()) {
    const currentIndexes = candidateIndexesByLabel.get(candidate.label) ?? [];
    currentIndexes.push(index);
    candidateIndexesByLabel.set(candidate.label, currentIndexes);
  }

  const nextCandidates = candidates.map((candidate) => ({ ...candidate }));
  for (const indexes of candidateIndexesByLabel.values()) {
    if (indexes.length < 2) {
      continue;
    }
    const duplicateCandidates = indexes
      .map((index) => nextCandidates[index])
      .filter((candidate): candidate is RuntimeAgentControllerLaunchCandidate =>
        Boolean(candidate)
      );
    const labelSuffixes =
      resolveDistinctLaunchCandidateLabelSuffixes(duplicateCandidates);
    for (const [offset, index] of indexes.entries()) {
      const suffix = labelSuffixes[offset];
      if (!suffix) {
        continue;
      }
      const currentCandidate = nextCandidates[index];
      if (!currentCandidate) {
        continue;
      }
      currentCandidate.label = `${currentCandidate.label} (${suffix})`;
    }
  }

  return nextCandidates;
}

function resolveDistinctLaunchCandidateLabelSuffixes(
  candidates: RuntimeAgentControllerLaunchCandidate[]
): string[] {
  const directoryLabels = candidates.map((candidate) =>
    resolveLaunchCandidateDirectoryLabel(candidate.commandPath)
  );
  if (hasOnlyDistinctValues(directoryLabels)) {
    return directoryLabels;
  }

  const commandLabels = candidates.map((candidate) =>
    shortenPathForDisplay(candidate.commandPath)
  );
  if (hasOnlyDistinctValues(commandLabels)) {
    return commandLabels;
  }

  return candidates.map((candidate) => candidate.installId);
}

function hasOnlyDistinctValues(values: string[]): boolean {
  return values.length === new Set(values).size;
}

function resolveLaunchCandidateSourceLabel(commandPath: string): string {
  const normalizedPath = commandPath.toLowerCase();
  if (normalizedPath.includes(".app/contents/")) {
    return "App install";
  }
  if (normalizedPath.includes("/.nvm/")) {
    return "nvm install";
  }
  if (
    normalizedPath.includes("/opt/homebrew/") ||
    normalizedPath.includes("/cellar/") ||
    normalizedPath.includes("/homebrew/")
  ) {
    return "Homebrew install";
  }
  if (normalizedPath.includes("/.asdf/")) {
    return "asdf install";
  }
  if (normalizedPath.includes("/.volta/")) {
    return "Volta install";
  }
  if (normalizedPath.includes("/.fnm/")) {
    return "fnm install";
  }
  if (normalizedPath.includes("/.local/bin/")) {
    return "User install";
  }
  if (normalizedPath.includes("/usr/local/bin/")) {
    return "System-wide install";
  }
  if (
    normalizedPath.startsWith("/usr/bin/") ||
    normalizedPath.startsWith("/bin/")
  ) {
    return "System install";
  }
  return "Other install";
}

function resolveLaunchCandidateDetail(input: {
  commandPath: string;
  launchContract: RuntimeAgentControllerLaunchContract;
  transientWrapper?: boolean;
}): string {
  const nodeVersion =
    input.launchContract.kind === "node_script"
      ? resolveNodeVersionFromPath(input.launchContract.nodePath)
      : null;
  const commandDirectory = resolveLaunchCandidateDirectoryLabel(
    input.commandPath
  );
  if (input.transientWrapper) {
    return `Temporary PATH wrapper · ${commandDirectory}`;
  }
  if (nodeVersion) {
    return `Node ${nodeVersion} · ${commandDirectory}`;
  }
  return commandDirectory;
}

function resolveLaunchCandidateDirectoryLabel(commandPath: string): string {
  return shortenPathForDisplay(dirname(commandPath));
}

function shortenPathForDisplay(path: string): string {
  if (!(HOME_DIR && path.startsWith(HOME_DIR))) {
    return path;
  }
  if (path === HOME_DIR) {
    return "~";
  }
  return `~${path.slice(HOME_DIR.length)}`;
}

function resolveNodeVersionFromPath(path: string): string | null {
  const match = path.match(NODE_VERSION_PATH_RE);
  return normalizeOptionalText(match?.[1]);
}

async function readLaunchScriptInspection(path: string): Promise<{
  contents: string;
  firstLine: string | null;
}> {
  const file = await open(path, "r");
  let contents = "";
  try {
    const buffer = Buffer.allocUnsafe(MAX_LAUNCH_SCRIPT_INSPECTION_BYTES);
    const { bytesRead } = await file.read(
      buffer,
      0,
      MAX_LAUNCH_SCRIPT_INSPECTION_BYTES,
      0
    );
    contents = buffer.toString("utf8", 0, bytesRead);
  } finally {
    await file.close();
  }
  const firstLine = contents.split(FIRST_LINE_SPLIT_RE, 1)[0] ?? "";
  return {
    contents,
    firstLine: normalizeOptionalText(firstLine),
  };
}

function isTransientPathWrapper(input: {
  commandPath: string;
  contents: string;
  firstLine: string | null;
  scriptPath: string;
}): boolean {
  if (
    !(
      isInsideTemporaryDirectory(input.commandPath) ||
      isInsideTemporaryDirectory(input.scriptPath)
    )
  ) {
    return false;
  }

  return (
    hasWrapperPathSegment(input.commandPath) ||
    hasWrapperPathSegment(input.scriptPath) ||
    shellScriptLooksLikeWrapper(input)
  );
}

function isInsideTemporaryDirectory(path: string): boolean {
  const normalizedPath = normalizePathForDetection(path);
  const normalizedTempDir = TEMP_DIR
    ? normalizePathForDetection(TEMP_DIR)
    : null;
  if (
    normalizedTempDir &&
    pathIsEqualOrDescendant(normalizedPath, normalizedTempDir)
  ) {
    return true;
  }
  return (
    pathIsEqualOrDescendant(normalizedPath, "/tmp") ||
    pathIsEqualOrDescendant(normalizedPath, "/private/tmp") ||
    MACOS_TEMP_FOLDER_RE.test(normalizedPath)
  );
}

function hasWrapperPathSegment(path: string): boolean {
  return normalizePathForDetection(path)
    .split("/")
    .filter((segment) => segment.length > 0)
    .slice(-4)
    .some((segment) => WRAPPER_PATH_SEGMENT_RE.test(segment));
}

function shellScriptLooksLikeWrapper(input: {
  contents: string;
  firstLine: string | null;
}): boolean {
  const firstLine = normalizeOptionalText(input.firstLine)?.toLowerCase() ?? "";
  if (
    !(
      firstLine.includes("bash") ||
      firstLine.includes("/sh") ||
      firstLine.includes("zsh")
    )
  ) {
    return false;
  }

  const contents = input.contents.toLowerCase();
  return (
    contents.includes("wrapper_shim") ||
    contents.includes("shim_root") ||
    (contents.includes("\nexec ") &&
      (contents.includes("wrapper") || contents.includes("shim")))
  );
}

function normalizePathForDetection(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+/gu, "/").toLowerCase();
}

function pathIsEqualOrDescendant(path: string, parentPath: string): boolean {
  return path === parentPath || path.startsWith(`${parentPath}/`);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
