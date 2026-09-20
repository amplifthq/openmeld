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
const SHA512_HEX = /^[a-f0-9]{128}$/u;

export const MAC_BUNDLE_RENAME_INSTALL_SCRIPT = `#!/bin/bash
set -euo pipefail
pid=$1
zip=$2
current=$3
target=$4
source_version=$5
target_version=$6
expected_sha512=$7
receipt=$8
stage=""
target_backup="${target}.openmeld-update-backup.$$"
target_placed=0
had_target=0
step="waiting_for_exit"

write_receipt() {
  state=$1
  receipt_tmp="${receipt}.tmp.$$"
  /usr/bin/printf 'state=%s\\nsourceVersion=%s\\ntargetVersion=%s\\nsourceBundle=%s\\ntargetBundle=%s\\n' \
    "$state" "$source_version" "$target_version" \
    "${current##*/}" "${target##*/}" > "$receipt_tmp"
  /bin/mv "$receipt_tmp" "$receipt"
}

restore_target() {
  if [[ "$target_placed" -eq 1 && -e "$target" ]]; then
    /bin/rm -rf "$target" || true
  fi
  if [[ "$had_target" -eq 1 && -e "$target_backup" && ! -e "$target" ]]; then
    /bin/mv "$target_backup" "$target" || true
  fi
}

fail_install() {
  status=$?
  write_receipt "failed:${step}" || true
  restore_target
  if [[ -n "$stage" && -e "$stage" ]]; then
    /bin/rm -rf "$stage" || true
  fi
  exit "$status"
}

trap fail_install ERR INT TERM
write_receipt "waiting_for_exit"
while /bin/kill -0 "$pid" 2>/dev/null; do
  /bin/sleep 0.2
done

step="verify_archive"
actual_sha512=$(/usr/bin/shasum -a 512 "$zip" | /usr/bin/awk '{print $1}')
[[ "$actual_sha512" == "$expected_sha512" ]]

step="extract_candidate"
stage=$(/usr/bin/mktemp -d)
/usr/bin/ditto -x -k "$zip" "$stage"
new="$stage/OpenMeld.app"

step="verify_candidate"
[[ -x "$new/Contents/MacOS/OpenMeld" ]]
[[ -f "$new/Contents/Info.plist" ]]
/usr/bin/codesign --verify --deep --strict --verbose=2 "$new"
signature=$(/usr/bin/codesign --display --verbose=4 "$new" 2>&1)
/usr/bin/printf '%s\\n' "$signature" | /usr/bin/grep -Fx 'Identifier=sh.openmeld.desktop' >/dev/null
/usr/bin/printf '%s\\n' "$signature" | /usr/bin/grep -Fx 'TeamIdentifier=38FFHDPA3B' >/dev/null
/usr/bin/printf '%s\\n' "$signature" | /usr/bin/grep -F 'Authority=Developer ID Application:' >/dev/null
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$new/Contents/Info.plist")
bundle_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$new/Contents/Info.plist")
[[ "$bundle_id" == "sh.openmeld.desktop" ]]
[[ "$bundle_version" == "$target_version" ]]
/usr/sbin/spctl --assess --type execute --verbose=4 "$new"
write_receipt "candidate_verified"

step="place_target"
if [[ -e "$target" ]]; then
  /bin/mv "$target" "$target_backup"
  had_target=1
fi
/bin/mv "$new" "$target"
target_placed=1
write_receipt "target_placed"

step="launch_target"
/usr/bin/open "$target"
write_receipt "launch_attempted"
launched=0
for _ in {1..50}; do
  if /bin/ps -axo command= | /usr/bin/grep -F "$target/Contents/MacOS/OpenMeld" | /usr/bin/grep -v grep >/dev/null; then
    launched=1
    break
  fi
  /bin/sleep 0.2
done
[[ "$launched" -eq 1 ]]
write_receipt "launch_confirmed"

trap - ERR INT TERM
/bin/rm -rf "$current" || true
if [[ "$had_target" -eq 1 && -e "$target_backup" ]]; then
  /bin/rm -rf "$target_backup" || true
fi
/bin/rm -rf "$stage" || true
/bin/rm -f "$0" || true
`;

export type MacBundleRenameInstall = {
  zipPath: string;
  currentBundle: string;
  targetBundle: string;
  pid: number;
  sourceVersion: string;
  expectedVersion: string;
  expectedSha512Hex: string;
  receiptPath: string;
};

function assertInstallPath(
  path: string,
  kind: "zip" | "bundle" | "receipt"
): void {
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
  assertInstallPath(input.receiptPath, "receipt");
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
  if (!(input.sourceVersion && input.expectedVersion)) {
    throw new Error("Desktop update is missing its version identity.");
  }
  if (!SHA512_HEX.test(input.expectedSha512Hex)) {
    throw new Error("Desktop update is missing its verified SHA-512 identity.");
  }
  return {
    zipPath: input.zipPath,
    currentBundle: plan.currentBundle,
    targetBundle: plan.targetBundle,
    pid: input.pid,
    sourceVersion: input.sourceVersion,
    expectedVersion: input.expectedVersion,
    expectedSha512Hex: input.expectedSha512Hex,
    receiptPath: input.receiptPath,
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
      install.sourceVersion,
      install.expectedVersion,
      install.expectedSha512Hex,
      install.receiptPath,
    ],
    { detached: true, stdio: "ignore" }
  );
  child.unref();
}
