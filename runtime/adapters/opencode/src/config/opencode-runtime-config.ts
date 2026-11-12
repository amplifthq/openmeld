import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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
const OPENCODE_PLATFORM_PACKAGE_RE = /^opencode-[a-z0-9-]+$/u;
const INSTALL_VERIFICATION_REUSE_MS = 15 * 60_000;
const installationVerifications = new Map<
  string,
  {
    fingerprint: string;
    startedAt: number;
    result: Promise<LaunchContractVerificationResult>;
  }
>();

export async function resolveInstalledOpenCodeLaunchCandidates(
  input?: InstalledLaunchCandidatesOptions
): Promise<InstalledLaunchCandidatesResolution> {
  const installedCandidates = await resolveInstalledNodeScriptLaunchCandidates({
    additionalCommandDirectories: resolveOpenCodeCommandDirectories(),
    commandName: DEFAULT_OPENCODE_COMMAND,
    configuredCommand: normalizeOptionalText(
      process.env.OPENMELD_DAEMON_RUNTIME_OPENCODE_BIN
    ),
    displayName: "OpenCode",
    preferredLaunchContract: input?.preferredLaunchContract,
  });
  const v2 = await resolveInstalledNodeScriptLaunchCandidates({
    additionalCommandDirectories: resolveOpenCodeCommandDirectories(),
    commandName: "opencode2",
    displayName: "OpenCode 2",
  });
  if (!(installedCandidates.ok || v2.ok)) {
    return installedCandidates;
  }
  const discovered = [
    ...(installedCandidates.ok ? installedCandidates.candidates : []),
    ...(v2.ok ? v2.candidates : []),
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
      await verifyOpenCodeLaunchContract({
        launchContract: candidate.launchContract,
        reuseSuccessfulResult: true,
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
    additionalCommandDirectories: resolveOpenCodeCommandDirectories(),
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
  reuseSuccessfulResult?: boolean;
  timeoutMs?: number | null;
}): Promise<LaunchContractVerificationResult> {
  const verification = {
    cwd: input.cwd ?? process.cwd(),
    displayName: "OpenCode",
    launchContract: input.launchContract,
    probeArgs: ["--version"],
    timeoutMs: input.timeoutMs ?? resolveOpenCodeTimeoutMs(),
  };
  const key = JSON.stringify([
    verification,
    createHash("sha256").update(JSON.stringify(process.env)).digest("hex"),
  ]);
  if (!input.reuseSuccessfulResult) {
    installationVerifications.delete(key);
    return await verifyCliLaunchContract(verification);
  }
  const fingerprint = await readInstallationFingerprint(input.launchContract);
  const cached = installationVerifications.get(key);
  if (
    fingerprint &&
    cached?.fingerprint === fingerprint &&
    Date.now() - cached.startedAt < INSTALL_VERIFICATION_REUSE_MS
  ) {
    return await cached.result;
  }
  installationVerifications.delete(key);
  if (!fingerprint) {
    return await verifyCliLaunchContract(verification);
  }

  const result = verifyCliLaunchContract(verification).then(async (outcome) => {
    if (
      (!outcome.ok ||
        fingerprint !==
          (await readInstallationFingerprint(input.launchContract))) &&
      installationVerifications.get(key)?.result === result
    ) {
      installationVerifications.delete(key);
    }
    return outcome;
  });
  // Keep discovery memory bounded when PATH, working directories, or installs
  // change. Explicit checks still run a fresh process by default.
  if (installationVerifications.size >= 64) {
    const oldest = installationVerifications.keys().next().value;
    if (oldest !== undefined) {
      installationVerifications.delete(oldest);
    }
  }
  installationVerifications.set(key, {
    fingerprint,
    startedAt: Date.now(),
    result,
  });
  return await result;
}

async function readInstallationFingerprint(
  launchContract: RuntimeAgentControllerLaunchContract
): Promise<string | null> {
  try {
    // Prefix arguments may delegate to files outside the executable fingerprint.
    if (
      launchContract.kind === "executable" &&
      (launchContract.argsPrefix?.length ?? 0) > 0
    ) {
      return null;
    }
    const paths =
      launchContract.kind === "executable"
        ? [launchContract.commandPath]
        : [launchContract.nodePath, launchContract.scriptPath];
    const fingerprints = await Promise.all(paths.map(fingerprintFile));
    if (launchContract.kind === "node_script") {
      const manifest = await readLaunchPackageManifest(
        launchContract.scriptPath
      );
      if (manifest) {
        fingerprints.push(...(await fingerprintPackage(manifest)));
      }
    }
    return JSON.stringify(fingerprints);
  } catch {
    // Unreadable or changing installations must be checked, never reused.
    return null;
  }
}

async function readLaunchPackageManifest(
  scriptPath: string
): Promise<{ path: string; content: string } | null> {
  let directory = dirname(await realpath(scriptPath));
  for (let depth = 0; depth < 6; depth += 1) {
    const path = join(directory, "package.json");
    try {
      return { path, content: await readFile(path, "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  return null;
}

async function fingerprintPackage(input: {
  path: string;
  content: string;
}): Promise<string[]> {
  const fingerprints = [await fingerprintFile(input.path), input.content];
  const manifest = JSON.parse(input.content) as {
    name?: string;
    optionalDependencies?: Record<string, unknown>;
  };
  if (manifest.name !== "opencode-ai") {
    return fingerprints;
  }
  const require = createRequire(input.path);
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
    if (!OPENCODE_PLATFORM_PACKAGE_RE.test(name)) {
      continue;
    }
    let payloadPath: string;
    try {
      payloadPath = require.resolve(
        `${name}/bin/opencode${process.platform === "win32" ? ".exe" : ""}`
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") {
        throw error;
      }
      fingerprints.push(name, "not_installed");
      continue;
    }
    fingerprints.push(await fingerprintFile(payloadPath));
  }
  return fingerprints;
}

async function fingerprintFile(path: string): Promise<string> {
  const resolvedPath = await realpath(path);
  const info = await stat(resolvedPath, { bigint: true });
  return JSON.stringify([
    resolvedPath,
    ...[
      info.dev,
      info.ino,
      info.mode,
      info.size,
      info.mtimeNs,
      info.ctimeNs,
    ].map(String),
  ]);
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

function resolveOpenCodeCommandDirectories(): string[] {
  return [
    join(
      normalizeOptionalText(process.env.HOME) ?? homedir(),
      ".opencode",
      "bin"
    ),
  ];
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
