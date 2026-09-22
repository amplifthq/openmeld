#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Isolated candidate command requires an executable." >&2
  exit 64
fi

trusted_script_shell="$(command -v bash)"
if [ -z "$trusted_script_shell" ]; then
  echo "Isolated candidate command requires a trusted bash script-shell." >&2
  exit 65
fi

command_name="$(basename -- "$1")"
if [ "$command_name" = "pnpm" ] || [ "$command_name" = "pnpm.cmd" ]; then
  set -- "$1" "--config.script-shell=${trusted_script_shell}" "${@:2}"
fi

if [ -n "${OPENMELD_CANDIDATE_SANDBOX_PROFILE:-}" ]; then
  exec env npm_config_script_shell="$trusted_script_shell" \
    sandbox-exec -f "$OPENMELD_CANDIDATE_SANDBOX_PROFILE" "$@"
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
  NPM_CONFIG_SCRIPT_SHELL="$trusted_script_shell" \
  OPENMELD_AFFECTED_BASE="$OPENMELD_AFFECTED_BASE" \
  PATH="$PATH" \
  PNPM_HOME="$OPENMELD_CANDIDATE_HOME/pnpm-bin" \
  XDG_CACHE_HOME="$OPENMELD_CANDIDATE_HOME/.cache" \
  XDG_CONFIG_HOME="$OPENMELD_CANDIDATE_HOME/.config" \
  XDG_DATA_HOME="$OPENMELD_CANDIDATE_HOME/.local/share" \
  XDG_STATE_HOME="$OPENMELD_CANDIDATE_HOME/.local/state" \
  npm_config_script_shell="$trusted_script_shell" \
  "$@"
