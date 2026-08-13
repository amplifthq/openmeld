import { homedir } from "node:os";
import { join } from "node:path";
import {
  type InstalledLaunchCandidatesResolution,
  type LaunchContractVerificationResult,
  type RuntimeAgentControllerLaunchContract,
  resolveInstalledNodeScriptLaunchCandidates,
  resolveInstalledNodeScriptLaunchContract,
  resolveLaunchCandidatesAfterVerification,
  verifyCliLaunchContract,
} from "@openmeld/adapter-core";

const DEFAULT_GROK_BUILD_COMMAND = "grok";

export async function resolveInstalledGrokBuildLaunchCandidates(input?: {
  timeoutMs?: number | null;
}): Promise<InstalledLaunchCandidatesResolution> {
  const installedCandidates = await resolveInstalledNodeScriptLaunchCandidates({
    additionalCommandDirectories: [join(resolveHome(), ".grok", "bin")],
    commandName: DEFAULT_GROK_BUILD_COMMAND,
    configuredCommand: normalizeOptionalText(
      process.env.OPENMELD_DAEMON_RUNTIME_GROK_BUILD_BIN
    ),
    displayName: "Grok Build",
  });
  if (!installedCandidates.ok) {
    return installedCandidates;
  }
  const candidates = await resolveLaunchCandidatesAfterVerification({
    candidates: installedCandidates.candidates,
    verify: async (candidate) =>
      await verifyGrokBuildLaunchContract({
        launchContract: candidate.launchContract,
        timeoutMs: input?.timeoutMs,
      }),
  });
  if (candidates.length === 0) {
    return {
      errorMessage:
        "Grok Build is installed, but OpenMeld can't start it on this device.",
      reason: "not_launchable",
      ok: false,
    };
  }
  return { candidates, ok: true };
}

export async function resolveInstalledGrokBuildLaunchContract() {
  return await resolveInstalledNodeScriptLaunchContract({
    additionalCommandDirectories: [join(resolveHome(), ".grok", "bin")],
    commandName: DEFAULT_GROK_BUILD_COMMAND,
    configuredCommand: normalizeOptionalText(
      process.env.OPENMELD_DAEMON_RUNTIME_GROK_BUILD_BIN
    ),
    displayName: "Grok Build",
  });
}

export async function verifyGrokBuildLaunchContract(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  cwd?: string;
  timeoutMs?: number | null;
}): Promise<LaunchContractVerificationResult> {
  return await verifyCliLaunchContract({
    cwd: input.cwd ?? process.cwd(),
    displayName: "Grok Build",
    env: { GROK_DISABLE_AUTOUPDATER: "1" },
    launchContract: input.launchContract,
    probeArgs: ["--no-auto-update", "version"],
    timeoutMs: input.timeoutMs ?? 15_000,
  });
}

export function resolveGrokBuildTimeoutMs(): number | null {
  const raw = normalizeOptionalText(
    process.env.OPENMELD_DAEMON_RUNTIME_REQUEST_TIMEOUT_MS
  );
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveHome(): string {
  return normalizeOptionalText(process.env.HOME) ?? homedir();
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
