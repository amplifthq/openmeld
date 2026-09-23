import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type CliBinaryDownloadProgress,
  DEFAULT_CLI_BINARY_DOWNLOAD_POLICY,
  downloadCliBinaryUpdateArtifact,
  prepareCliBinaryProcessHelper,
  resolveFullCliBinaryUpdatePlan,
  verifyCliBinaryCodeSignature,
} from "@openmeld/local-service/cli-binary-update-artifact";
import { cliBinaryManifestSchema } from "@openmeld/schemas";
import type { CommandDeps } from "./commands";

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
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("Connecting this computer requires an Apple silicon Mac.");
  }
  const manifestUrl = new URL("/cli/manifest.json", webOrigin);
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
  const release = manifest.channels.stable.platforms["darwin-arm64"];
  if (!release) {
    throw new Error("OpenMeld Tools are unavailable for this Mac.");
  }
  if (
    deps.env?.OPENMELD_ENV_PRESET === "prod" &&
    !(release.codeIdentifier && release.teamIdentifier)
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
  const artifactPath = join(temporary, "openmeld");
  const exec = promisify(execFile);
  try {
    await writeFile(artifactPath, bytes, { mode: 0o700 });
    await chmod(artifactPath, 0o700);
    reportStage("verifying");
    await verifyCliBinaryCodeSignature({
      artifactPath,
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
      artifactPath,
      release,
      downloadPolicy: DEFAULT_CLI_BINARY_DOWNLOAD_POLICY,
      fetchImpl: (input, init) => fetch(input, { ...init, redirect: "error" }),
    });
    // No npm, shell, or GUI-owned Service installation. Never force a downgrade.
    reportStage("installing");
    await exec(artifactPath, ["install-self", "--json"], {
      env: deps.env,
      timeout: 0,
      maxBuffer: 1024 * 1024,
    });
  } finally {
    if (progressTimer) {
      clearTimeout(progressTimer);
    }
    await rm(temporary, { recursive: true, force: true });
  }
}
