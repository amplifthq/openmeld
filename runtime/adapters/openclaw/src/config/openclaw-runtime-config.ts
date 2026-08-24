import {
  type InstalledLaunchCandidatesOptions,
  type InstalledLaunchCandidatesResolution,
  type LaunchContractVerificationResult,
  type RuntimeAgentControllerLaunchContract,
  resolveInstalledCommandPath,
  resolveInstalledNodeScriptLaunchCandidates,
  resolveInstalledNodeScriptLaunchContract,
  resolveLaunchCandidatesAfterVerification,
  resolveSiblingCommandPath,
  verifyCliLaunchContract,
} from "@openmeld/adapter-core";

const DEFAULT_OPENCLAW_COMMAND = "openclaw";
const DEFAULT_OPENCLAW_AGENT_ID = "main";

export async function resolveInstalledOpenClawLaunchCandidates(
  input?: InstalledLaunchCandidatesOptions
): Promise<InstalledLaunchCandidatesResolution> {
  const installedCandidates = await resolveInstalledNodeScriptLaunchCandidates({
    commandName: DEFAULT_OPENCLAW_COMMAND,
    configuredCommand: normalizeOptionalText(
      process.env.OPENMELD_DAEMON_RUNTIME_OPENCLAW_BIN
    ),
    displayName: "OpenClaw",
    preferredLaunchContract: input?.preferredLaunchContract,
  });
  if (!installedCandidates.ok) {
    return installedCandidates;
  }
  const candidates = await resolveLaunchCandidatesAfterVerification({
    candidates: installedCandidates.candidates,
    verify: async (candidate) =>
      await verifyOpenClawLaunchContract({
        launchContract: candidate.launchContract,
        timeoutMs: input?.timeoutMs,
      }),
  });
  if (candidates.length === 0) {
    return {
      errorMessage:
        "OpenClaw is installed, but OpenMeld can't start it on this device.",
      reason: "not_launchable",
      ok: false,
    };
  }
  return {
    candidates,
    ok: true,
  };
}

export async function resolveInstalledOpenClawLaunchContract() {
  return await resolveInstalledNodeScriptLaunchContract({
    commandName: DEFAULT_OPENCLAW_COMMAND,
    configuredCommand: normalizeOptionalText(
      process.env.OPENMELD_DAEMON_RUNTIME_OPENCLAW_BIN
    ),
    displayName: "OpenClaw",
  });
}

export async function verifyOpenClawLaunchContract(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  cwd?: string;
  timeoutMs?: number | null;
}): Promise<LaunchContractVerificationResult> {
  return await verifyCliLaunchContract({
    cwd: input.cwd ?? process.cwd(),
    displayName: "OpenClaw",
    launchContract: input.launchContract,
    probeArgs: ["--version"],
    timeoutMs: input.timeoutMs ?? resolveOpenClawTimeoutMs(),
  });
}

export function resolveOpenClawBinCandidates(
  explicitOpenClawBin?: string
): string[] {
  const candidates: string[] = [];
  const explicitCandidate = normalizeOptionalText(explicitOpenClawBin);
  if (explicitCandidate) {
    candidates.push(explicitCandidate);
  }

  const configuredCandidate = normalizeOptionalText(
    process.env.OPENMELD_DAEMON_RUNTIME_OPENCLAW_BIN
  );
  if (configuredCandidate && !candidates.includes(configuredCandidate)) {
    candidates.push(configuredCandidate);
  }

  const nodeSiblingCandidate = resolveSiblingCommandPath({
    anchorPath: process.execPath,
    commandName: DEFAULT_OPENCLAW_COMMAND,
  });
  if (nodeSiblingCandidate && !candidates.includes(nodeSiblingCandidate)) {
    candidates.push(nodeSiblingCandidate);
  }

  const installedCandidate = resolveInstalledCommandPath({
    commandName: DEFAULT_OPENCLAW_COMMAND,
    configuredCommand: null,
  });
  if (installedCandidate && !candidates.includes(installedCandidate)) {
    candidates.push(installedCandidate);
  }

  if (!candidates.includes(DEFAULT_OPENCLAW_COMMAND)) {
    candidates.push(DEFAULT_OPENCLAW_COMMAND);
  }

  return candidates;
}

export function resolveOpenClawBin(
  explicitOpenClawBin?: string
): string | null {
  return resolveOpenClawBinCandidates(explicitOpenClawBin)[0] ?? null;
}

export function resolveOpenClawTimeoutMs(): number | null {
  // Explicit watchdog override only. Normal OpenMeld Wake execution has no fixed
  // OpenClaw process timeout.
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

export function resolveOpenClawAgentId(): string {
  return (
    normalizeOptionalText(
      process.env.OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID
    ) ?? DEFAULT_OPENCLAW_AGENT_ID
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
