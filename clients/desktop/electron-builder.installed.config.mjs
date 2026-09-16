import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { desktopProductionSourceSchema } from "../../packages/schemas/src/desktop-client.ts";
import { readInstalledDesktopTarget } from "../../scripts/desktop/installed-target.ts";
import {
  desktopProductionSource,
  readDesktopSignedPackageMode,
} from "../../scripts/desktop/signed-package.ts";
import { desktopWebBuildIdentity } from "../../scripts/desktop/web-build-identity.mjs";
import {
  DEFAULT_APPLE_TEAM_ID,
  DEFAULT_NOTARY_KEYCHAIN_PROFILE,
} from "../../scripts/release/macos-cli-signing.mjs";

const target = readInstalledDesktopTarget(process.env);
const signedMode = readDesktopSignedPackageMode(process.env);
if (signedMode === "production-preview") {
  const source = desktopProductionSource(process.env);
  const receipt = desktopProductionSourceSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("./dist/production-preview-source.json", import.meta.url),
        "utf8"
      )
    )
  );
  const webBuild = desktopWebBuildIdentity(
    fileURLToPath(new URL("../../", import.meta.url))
  );
  if (
    receipt.releaseSha !== source.releaseSha ||
    receipt.webBuild !== webBuild ||
    JSON.stringify(receipt.target) !== JSON.stringify(target)
  ) {
    throw new Error(
      "Rebuild the production Desktop package through its root entrypoint."
    );
  }
}
if (!target) {
  throw new Error("Select a fixed installed Desktop build target.");
}
const { build } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
);

if (signedMode) {
  process.env.APPLE_KEYCHAIN_PROFILE = DEFAULT_NOTARY_KEYCHAIN_PROFILE;
}

// Both modes use the same installed pages and build pipeline; neither publishes.
export default {
  ...build,
  appId: target.appId,
  productName: target.dataDirectory,
  directories: { output: signedMode ? `dist/${signedMode}` : "dist/installed" },
  files: build.files
    .filter((file) => file !== "out/**/*")
    .concat(["out/main/**/*", "out/preload/**/*"]),
  extraResources: [
    { from: "dist/installed-renderer", to: "desktop-renderer" },
    ...(signedMode === "production-preview"
      ? [
          {
            from: "dist/production-preview-source.json",
            to: "desktop-production-source.json",
          },
        ]
      : []),
  ],
  protocols: [
    { name: "OpenMeld Desktop sign-in", schemes: [target.authScheme] },
  ],
  mac: signedMode
    ? {
        ...build.mac,
        identity: `SOPHIAPRO PTE. LTD. (${DEFAULT_APPLE_TEAM_ID})`,
        type: "distribution",
        notarize: true,
      }
    : build.mac,
  dmg: signedMode
    ? {
        ...build.dmg,
        artifactName: build.dmg.artifactName.replace(
          "-unsigned",
          signedMode === "acceptance" ? "-acceptance" : ""
        ),
        sign: true,
      }
    : build.dmg,
  publish: null,
};
