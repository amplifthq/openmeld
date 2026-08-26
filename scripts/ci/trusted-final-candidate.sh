#!/usr/bin/env bash

set -euo pipefail

readonly command="${1:-help}"
if [ "$#" -gt 0 ]; then
  shift
fi

readonly candidate_root="$(git rev-parse --show-toplevel)"
git -C "$candidate_root" fetch --no-tags origin \
  refs/heads/main:refs/remotes/origin/main
readonly current_main="$(git -C "$candidate_root" rev-parse --verify refs/remotes/origin/main^{commit})"
readonly temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/openmeld-trusted-final-candidate.XXXXXX")"
readonly control_root="$temporary_root/control"

cleanup() {
  if [ -d "$control_root" ]; then
    git -C "$candidate_root" worktree remove --force "$control_root" >/dev/null 2>&1 || true
  fi
  rm -rf "$temporary_root"
}
trap cleanup EXIT INT TERM

git -C "$candidate_root" worktree add --detach --quiet "$control_root" "$current_main"
readonly bootstrap_path="$(cd "$control_root" && pwd -P)/scripts/ci/final-candidate-bootstrap.mjs"
if [ ! -f "$bootstrap_path" ]; then
  echo "Current main does not contain the trusted Final Candidate bootstrap: $current_main" >&2
  exit 66
fi

printf '%s\n' \
  "Trusted Final Candidate first hop" \
  "Candidate root: $candidate_root" \
  "Current main: $current_main" \
  "Control entry: $bootstrap_path"

cd "$candidate_root"
case "$command" in
  local)
    node "$bootstrap_path" run --mode local --publish-status "$@"
    ;;
  plan | request | help)
    node "$bootstrap_path" "$command" "$@"
    ;;
  *)
    echo "Trusted Final Candidate command must be plan, request, local, or help." >&2
    exit 64
    ;;
esac
