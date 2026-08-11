import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import {
  type InstalledLaunchCandidatesResolution,
  type LaunchContractVerificationResult,
  type RuntimeAgentControllerLaunchContract,
  resolveInstalledNodeScriptLaunchCandidates,
  resolveInstalledNodeScriptLaunchContract,
  resolveLaunchCandidatesAfterVerification,
  verifyCliLaunchContract,
} from "@openmeld/adapter-core";

const DEFAULT_CURSOR_COMMAND = "cursor-agent";
const PATH_SEGMENT_SPLIT_RE = /[/\\]/u;

export async function resolveInstalledCursorLaunchCandidates(input?: {
  timeoutMs?: number | null;
}): Promise<InstalledLaunchCandidatesResolution> {
  const installedCandidates = await resolveInstalledNodeScriptLaunchCandidates({
    additionalCommandDirectories: resolveCursorCommandDirectories(),
    commandName: DEFAULT_CURSOR_COMMAND,
    configuredCommand: normalizeOptionalText(
      process.env.OPENMELD_DAEMON_RUNTIME_CURSOR_BIN
    ),
    displayName: "Cursor CLI",
  });
  if (!installedCandidates.ok) {
    return installedCandidates;
  }
  const candidates = await resolveLaunchCandidatesAfterVerification({
    candidates: installedCandidates.candidates,
    verify: async (candidate) =>
      await verifyCursorLaunchContract({
        launchContract: candidate.launchContract,
        timeoutMs: input?.timeoutMs,
      }),
  });
  if (candidates.length === 0) {
    return {
      errorMessage:
        "Cursor CLI is installed, but OpenMeld can't start cursor-agent on this device.",
      reason: "not_launchable",
      ok: false,
    };
  }
  return {
    candidates,
    ok: true,
  };
}

export async function resolveInstalledCursorLaunchContract() {
  return await resolveInstalledNodeScriptLaunchContract({
    additionalCommandDirectories: resolveCursorCommandDirectories(),
    commandName: DEFAULT_CURSOR_COMMAND,
    configuredCommand: normalizeOptionalText(
      process.env.OPENMELD_DAEMON_RUNTIME_CURSOR_BIN
    ),
    displayName: "Cursor CLI",
  });
}

export async function refreshCursorPersistedLaunchContract(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
}): Promise<RuntimeAgentControllerLaunchContract> {
  const configuredCommand = normalizeOptionalText(
    process.env.OPENMELD_DAEMON_RUNTIME_CURSOR_BIN
  );
  if (configuredCommand) {
    const resolution = await resolveInstalledNodeScriptLaunchContract({
      commandName: DEFAULT_CURSOR_COMMAND,
      configuredCommand,
      displayName: "Cursor CLI",
    });
    if (!resolution.ok) {
      throw new Error(
        `The configured Cursor CLI command is not launchable: ${resolution.errorMessage}`
      );
    }
    const verification = await verifyCursorLaunchContract({
      launchContract: resolution.launchContract,
    });
    if (isCompletedNegativeLaunchContractCheck(verification)) {
      throw new Error(
        `The configured Cursor CLI command is not launchable: ${verification.errorMessage}`
      );
    }
    return resolution.launchContract;
  }
  if (input.launchContract.kind !== "node_script") {
    return input.launchContract;
  }
  const persistedLaunchContract = input.launchContract;

  const home = normalizeOptionalText(process.env.HOME) ?? homedir();
  const managedVersionsRoot = join(
    home,
    ".local",
    "share",
    "cursor-agent",
    "versions"
  );
  const canonicalManagedVersionsRoot = await realpath(
    managedVersionsRoot
  ).catch(() => managedVersionsRoot);
  const canonicalPersistedScriptPath = await realpath(
    persistedLaunchContract.scriptPath
  ).catch(() => persistedLaunchContract.scriptPath);
  if (
    !(
      isManagedCursorVersionScript({
        managedVersionsRoot,
        scriptPath: persistedLaunchContract.scriptPath,
      }) ||
      isManagedCursorVersionScript({
        managedVersionsRoot: canonicalManagedVersionsRoot,
        scriptPath: canonicalPersistedScriptPath,
      })
    )
  ) {
    return input.launchContract;
  }

  let incompletelyCheckedLaunchContract: RuntimeAgentControllerLaunchContract | null =
    null;
  for (const commandPath of resolveCursorCommandPaths(home)) {
    const canonicalCommandPath = await realpath(commandPath).catch(() => null);
    if (
      !(
        canonicalCommandPath &&
        isManagedCursorVersionScript({
          managedVersionsRoot: canonicalManagedVersionsRoot,
          scriptPath: canonicalCommandPath,
        })
      )
    ) {
      continue;
    }

    const resolution = await resolveInstalledNodeScriptLaunchContract({
      commandName: DEFAULT_CURSOR_COMMAND,
      configuredCommand: commandPath,
      displayName: "Cursor CLI",
    });
    if (!resolution.ok) {
      continue;
    }
    const verification = await verifyCursorLaunchContract({
      launchContract: resolution.launchContract,
    });
    if (verification.ok) {
      return resolution.launchContract;
    }
    if (isIncompleteLaunchContractCheck(verification)) {
      incompletelyCheckedLaunchContract ??= resolution.launchContract;
    }
  }

  return incompletelyCheckedLaunchContract ?? input.launchContract;
}

export async function verifyCursorLaunchContract(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  cwd?: string;
  timeoutMs?: number | null;
}): Promise<LaunchContractVerificationResult> {
  return await verifyCliLaunchContract({
    cwd: input.cwd ?? process.cwd(),
    displayName: "Cursor CLI",
    launchContract: input.launchContract,
    probeArgs: ["--version"],
    timeoutMs: input.timeoutMs ?? 15_000,
  });
}

export function resolveCursorTimeoutMs(): number | null {
  const raw = normalizeOptionalText(
    process.env.OPENMELD_DAEMON_RUNTIME_REQUEST_TIMEOUT_MS
  );
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function isCompletedNegativeLaunchContractCheck(
  verification: LaunchContractVerificationResult
): verification is Extract<LaunchContractVerificationResult, { ok: false }> {
  return !verification.ok && verification.failureKind === "completed_negative";
}

function isIncompleteLaunchContractCheck(
  verification: LaunchContractVerificationResult
): boolean {
  return !verification.ok && verification.failureKind === "incomplete_check";
}

function resolveCursorCommandDirectories(): string[] {
  const home = normalizeOptionalText(process.env.HOME) ?? homedir();
  return resolveCursorCommandPaths(home).map(dirname);
}

function resolveCursorCommandPaths(home: string): string[] {
  return [
    join(home, ".local", "bin", DEFAULT_CURSOR_COMMAND),
    join(home, ".cursor", "bin", DEFAULT_CURSOR_COMMAND),
  ];
}

function isManagedCursorVersionScript(input: {
  managedVersionsRoot: string;
  scriptPath: string;
}): boolean {
  const relativePath = relative(input.managedVersionsRoot, input.scriptPath);
  const segments = relativePath.split(PATH_SEGMENT_SPLIT_RE);
  return (
    segments.length === 2 &&
    segments[0] !== ".." &&
    segments[0] !== "." &&
    segments[1] === DEFAULT_CURSOR_COMMAND
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
