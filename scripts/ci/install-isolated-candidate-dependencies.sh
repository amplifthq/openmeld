#!/usr/bin/env bash

set -euo pipefail

: "${OPENMELD_CANDIDATE_HOME:?Missing isolated candidate home.}"
: "${OPENMELD_CANDIDATE_ROOT:?Missing isolated candidate root.}"
: "${OPENMELD_TRUSTED_CONTROL_ROOT:?Missing trusted control root.}"

readonly command_wrapper="$OPENMELD_TRUSTED_CONTROL_ROOT/scripts/ci/run-isolated-candidate-command.sh"
readonly pnpm_executable="$(command -v pnpm)"

exec "$command_wrapper" \
  "$pnpm_executable" \
  --config.cache-dir="$OPENMELD_CANDIDATE_HOME/pnpm-cache" \
  --config.global-dir="$OPENMELD_CANDIDATE_HOME/pnpm-global" \
  --config.modules-dir="$OPENMELD_CANDIDATE_ROOT/node_modules" \
  --config.state-dir="$OPENMELD_CANDIDATE_HOME/pnpm-state" \
  --config.store-dir="$OPENMELD_CANDIDATE_HOME/pnpm-store" \
  --config.virtual-store-dir="$OPENMELD_CANDIDATE_ROOT/node_modules/.pnpm" \
  --dir "$OPENMELD_CANDIDATE_ROOT" install \
  --frozen-lockfile \
  --ignore-scripts
