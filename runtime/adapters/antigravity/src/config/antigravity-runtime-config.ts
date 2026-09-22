import { homedir } from "node:os";
import { join } from "node:path";
import {
  type InstalledLaunchCandidatesOptions,
  type InstalledLaunchCandidatesResolution,
  type LaunchContractVerificationResult,
  type RuntimeAgentControllerLaunchContract,
  resolveInstalledNodeScriptLaunchCandidates,
  resolveLaunchCandidatesAfterVerification,
  verifyCliLaunchContract,
} from "@openmeld/adapter-core";

const DEFAULT_ANTIGRAVITY_COMMAND = "agy";

export async function resolveInstalledAntigravityLaunchCandidates(
  input?: InstalledLaunchCandidatesOptions
): Promise<InstalledLaunchCandidatesResolution> {
  const configuredCommand = normalizeOptionalText(
    process.env.OPENMELD_DAEMON_RUNTIME_ANTIGRAVITY_BIN
  );
  const installed = await resolveInstalledNodeScriptLaunchCandidates({
    additionalCommandDirectories: [join(resolveHome(), ".local", "bin")],
    commandName: DEFAULT_ANTIGRAVITY_COMMAND,
    configuredCommand,
    displayName: "Antigravity CLI",
    preferredLaunchContract: input?.preferredLaunchContract,
  });
  if (!installed.ok) {
    return installed;
  }
  const candidates = await resolveLaunchCandidatesAfterVerification({
    candidates: installed.candidates,
    verify: async (candidate) =>
      await verifyAntigravityLaunchContract({
        launchContract: candidate.launchContract,
        timeoutMs: input?.timeoutMs,
      }),
  });
  if (candidates.length === 0) {
    return {
      errorMessage:
        "Antigravity CLI is installed, but OpenMeld can't start it on this device.",
      ok: false,
      reason: "not_launchable",
    };
  }
  return { candidates, ok: true };
}

export async function verifyAntigravityLaunchContract(input: {
  cwd?: string;
  launchContract: RuntimeAgentControllerLaunchContract;
  timeoutMs?: number | null;
}): Promise<LaunchContractVerificationResult> {
  return await verifyCliLaunchContract({
    cwd: input.cwd ?? process.cwd(),
    displayName: "Antigravity CLI",
    env: {},
    launchContract: input.launchContract,
    probeArgs: ["--version"],
    timeoutMs: input.timeoutMs ?? 15_000,
  });
}

function resolveHome(): string {
  return normalizeOptionalText(process.env.HOME) ?? homedir();
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
