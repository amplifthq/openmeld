import {
  type InstalledLaunchCandidatesOptions,
  type InstalledLaunchCandidatesResolution,
  type LaunchContractVerificationResult,
  type RuntimeAgentControllerLaunchContract,
  resolveInstalledNodeScriptLaunchCandidates,
  resolveInstalledNodeScriptLaunchContract,
  resolveLaunchCandidatesAfterVerification,
  verifyCliLaunchContract,
} from "@openmeld/adapter-core";

const DEFAULT_OPENCODE_COMMAND = "opencode";

export async function resolveInstalledOpenCodeLaunchCandidates(
  input?: InstalledLaunchCandidatesOptions
): Promise<InstalledLaunchCandidatesResolution> {
  const installedCandidates = await resolveInstalledNodeScriptLaunchCandidates({
    commandName: DEFAULT_OPENCODE_COMMAND,
    configuredCommand: normalizeOptionalText(
      process.env.OPENMELD_DAEMON_RUNTIME_OPENCODE_BIN
    ),
    displayName: "OpenCode",
    preferredLaunchContract: input?.preferredLaunchContract,
  });
  if (!installedCandidates.ok) {
    return installedCandidates;
  }
  const candidates = await resolveLaunchCandidatesAfterVerification({
    candidates: installedCandidates.candidates,
    verify: async (candidate) =>
      await verifyOpenCodeLaunchContract({
        launchContract: candidate.launchContract,
        timeoutMs: input?.timeoutMs,
      }),
  });
  if (candidates.length === 0) {
    return {
      errorMessage:
        "OpenCode is installed, but OpenMeld can't start it on this device.",
      reason: "not_launchable",
      ok: false,
    };
  }
  return {
    candidates,
    ok: true,
  };
}

export async function resolveInstalledOpenCodeLaunchContract() {
  return await resolveInstalledNodeScriptLaunchContract({
    commandName: DEFAULT_OPENCODE_COMMAND,
    configuredCommand: normalizeOptionalText(
      process.env.OPENMELD_DAEMON_RUNTIME_OPENCODE_BIN
    ),
    displayName: "OpenCode",
  });
}

export async function verifyOpenCodeLaunchContract(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  cwd?: string;
  timeoutMs?: number | null;
}): Promise<LaunchContractVerificationResult> {
  return await verifyCliLaunchContract({
    cwd: input.cwd ?? process.cwd(),
    displayName: "OpenCode",
    launchContract: input.launchContract,
    probeArgs: ["--version"],
    timeoutMs: input.timeoutMs ?? resolveOpenCodeTimeoutMs(),
  });
}

export function resolveOpenCodeTimeoutMs(): number | null {
  // Explicit watchdog override only. Normal OpenMeld Wake execution has no fixed
  // OpenCode process timeout.
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

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
