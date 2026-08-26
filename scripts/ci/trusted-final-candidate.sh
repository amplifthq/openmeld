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
readonly candidate_head="$(git -C "$candidate_root" rev-parse --verify HEAD^{commit})"
readonly bootstrap_relative_path="scripts/ci/final-candidate-bootstrap.mjs"
control_sha="$current_main"
control_trust="current-main"

if ! git -C "$candidate_root" cat-file -e "$current_main:$bootstrap_relative_path" 2>/dev/null; then
  bootstrap_control_sha=""
  bootstrap_reason=""
  arguments=("$@")
  for ((index = 0; index < ${#arguments[@]}; index += 1)); do
    case "${arguments[$index]}" in
      --bootstrap-control-sha)
        bootstrap_control_sha="${arguments[$((index + 1))]:-}"
        ;;
      --bootstrap-reason)
        bootstrap_reason="${arguments[$((index + 1))]:-}"
        ;;
    esac
  done
  if [[ ! "$bootstrap_control_sha" =~ ^[0-9a-f]{40}$ ]] ||
    [ "$(git -C "$candidate_root" rev-parse --verify "$bootstrap_control_sha^{commit}" 2>/dev/null || true)" != "$candidate_head" ] ||
    [ "${#bootstrap_reason}" -lt 20 ]; then
    printf '%s\n' \
      "Current main does not contain the trusted Final Candidate bootstrap: $current_main" \
      "Use an inspected exact candidate control object only through the explicit local bootstrap:" \
      "  git show <exact-candidate-head>:scripts/ci/trusted-final-candidate.sh | bash -s -- local --pr <number> --bootstrap-control-sha <exact-candidate-head> --bootstrap-reason <why-current-main-cannot-own-this-run>" >&2
    exit 66
  fi
  control_sha="$candidate_head"
  control_trust="explicit-bootstrap"
fi

readonly temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/openmeld-trusted-final-candidate.XXXXXX")"
readonly control_root="$temporary_root/control"

cleanup() {
  if [ -d "$control_root" ]; then
    git -C "$candidate_root" worktree remove --force "$control_root" >/dev/null 2>&1 || true
  fi
  rm -rf "$temporary_root"
}
trap cleanup EXIT INT TERM

git -C "$candidate_root" worktree add --detach --quiet "$control_root" "$control_sha"
readonly bootstrap_path="$(cd "$control_root" && pwd -P)/$bootstrap_relative_path"
if [ ! -f "$bootstrap_path" ]; then
  echo "Selected Final Candidate control does not contain the bootstrap: $control_sha" >&2
  exit 66
fi

printf '%s\n' \
  "Trusted Final Candidate first hop" \
  "Candidate root: $candidate_root" \
  "Current main: $current_main" \
  "Candidate head: $candidate_head" \
  "Control source: $control_sha" \
  "Control trust: $control_trust" \
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
