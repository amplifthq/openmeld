import { homedir } from "node:os";
import { join } from "node:path";
import {
  type InstalledLaunchCandidatesOptions,
  type InstalledLaunchCandidatesResolution,
  type LaunchContractVerificationResult,
  type RuntimeAgentControllerLaunchCandidate,
  type RuntimeAgentControllerLaunchContract,
  resolveInstalledNodeScriptLaunchCandidates,
  resolveInstalledNodeScriptLaunchContract,
  verifyCliLaunchContract,
  verifyLaunchContractFiles,
} from "@openmeld/adapter-core";
import {
  CodexAppServerTransportError,
  probeCodexAppServerAccount,
} from "../transport/codex-app-server-transport.js";

const DEFAULT_CODEX_COMMAND = "codex";
const CODEX_APP_BUNDLE_NAMES = ["Codex.app", "ChatGPT.app"] as const;
const CODEX_CONTROL_PROBE_TIMEOUT_MS = 15_000;

export type CodexInstalledLaunchCandidatesOptions =
  InstalledLaunchCandidatesOptions & {
    appBundleRoots?: readonly string[];
  };

export async function resolveInstalledCodexLaunchCandidates(
  input?: CodexInstalledLaunchCandidatesOptions
): Promise<InstalledLaunchCandidatesResolution> {
  const installedCandidates = await resolveInstalledNodeScriptLaunchCandidates({
    additionalCommandDirectories: resolveCodexAppBundleCommandDirectories(
      input?.appBundleRoots
    ),
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
  const inspections = await Promise.all(
    installedCandidates.candidates.map(async (candidate, index) => ({
      candidate,
      index,
      inspection: await inspectCodexLaunchCandidate({
        candidate,
        timeoutMs: input?.timeoutMs,
      }),
    }))
  );
  const completed = inspections.filter(({ inspection }) => inspection.ok);
  const selectedInspections =
    completed.length > 0
      ? completed
      : inspections.filter(
          ({ inspection }) =>
            !inspection.ok && inspection.failureKind === "incomplete_check"
        );
  const candidates = selectedInspections.map(({ candidate, inspection }) =>
    inspection.ok
      ? decorateCodexLaunchCandidate({ candidate, inspection })
      : decorateCodexLaunchCandidate({ candidate, inspection: null })
  );
  if (candidates.length === 0) {
    const firstError = inspections.find(
      (
        entry
      ): entry is typeof entry & {
        inspection: Extract<CodexLaunchInspection, { ok: false }>;
      } => !entry.inspection.ok
    )?.inspection.errorMessage;
    return {
      errorMessage:
        firstError ??
        "Codex is installed, but OpenMeld can't start it on this device.",
      reason: "not_launchable",
      ok: false,
    };
  }
  const preferredInstallId =
    resolvePreferredCodexInstallId(selectedInspections);
  return {
    candidates,
    ok: true,
    ...(preferredInstallId ? { preferredInstallId } : {}),
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
  const fileCheck = await verifyLaunchContractFiles({
    launchContract: input.launchContract,
  });
  if (!fileCheck.ok) {
    return fileCheck;
  }
  try {
    await probeCodexAppServerAccount({
      launchContract: input.launchContract,
      timeoutMs: resolveCodexControlProbeTimeoutMs(input.timeoutMs),
    });
    return fileCheck;
  } catch (error) {
    return {
      errorMessage: `Codex app-server can't start on this device: ${toErrorMessage(error)}`,
      failureKind:
        error instanceof CodexAppServerTransportError &&
        error.errorType === "timeout"
          ? "incomplete_check"
          : "completed_negative",
      ok: false,
    };
  }
}

export async function verifyCodexCommandLaunchContract(input: {
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

function resolveCodexAppBundleCommandDirectories(
  appBundleRoots?: readonly string[]
): string[] {
  const home = normalizeOptionalText(process.env.HOME) ?? homedir();
  const roots = appBundleRoots ?? ["/Applications", join(home, "Applications")];
  return roots.flatMap((root) =>
    CODEX_APP_BUNDLE_NAMES.map((appBundleName) =>
      join(root, appBundleName, "Contents", "Resources")
    )
  );
}

type CodexLaunchInspection =
  | {
      authStatus: "authenticated" | "unauthenticated" | "unknown";
      ok: true;
      version: string | null;
    }
  | {
      errorMessage: string;
      failureKind: "completed_negative" | "incomplete_check";
      ok: false;
    };

async function inspectCodexLaunchCandidate(input: {
  candidate: RuntimeAgentControllerLaunchCandidate;
  timeoutMs?: number | null;
}): Promise<CodexLaunchInspection> {
  try {
    const probe = await probeCodexAppServerAccount({
      launchContract: input.candidate.launchContract,
      timeoutMs: resolveCodexControlProbeTimeoutMs(input.timeoutMs),
    });
    return { ...probe, ok: true };
  } catch (error) {
    return {
      errorMessage: toErrorMessage(error),
      failureKind:
        error instanceof CodexAppServerTransportError &&
        error.errorType === "timeout"
          ? "incomplete_check"
          : "completed_negative",
      ok: false,
    };
  }
}

function resolvePreferredCodexInstallId(
  inspections: ReadonlyArray<{
    candidate: RuntimeAgentControllerLaunchCandidate;
    index: number;
    inspection: CodexLaunchInspection;
  }>
): string | null {
  return (
    inspections
      .filter(
        (
          entry
        ): entry is typeof entry & {
          inspection: Extract<CodexLaunchInspection, { ok: true }>;
        } => entry.inspection.ok
      )
      .sort((left, right) => {
        const scoreDifference =
          resolveCodexPreferenceScore(left) -
          resolveCodexPreferenceScore(right);
        return scoreDifference === 0
          ? left.index - right.index
          : scoreDifference;
      })[0]?.candidate.installId ??
    inspections[0]?.candidate.installId ??
    null
  );
}

function resolveCodexPreferenceScore(input: {
  candidate: RuntimeAgentControllerLaunchCandidate;
  inspection: Extract<CodexLaunchInspection, { ok: true }>;
}): number {
  const authenticated = input.inspection.authStatus === "authenticated";
  const chatGptApp = isChatGptBundledCodex(input.candidate.commandPath);
  if (authenticated) {
    return chatGptApp ? 0 : 1;
  }
  return chatGptApp ? 2 : 3;
}

function decorateCodexLaunchCandidate(input: {
  candidate: RuntimeAgentControllerLaunchCandidate;
  inspection: Extract<CodexLaunchInspection, { ok: true }> | null;
}): RuntimeAgentControllerLaunchCandidate {
  const appLabel = resolveCodexAppLabel(input.candidate.commandPath);
  const status = resolveCodexSignInStatus(input.inspection?.authStatus);
  const version = input.inspection?.version
    ? `v${input.inspection.version}`
    : "Version unavailable";
  return {
    ...input.candidate,
    detail: `${version} · ${status} · ${input.candidate.detail}`,
    ...(appLabel ? { label: appLabel } : {}),
  };
}

function resolveCodexSignInStatus(
  authStatus: "authenticated" | "unauthenticated" | "unknown" | undefined
): string {
  if (authStatus === "authenticated") {
    return "Signed in";
  }
  if (authStatus === "unauthenticated") {
    return "Sign in needed";
  }
  return "Sign-in status unavailable";
}

function resolveCodexAppLabel(commandPath: string): string | null {
  if (isChatGptBundledCodex(commandPath)) {
    return "ChatGPT app";
  }
  return commandPath.toLowerCase().includes("/codex.app/contents/resources/")
    ? "Codex app"
    : null;
}

function isChatGptBundledCodex(commandPath: string): boolean {
  return commandPath.toLowerCase().includes("/chatgpt.app/contents/resources/");
}

function resolveCodexControlProbeTimeoutMs(
  timeoutMs: number | null | undefined
): number {
  return typeof timeoutMs === "number"
    ? timeoutMs
    : CODEX_CONTROL_PROBE_TIMEOUT_MS;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
