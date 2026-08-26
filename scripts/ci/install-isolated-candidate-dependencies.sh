#!/usr/bin/env bash

set -euo pipefail

: "${OPENMELD_CANDIDATE_HOME:?Missing isolated candidate home.}"
: "${OPENMELD_CANDIDATE_ROOT:?Missing isolated candidate root.}"
: "${OPENMELD_TRUSTED_CONTROL_ROOT:?Missing trusted control root.}"

readonly command_wrapper="$OPENMELD_TRUSTED_CONTROL_ROOT/scripts/ci/run-isolated-candidate-command.sh"
readonly approved_builds_script="$OPENMELD_TRUSTED_CONTROL_ROOT/scripts/ci/resolve-approved-native-builds.mjs"
readonly runner_pnpm_executable="$(realpath "$(command -v pnpm)")"
pnpm_package_root="$(dirname "$runner_pnpm_executable")"
while [ "$pnpm_package_root" != "/" ] && [ ! -f "$pnpm_package_root/package.json" ]; do
  pnpm_package_root="$(dirname "$pnpm_package_root")"
done
if [ ! -f "$pnpm_package_root/package.json" ]; then
  echo "Trusted pnpm package root could not be resolved for $runner_pnpm_executable." >&2
  exit 65
fi
readonly pnpm_package_name="$(
  node -e '
    const manifest = require(process.argv[1]);
    process.stdout.write(String(manifest.name ?? ""));
  ' "$pnpm_package_root/package.json"
)"
case "$pnpm_package_name" in
  corepack | pnpm) ;;
  *)
    echo "Trusted pnpm executable resolved to an unexpected package: $pnpm_package_name" >&2
    exit 66
    ;;
esac
readonly trusted_pnpm_root="$(
  mktemp -d "$OPENMELD_TRUSTED_CONTROL_ROOT/.openmeld-pnpm.XXXXXX"
)"
cleanup() {
  rm -rf "$trusted_pnpm_root"
}
trap cleanup EXIT INT TERM
cp -R "$pnpm_package_root/." "$trusted_pnpm_root/"
chmod -R a+rX,go-w "$trusted_pnpm_root"
readonly pnpm_relative_path="${runner_pnpm_executable#"$pnpm_package_root/"}"
readonly pnpm_executable="$(realpath "$trusted_pnpm_root/$pnpm_relative_path")"
case "$pnpm_executable" in
  "$trusted_pnpm_root"/*) ;;
  *)
    echo "Trusted pnpm executable escaped its staged package root." >&2
    exit 67
    ;;
esac

"$command_wrapper" \
  "$pnpm_executable" \
  --config.cache-dir="$OPENMELD_CANDIDATE_HOME/pnpm-cache" \
  --config.global-dir="$OPENMELD_CANDIDATE_HOME/pnpm-global" \
  --config.modules-dir=node_modules \
  --config.state-dir="$OPENMELD_CANDIDATE_HOME/pnpm-state" \
  --config.store-dir="$OPENMELD_CANDIDATE_HOME/pnpm-store" \
  --config.virtual-store-dir=node_modules/.pnpm \
  --dir "$OPENMELD_CANDIDATE_ROOT" install \
  --frozen-lockfile \
  --ignore-scripts

mapfile -t approved_native_builds < <(
  node "$approved_builds_script" "$OPENMELD_TRUSTED_CONTROL_ROOT/pnpm-workspace.yaml"
)
approved_build_flags=()
for package_name in "${approved_native_builds[@]}"; do
  approved_build_flags+=(--config.only-built-dependencies="$package_name")
done
printf 'Rebuilding trusted allowBuilds dependencies only: %s\n' "${approved_native_builds[*]}"
"$command_wrapper" \
  "$pnpm_executable" \
  "${approved_build_flags[@]}" \
  --config.cache-dir="$OPENMELD_CANDIDATE_HOME/pnpm-cache" \
  --config.global-dir="$OPENMELD_CANDIDATE_HOME/pnpm-global" \
  --config.modules-dir=node_modules \
  --config.state-dir="$OPENMELD_CANDIDATE_HOME/pnpm-state" \
  --config.store-dir="$OPENMELD_CANDIDATE_HOME/pnpm-store" \
  --config.virtual-store-dir=node_modules/.pnpm \
  --dir "$OPENMELD_CANDIDATE_ROOT" rebuild \
  "${approved_native_builds[@]}"
