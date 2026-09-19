import type { DesktopInstalledTarget } from "../../packages/schemas/dist/desktop-client.js";
import {
  desktopPlatformUpdateFeedUrl,
  desktopWindowsBuildSchema,
  resolveDesktopReleasePlatform,
} from "../../packages/schemas/dist/desktop-release.js";

const CERTIFICATE_SHA1 = /^[a-f0-9]{40}$/iu;

export function readInstalledDesktopPlatform(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
) {
  const selected = env.OPENMELD_DESKTOP_ARCH ?? arch;
  const releasePlatform = resolveDesktopReleasePlatform(platform, selected);
  if (!releasePlatform) {
    throw new Error(
      "Build installed Desktop on an Apple silicon Mac or native Windows x64/ARM64. Unsupported targets are never substituted."
    );
  }
  return { platform: releasePlatform, arch: selected };
}

export function readWindowsDesktopSigning(
  env: NodeJS.ProcessEnv,
  platform: string
) {
  return desktopWindowsBuildSchema.parse({
    platform,
    publisherName: env.OPENMELD_DESKTOP_WINDOWS_PUBLISHER,
  });
}

export function buildInstalledPlatformPlan(input: {
  env: NodeJS.ProcessEnv;
  target: DesktopInstalledTarget;
  signedMode: "acceptance" | "production-preview" | null;
  platform?: NodeJS.Platform;
  arch?: string;
}) {
  const selected = readInstalledDesktopPlatform(
    input.env,
    input.platform,
    input.arch
  );
  const mac = selected.platform === "macos-arm64";
  if (
    !mac &&
    input.target.kind === "production" &&
    input.signedMode !== "production-preview"
  ) {
    throw new Error(
      "Production Windows Desktop requires the signed production-preview entrypoint. Use a disposable target for unsigned acceptance."
    );
  }
  const windows =
    !mac && input.signedMode
      ? readWindowsDesktopSigning(input.env, selected.platform)
      : null;
  const certificateSha1 = input.env.OPENMELD_DESKTOP_WINDOWS_CERTIFICATE_SHA1;
  if (certificateSha1 && !CERTIFICATE_SHA1.test(certificateSha1)) {
    throw new Error(
      "Windows certificate selector must be its 40-character SHA1 identity."
    );
  }
  return {
    ...selected,
    windows,
    args: mac
      ? [
          "--mac",
          "dmg",
          ...(input.signedMode === "production-preview" ? ["zip"] : []),
          "--arm64",
        ]
      : ["--win", "nsis", `--${selected.arch}`],
    generateMacIcons: mac,
    ...(mac
      ? {}
      : {
          forceCodeSigning: Boolean(windows),
          win: {
            target: [{ target: "nsis", arch: [selected.arch] }],
            icon: "resources/icon.png",
            requestedExecutionLevel: "asInvoker",
            signExecutable: Boolean(windows),
            verifyUpdateCodeSignature: true,
            ...(windows
              ? {
                  signtoolOptions: {
                    publisherName: [windows.publisherName],
                    signingHashAlgorithms: ["sha256"],
                    ...(certificateSha1 ? { certificateSha1 } : {}),
                  },
                }
              : {}),
          },
          nsis: {
            oneClick: true,
            perMachine: false,
            allowElevation: false,
            packElevateHelper: false,
            deleteAppDataOnUninstall: false,
            buildUniversalInstaller: false,
            differentialPackage: false,
            artifactName: `OpenMeld-Desktop-\${version}-windows-\${arch}${input.signedMode ? "" : "-unsigned"}.\${ext}`,
          },
        }),
    publish:
      input.signedMode === "production-preview"
        ? {
            provider: "generic",
            url: desktopPlatformUpdateFeedUrl(selected.platform),
          }
        : null,
  };
}
