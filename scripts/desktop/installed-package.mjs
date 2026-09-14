import { fileURLToPath } from "node:url";
import { runOwnedCommand } from "../dev/owned-command.mjs";
import { readInstalledComputerEnvironment } from "./installed-computer-environment.ts";
import { readInstalledDesktopTarget } from "./installed-target.ts";
import { stageDesktopRenderer } from "./private-package.mjs";
import { desktopWebBuildIdentity } from "./web-build-identity.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
readInstalledComputerEnvironment(process.env);
const target = readInstalledDesktopTarget(process.env);
if (!target || process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("Select an installed Desktop target on macOS Apple Silicon.");
}
const staged = stageDesktopRenderer(root, target);
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
