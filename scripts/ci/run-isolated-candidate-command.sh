#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Isolated candidate command requires an executable." >&2
  exit 64
fi

if [ -n "${OPENMELD_CANDIDATE_SANDBOX_PROFILE:-}" ]; then
  exec sandbox-exec -f "$OPENMELD_CANDIDATE_SANDBOX_PROFILE" "$@"
fi

: "${OPENMELD_CANDIDATE_HOME:?Missing isolated candidate home.}"
: "${OPENMELD_CANDIDATE_ROOT:?Missing isolated candidate root.}"
: "${OPENMELD_AFFECTED_BASE:?Missing exact affected base.}"

exec env -i \
  CI=true \
  GIT_CONFIG_GLOBAL=/dev/null \
  GIT_CONFIG_NOSYSTEM=1 \
  GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0=safe.directory \
  GIT_CONFIG_VALUE_0="$OPENMELD_CANDIDATE_ROOT" \
  GIT_OPTIONAL_LOCKS=0 \
  GIT_TERMINAL_PROMPT=0 \
  HOME="$OPENMELD_CANDIDATE_HOME" \
  NODE_OPTIONS=--max-old-space-size=6144 \
  OPENMELD_AFFECTED_BASE="$OPENMELD_AFFECTED_BASE" \
  PATH="$PATH" \
  PNPM_HOME="$OPENMELD_CANDIDATE_HOME/pnpm-bin" \
  XDG_CACHE_HOME="$OPENMELD_CANDIDATE_HOME/.cache" \
  XDG_CONFIG_HOME="$OPENMELD_CANDIDATE_HOME/.config" \
  XDG_DATA_HOME="$OPENMELD_CANDIDATE_HOME/.local/share" \
  XDG_STATE_HOME="$OPENMELD_CANDIDATE_HOME/.local/state" \
  "$@"
