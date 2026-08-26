#!/usr/bin/env bash

set -euo pipefail

: "${OPENMELD_CANDIDATE_HOME:?Missing isolated candidate home.}"
: "${OPENMELD_CANDIDATE_ROOT:?Missing isolated candidate root.}"
: "${OPENMELD_TRUSTED_CONTROL_ROOT:?Missing trusted control root.}"

readonly command_wrapper="$OPENMELD_TRUSTED_CONTROL_ROOT/scripts/ci/run-isolated-candidate-command.sh"
readonly approved_builds_script="$OPENMELD_TRUSTED_CONTROL_ROOT/scripts/ci/resolve-approved-native-builds.mjs"
readonly runner_pnpm_command="$(command -v pnpm)"
if ! expected_pnpm_version="$(
  node -e '
    const manifest = require(process.argv[1]);
    const match = /^pnpm@(.+)$/.exec(String(manifest.packageManager ?? ""));
    if (!match) process.exit(1);
    process.stdout.write(match[1]);
  ' "$OPENMELD_TRUSTED_CONTROL_ROOT/package.json"
)"; then
  echo "Trusted control does not declare an exact pnpm packageManager version." >&2
  exit 65
fi
readonly expected_pnpm_version
readonly actual_pnpm_version="$("$runner_pnpm_command" --version)"
if [ "$actual_pnpm_version" != "$expected_pnpm_version" ]; then
  echo "Trusted pnpm version mismatch: expected $expected_pnpm_version, got $actual_pnpm_version." >&2
  exit 66
fi
install -d -m 0700 "$OPENMELD_CANDIDATE_HOME"
readonly pnpm_executable="$runner_pnpm_command"

"$command_wrapper" \
  "$pnpm_executable" \
  --config.cache-dir="$OPENMELD_CANDIDATE_HOME/pnpm-cache" \
  --config.global-dir="$OPENMELD_CANDIDATE_HOME/pnpm-global" \
  --config.ignore-pnpmfile=true \
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
  --config.ignore-pnpmfile=true \
  --config.modules-dir=node_modules \
  --config.state-dir="$OPENMELD_CANDIDATE_HOME/pnpm-state" \
  --config.store-dir="$OPENMELD_CANDIDATE_HOME/pnpm-store" \
  --config.virtual-store-dir=node_modules/.pnpm \
  --dir "$OPENMELD_CANDIDATE_ROOT" rebuild \
  "${approved_native_builds[@]}"
