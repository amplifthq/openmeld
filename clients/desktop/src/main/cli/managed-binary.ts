import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import {
  allowUnsignedWindowsInternalPreview,
  type CliBinaryDownloadProgress,
  DEFAULT_CLI_BINARY_DOWNLOAD_POLICY,
  downloadCliBinaryUpdateArtifact,
  prepareCliBinaryProcessHelper,
  resolveFullCliBinaryUpdatePlan,
  verifyCliBinaryCodeSignature,
} from "@openmeld/local-service/cli-binary-update-artifact";
import {
  type CliBinaryManifest,
  cliBinaryManifestSchema,
  cliInstallSelfResultSchema,
  resolveCliBinaryPlatform,
} from "@openmeld/schemas";
import type { CommandDeps } from "./commands";

function hasAcceptedSigningIdentity(
  platform: string,
  release: CliBinaryManifest["channels"]["stable"]["platforms"][string],
  env: CommandDeps["env"]
) {
  if (platform === "windows-x64") {
    return Boolean(
      release.windows &&
        ("publisherName" in release.windows ||
          allowUnsignedWindowsInternalPreview(env))
    );
  }
  return Boolean(release.codeIdentifier && release.teamIdentifier);
}

/** Bootstrap only. The downloaded CLI owns managed installation and Service state. */
export async function installManagedBinary(
  webOrigin: string,
  deps: CommandDeps,
  observation: {
    onDownloadProgress?: (progress: CliBinaryDownloadProgress) => void;
    onStage?: (stage: "downloading" | "verifying" | "installing") => void;
  } = {}
) {
  const reportStage = (stage: "downloading" | "verifying" | "installing") => {
    try {
      observation.onStage?.(stage);
    } catch {
      // Optional UI observation never controls installation.
    }
  };
  let pendingDownloadProgress: CliBinaryDownloadProgress | null = null;
  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  let lastProgressAt = 0;
  const emitDownloadProgress = (progress: CliBinaryDownloadProgress) => {
    lastProgressAt = Date.now();
    try {
      observation.onDownloadProgress?.(progress);
    } catch {
      // Optional UI observation never controls the artifact reader.
    }
  };
  const flushDownloadProgress = () => {
    if (progressTimer) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
    if (pendingDownloadProgress) {
      const progress = pendingDownloadProgress;
      pendingDownloadProgress = null;
      emitDownloadProgress(progress);
    }
  };
  const reportDownloadProgress = (progress: CliBinaryDownloadProgress) => {
    const now = Date.now();
    if (
      lastProgressAt === 0 ||
      now - lastProgressAt >= 350 ||
      progress.receivedBytes >= progress.totalBytes
    ) {
      pendingDownloadProgress = null;
      if (progressTimer) {
        clearTimeout(progressTimer);
        progressTimer = null;
      }
      emitDownloadProgress(progress);
      return;
    }
    pendingDownloadProgress = progress;
    progressTimer ??= setTimeout(
      flushDownloadProgress,
      350 - (now - lastProgressAt)
    );
  };
  const platform = resolveCliBinaryPlatform(process.platform, process.arch);
  if (platform !== "darwin-arm64" && platform !== "windows-x64") {
    throw new Error(
      "OpenMeld Tools are available for Apple silicon Macs and 64-bit Windows PCs."
    );
  }
  const manifestUrl = new URL(
    deps.env?.OPENMELD_CLI_BINARY_MANIFEST_URL ?? "/cli/manifest.json",
    webOrigin
  );
  if (manifestUrl.origin !== new URL(webOrigin).origin) {
    throw new Error("OpenMeld Tools returned an unexpected download location.");
  }
  const response = await fetch(manifestUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      "OpenMeld Tools could not be downloaded. Check your connection and try again."
    );
  }
  const manifest = cliBinaryManifestSchema.parse(await response.json());
  const release = manifest.channels.stable.platforms[platform];
  if (!release) {
    throw new Error("OpenMeld Tools are unavailable for this computer.");
  }
  if (
    deps.env?.OPENMELD_ENV_PRESET === "prod" &&
    !hasAcceptedSigningIdentity(platform, release, deps.env)
  ) {
    throw new Error(
      "OpenMeld Tools do not include a verified signing identity."
    );
  }
  const plan = resolveFullCliBinaryUpdatePlan(release);
  if (
    new URL(plan.downloadUrl).origin !== manifestUrl.origin ||
    new URL(release.url).origin !== manifestUrl.origin
  ) {
    throw new Error("OpenMeld Tools returned an unexpected download location.");
  }
  reportStage("downloading");
  let bytes: Uint8Array;
  try {
    bytes = await downloadCliBinaryUpdateArtifact({
      downloadPolicy: DEFAULT_CLI_BINARY_DOWNLOAD_POLICY,
      fetchImpl: (input, init) => fetch(input, { ...init, redirect: "error" }),
      onDeltaFallback: () => {
        /* A new installation always uses the complete artifact. */
      },
      onProgress: reportDownloadProgress,
      plan,
      release,
    });
  } finally {
    flushDownloadProgress();
  }
  const temporary = await mkdtemp(join(tmpdir(), "openmeld-desktop-install-"));
  const artifactPath = join(
    temporary,
    platform === "windows-x64" ? "openmeld.exe" : "openmeld"
  );
  const exec = promisify(execFile);
  try {
    await writeFile(artifactPath, bytes, { mode: 0o700 });
    await chmod(artifactPath, 0o700);
    reportStage("verifying");
    await verifyCliBinaryCodeSignature({
      allowUnsignedPreview: allowUnsignedWindowsInternalPreview(deps.env),
      artifactPath,
      allowUnsignedForDevelopment:
        deps.env?.OPENMELD_ENV_PRESET === "dev-local",
      release,
      runCommand: async (command, args) => {
        try {
          const result = await exec(command, args, { timeout: 30_000 });
          return { code: 0, ...result };
        } catch {
          return {
            code: 1,
            stdout: "",
            stderr: "Signature verification failed",
          };
        }
      },
    });
    await prepareCliBinaryProcessHelper({
      allowUnsignedPreview: allowUnsignedWindowsInternalPreview(deps.env),
      artifactPath,
      release,
      downloadPolicy: DEFAULT_CLI_BINARY_DOWNLOAD_POLICY,
      fetchImpl: (input, init) => fetch(input, { ...init, redirect: "error" }),
    });
    // No npm, shell, or GUI-owned Service installation. Never force a downgrade.
    reportStage("installing");
    const installed = await exec(artifactPath, ["install-self", "--json"], {
      env: deps.env,
      timeout: 0,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const receipt = cliInstallSelfResultSchema.parse(
      JSON.parse(installed.stdout)
    );
    if (
      receipt.platform !== platform ||
      !isAbsolute(receipt.currentPointerPath)
    ) {
      throw new Error(
        "OpenMeld Tools returned an invalid installation location."
      );
    }
    return receipt.currentPointerPath;
  } finally {
    if (progressTimer) {
      clearTimeout(progressTimer);
    }
    await rm(temporary, { recursive: true, force: true });
  }
}
