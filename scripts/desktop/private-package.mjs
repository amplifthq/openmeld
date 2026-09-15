import { cpSync, lstatSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePilotAssets } from "../../clients/desktop/src/main/pilot-assets.ts";
import { runOwnedCommand } from "../dev/owned-command.mjs";
import { desktopWebBuildIdentity } from "./web-build-identity.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export function stageDesktopRenderer(
  root = repoRoot,
  installedTarget = undefined
) {
  const webBuild = desktopWebBuildIdentity(root);
  const source = validatePilotAssets(
    join(root, "clients/web/dist/client"),
    webBuild,
    installedTarget
  );
  const destination = join(
    root,
    `clients/desktop/dist/${installedTarget ? "installed" : "private"}-renderer`
  );
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, {
    recursive: true,
    filter(file) {
      if (lstatSync(file).isSymbolicLink()) {
        throw new Error("Desktop assets must not contain symbolic links.");
      }
      // Source maps are diagnostics, not renderer prerequisites.
      return !(file.endsWith(".map") || basename(file).startsWith("."));
    },
  });
  validatePilotAssets(destination, webBuild, installedTarget);
  return { destination, webBuild };
}

async function main() {
  if (
    process.argv.length !== 2 ||
    process.platform !== "darwin" ||
    process.arch !== "arm64"
  ) {
    throw new Error("Run pnpm desktop:package:private on macOS Apple Silicon.");
  }
  const staged = stageDesktopRenderer();
  const options = {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENMELD_DESKTOP_PRIVATE_PACKAGE: "1",
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    },
  };
  for (const args of [
    ["--dir", "clients/desktop", "icons:generate"],
    ["--dir", "clients/desktop", "build"],
    [
      "--dir",
      "clients/desktop",
      "exec",
      "electron-builder",
      "--config",
      "electron-builder.private.config.mjs",
      "--mac",
      "dmg",
      "--arm64",
      "--publish",
      "never",
    ],
  ]) {
    if (desktopWebBuildIdentity(repoRoot) !== staged.webBuild) {
      throw new Error(
        "Web source changed during private packaging. Rebuild Web and retry."
      );
    }
    const code = await runOwnedCommand("pnpm", args, options);
    if (code !== 0) {
      process.exitCode = code;
      return;
    }
  }
  console.log(
    `Private unsigned Desktop: clients/desktop/dist/private\nWeb build: ${staged.webBuild}\nNo release metadata, upload, or publication was performed.`
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
