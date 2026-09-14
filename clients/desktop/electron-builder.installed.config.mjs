import { readFileSync } from "node:fs";
import { readInstalledComputerEnvironment } from "../../scripts/desktop/installed-computer-environment.ts";
import { readInstalledDesktopTarget } from "../../scripts/desktop/installed-target.ts";
import {
  DEFAULT_APPLE_TEAM_ID,
  DEFAULT_NOTARY_KEYCHAIN_PROFILE,
} from "../../scripts/release/macos-cli-signing.mjs";

const target = readInstalledDesktopTarget(process.env);
readInstalledComputerEnvironment(process.env);
if (!target) {
  throw new Error("Select a fixed installed Desktop build target.");
}
const { build } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
);

const acceptance = process.env.OPENMELD_DESKTOP_ACCEPTANCE === "1";
if (acceptance) {
  // Builder prioritizes these over Keychain profiles. Refuse mixed credentials.
  for (const name of [
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_API_KEY",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
    "CSC_LINK",
  ]) {
    if (process.env[name]) {
      throw new Error(
        `Unset ${name} to use the local Desktop Keychain profile.`
      );
    }
  }
  process.env.APPLE_KEYCHAIN_PROFILE = DEFAULT_NOTARY_KEYCHAIN_PROFILE;
}

// Both modes use the same installed pages and build pipeline; neither publishes.
export default {
  ...build,
  appId: target.appId,
  productName: target.dataDirectory,
  directories: { output: acceptance ? "dist/acceptance" : "dist/installed" },
  files: build.files
    .filter((file) => file !== "out/**/*")
    .concat(["out/main/**/*", "out/preload/**/*"]),
  extraResources: [{ from: "dist/installed-renderer", to: "desktop-renderer" }],
  protocols: [
    { name: "OpenMeld Desktop sign-in", schemes: [target.authScheme] },
  ],
  mac: acceptance
    ? {
        ...build.mac,
        identity: `SOPHIAPRO PTE. LTD. (${DEFAULT_APPLE_TEAM_ID})`,
        type: "distribution",
        notarize: true,
      }
    : build.mac,
  dmg: acceptance
    ? {
        ...build.dmg,
        artifactName: build.dmg.artifactName.replace(
          "-unsigned",
          "-acceptance"
        ),
        sign: true,
      }
    : build.dmg,
  publish: null,
};
