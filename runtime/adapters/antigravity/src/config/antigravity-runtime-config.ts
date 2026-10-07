import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildCliLaunchInvocation,
  type InstalledLaunchCandidatesOptions,
  type InstalledLaunchCandidatesResolution,
  type LaunchContractVerificationResult,
  type RuntimeAgentControllerLaunchContract,
  resolveInstalledNodeScriptLaunchCandidates,
  resolveLaunchCandidatesAfterVerification,
  verifyCliLaunchContract,
} from "@openmeld/adapter-core";
import {
  isAntigravityAcpLaunchContract,
  probeAntigravityAcp,
} from "../transport/antigravity-acp-transport.js";

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
  const acp = await resolveInstalledNodeScriptLaunchCandidates({
    additionalCommandDirectories: [join(resolveHome(), ".local", "bin")],
    commandName:
      process.platform === "win32"
        ? "agy_acp_server.exe"
        : "agy_acp_server.par",
    displayName: "Antigravity ACP",
    preferredLaunchContract:
      input?.preferredLaunchContract &&
      isAntigravityAcpLaunchContract(input.preferredLaunchContract)
        ? input.preferredLaunchContract
        : undefined,
  });
  if (!(installed.ok || acp.ok)) {
    return installed.reason === "not_launchable" ? installed : acp;
  }
  const discovered = [
    ...(installed.ok ? installed.candidates : []),
    ...(acp.ok ? acp.candidates : []),
  ];
  const candidates = await resolveLaunchCandidatesAfterVerification({
    candidates: [
      ...new Map(
        discovered.map((candidate) => [
          JSON.stringify(candidate.launchContract),
          candidate,
        ])
      ).values(),
    ],
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
  if (isAntigravityAcpLaunchContract(input.launchContract)) {
    try {
      await probeAntigravityAcp({ ...input, cwd: input.cwd ?? process.cwd() });
      const invocation = buildCliLaunchInvocation({
        launchContract: input.launchContract,
        args: [],
      });
      return {
        ok: true,
        launchCommand: {
          bin: invocation.bin,
          argsPrefix: invocation.args,
          shell: invocation.shell,
        },
      };
    } catch (error) {
      return {
        ok: false,
        failureKind: "incomplete_check",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
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
