import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runOwnedCommand } from "../dev/owned-command.mjs";
import { readInstalledDesktopTarget } from "./installed-target.ts";
import { stageDesktopRenderer } from "./private-package.mjs";
import {
  desktopProductionSource,
  readDesktopSignedPackageMode,
} from "./signed-package.ts";
import { desktopWebBuildIdentity } from "./web-build-identity.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const signedMode = readDesktopSignedPackageMode(process.env);
const productionSource =
  signedMode === "production-preview"
    ? desktopProductionSource(process.env)
    : null;
const target = readInstalledDesktopTarget(process.env);
if (!target || process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("Select an installed Desktop target on macOS Apple Silicon.");
}
const staged = stageDesktopRenderer(root, target);
if (productionSource) {
  writeFileSync(
    new URL(
      "../../clients/desktop/dist/production-preview-source.json",
      import.meta.url
    ),
    JSON.stringify({ ...productionSource, webBuild: staged.webBuild, target })
  );
}
for (const args of [
  ["--dir", "clients/desktop", "icons:generate"],
  ["--dir", "clients/desktop", "build"],
  [
    "--dir",
    "clients/desktop",
    "exec",
    "electron-builder",
    "--config",
    "electron-builder.installed.config.mjs",
    "--mac",
    "dmg",
    "--arm64",
    "--publish",
    "never",
  ],
]) {
  if (desktopWebBuildIdentity(root) !== staged.webBuild) {
    throw new Error(
      "Desktop source changed during packaging. Rebuild renderer assets first."
    );
  }
  const code = await runOwnedCommand("pnpm", args, {
    cwd: root,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  });
  if (code !== 0) {
    process.exitCode = code;
    break;
  }
}
