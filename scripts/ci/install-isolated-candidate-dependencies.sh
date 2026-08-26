#!/usr/bin/env bash

set -euo pipefail

: "${OPENMELD_CANDIDATE_HOME:?Missing isolated candidate home.}"
: "${OPENMELD_CANDIDATE_ROOT:?Missing isolated candidate root.}"
: "${OPENMELD_TRUSTED_CONTROL_ROOT:?Missing trusted control root.}"

readonly command_wrapper="$OPENMELD_TRUSTED_CONTROL_ROOT/scripts/ci/run-isolated-candidate-command.sh"
readonly pnpm_executable="$(command -v pnpm)"
readonly approved_builds_script="$OPENMELD_TRUSTED_CONTROL_ROOT/scripts/ci/resolve-approved-native-builds.mjs"

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
exec "$command_wrapper" \
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
