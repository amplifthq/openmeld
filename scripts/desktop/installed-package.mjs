import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runOwnedCommand } from "../dev/owned-command.mjs";
import { checkProductionArtifact } from "../release/production-artifact-check.mjs";
import { buildInstalledPlatformPlan } from "./installed-platform.ts";
import { readInstalledDesktopTarget } from "./installed-target.ts";
import { stageDesktopRenderer } from "./private-package.mjs";
import {
  desktopInternalPreviewSource,
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
const internalPreviewSource =
  signedMode === "internal-preview" ? desktopInternalPreviewSource() : null;
const target = readInstalledDesktopTarget(process.env);
if (!target) {
  throw new Error("Select a fixed installed Desktop target.");
}
const plan = buildInstalledPlatformPlan({
  env: process.env,
  target,
  signedMode,
});
if (productionSource) {
  await checkProductionArtifact({
    root,
    scope: "desktop",
    sourceSha: productionSource.releaseSha,
  });
}
const staged = stageDesktopRenderer(root, target);
if (productionSource || internalPreviewSource) {
  writeFileSync(
    new URL(
      `../../clients/desktop/dist/${productionSource ? "production-preview" : "internal-preview"}-source.json`,
      import.meta.url
    ),
    JSON.stringify({
      ...(productionSource ?? internalPreviewSource),
      webBuild: staged.webBuild,
      target,
      ...(plan.windows ? { windows: plan.windows } : {}),
    })
  );
}
for (const args of [
  ...(plan.generateMacIcons
    ? [["--dir", "clients/desktop", "icons:generate"]]
    : []),
  ["--dir", "clients/desktop", "build"],
  [
    "--dir",
    "clients/desktop",
    "exec",
    "electron-builder",
    "--config",
    "electron-builder.installed.config.mjs",
    ...plan.args,
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
    windowsJob: Boolean(plan.windows),
    env: {
      ...process.env,
      ...(plan.generateMacIcons ||
      !signedMode ||
      signedMode === "internal-preview"
        ? { CSC_IDENTITY_AUTO_DISCOVERY: "false" }
        : {}),
    },
  });
  if (code !== 0) {
    process.exitCode = code;
    break;
  }
}
