import { homedir } from "node:os";
import { join } from "node:path";
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

const DEFAULT_CODEX_COMMAND = "codex";
const CODEX_APP_BUNDLE_RESOURCES_RELATIVE_PATH = join(
  "Codex.app",
  "Contents",
  "Resources"
);

export async function resolveInstalledCodexLaunchCandidates(
  input?: InstalledLaunchCandidatesOptions
): Promise<InstalledLaunchCandidatesResolution> {
  const installedCandidates = await resolveInstalledNodeScriptLaunchCandidates({
    additionalCommandDirectories: resolveCodexAppBundleCommandDirectories(),
    commandName: DEFAULT_CODEX_COMMAND,
    configuredCommand: normalizeOptionalText(
      process.env.OPENMELD_DAEMON_RUNTIME_CODEX_BIN
    ),
    displayName: "Codex",
    preferredLaunchContract: input?.preferredLaunchContract,
  });
  if (!installedCandidates.ok) {
    return installedCandidates;
  }
  const candidates = await resolveLaunchCandidatesAfterVerification({
    candidates: installedCandidates.candidates,
    verify: async (candidate) =>
      await verifyCodexLaunchContract({
        launchContract: candidate.launchContract,
        timeoutMs: input?.timeoutMs,
      }),
  });
  if (candidates.length === 0) {
    return {
      errorMessage:
        "Codex is installed, but OpenMeld can't start it on this device.",
      reason: "not_launchable",
      ok: false,
    };
  }
  return {
    candidates,
    ok: true,
  };
}

export async function resolveInstalledCodexLaunchContract() {
  return await resolveInstalledNodeScriptLaunchContract({
    additionalCommandDirectories: resolveCodexAppBundleCommandDirectories(),
    commandName: DEFAULT_CODEX_COMMAND,
    configuredCommand: normalizeOptionalText(
      process.env.OPENMELD_DAEMON_RUNTIME_CODEX_BIN
    ),
    displayName: "Codex",
  });
}

export async function verifyCodexLaunchContract(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  cwd?: string;
  timeoutMs?: number | null;
}): Promise<LaunchContractVerificationResult> {
  return await verifyCliLaunchContract({
    cwd: input.cwd ?? process.cwd(),
    displayName: "Codex",
    launchContract: input.launchContract,
    probeArgs: ["--version"],
    timeoutMs: input.timeoutMs ?? resolveCodexTimeoutMs(),
  });
}

export function resolveCodexTimeoutMs(): number | null {
  // Explicit watchdog override only. Normal OpenMeld Wake execution has no fixed
  // Codex process timeout.
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

function resolveCodexAppBundleCommandDirectories(): string[] {
  const home = normalizeOptionalText(process.env.HOME) ?? homedir();
  return [
    join("/Applications", CODEX_APP_BUNDLE_RESOURCES_RELATIVE_PATH),
    join(home, "Applications", CODEX_APP_BUNDLE_RESOURCES_RELATIVE_PATH),
  ];
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
