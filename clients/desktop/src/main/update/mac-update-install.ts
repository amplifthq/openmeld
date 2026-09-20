import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import {
  MAC_PRODUCTION_APP_BUNDLE_NAME,
  resolveMacUpdateInstallPlan,
} from "./mac-bundle-path";

const PATH_SEPARATORS = /[\\/]/u;

export const MAC_BUNDLE_RENAME_INSTALL_SCRIPT = `#!/bin/bash
set -euo pipefail
pid=$1
zip=$2
current=$3
target=$4
while /bin/kill -0 "$pid" 2>/dev/null; do
  /bin/sleep 0.2
done
tmp=$(/usr/bin/mktemp -d)
backup=$(/usr/bin/mktemp -d)
restore() {
  if [[ ! -e "$target" && -e "$backup/current" ]]; then
    /bin/mv "$backup/current" "$current" || true
  fi
  if [[ ! -e "$target" && -e "$backup/target" ]]; then
    /bin/mv "$backup/target" "$target" || true
  fi
}
cleanup() {
  restore
  /bin/rm -rf "$tmp"
}
trap cleanup EXIT
/usr/bin/ditto -x -k "$zip" "$tmp"
new="$tmp/${MAC_PRODUCTION_APP_BUNDLE_NAME}"
if [[ ! -x "$new/Contents/MacOS/OpenMeld" || ! -f "$new/Contents/Info.plist" ]]; then
  exit 1
fi
if [[ -e "$target" && "$target" != "$current" ]]; then
  /bin/mv "$target" "$backup/target"
fi
/bin/mv "$current" "$backup/current"
/bin/mv "$new" "$target"
trap - EXIT
/bin/rm -rf "$backup" "$tmp"
/usr/bin/open "$target"
`;

export type MacBundleRenameInstall = {
  zipPath: string;
  currentBundle: string;
  targetBundle: string;
  pid: number;
};

function assertInstallPath(path: string, kind: "zip" | "bundle"): void {
  if (
    !(
      isAbsolute(path) &&
      !path.includes("\0") &&
      !path.includes("\n") &&
      !path.split(PATH_SEPARATORS).includes("..")
    )
  ) {
    throw new Error(`Desktop update ${kind} path is not trusted.`);
  }
}

export function assertMacBundleRenameInstall(
  input: MacBundleRenameInstall
): MacBundleRenameInstall {
  const plan = resolveMacUpdateInstallPlan({
    currentBundle: input.currentBundle,
  });
  if (plan.kind !== "rename") {
    throw new Error(
      "Desktop update does not need an application-folder rename."
    );
  }
  assertInstallPath(input.zipPath, "zip");
  assertInstallPath(input.currentBundle, "bundle");
  assertInstallPath(input.targetBundle, "bundle");
  if (!input.zipPath.endsWith(".zip")) {
    throw new Error("Desktop update archive must be the verified ZIP.");
  }
  if (input.currentBundle !== plan.currentBundle) {
    throw new Error("Desktop update source application folder changed.");
  }
  if (
    input.targetBundle !== plan.targetBundle ||
    basename(input.targetBundle) !== MAC_PRODUCTION_APP_BUNDLE_NAME
  ) {
    throw new Error(
      "Desktop update target application folder is not OpenMeld.app."
    );
  }
  if (!Number.isInteger(input.pid) || input.pid <= 0) {
    throw new Error("Desktop update is missing its process identity.");
  }
  return {
    zipPath: input.zipPath,
    currentBundle: plan.currentBundle,
    targetBundle: plan.targetBundle,
    pid: input.pid,
  };
}

export function installRenamedMacBundle(
  input: MacBundleRenameInstall,
  deps: {
    spawn?: typeof spawn;
    writeFile?: typeof writeFileSync;
    scriptPath?: string;
    platform?: NodeJS.Platform;
  } = {}
): void {
  if ((deps.platform ?? process.platform) !== "darwin") {
    throw new Error(
      "Application-folder rename install is only available on macOS."
    );
  }
  const install = assertMacBundleRenameInstall(input);
  const scriptPath =
    deps.scriptPath ?? join(tmpdir(), `openmeld-mac-update-${randomUUID()}.sh`);
  const writeFile = deps.writeFile ?? writeFileSync;
  writeFile(scriptPath, MAC_BUNDLE_RENAME_INSTALL_SCRIPT, { mode: 0o700 });
  const child = (deps.spawn ?? spawn)(
    "/bin/bash",
    [
      scriptPath,
      String(install.pid),
      install.zipPath,
      install.currentBundle,
      install.targetBundle,
    ],
    { detached: true, stdio: "ignore" }
  );
  child.unref();
}
