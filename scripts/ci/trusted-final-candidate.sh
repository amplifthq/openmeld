#!/usr/bin/env bash

set -euo pipefail

readonly command="${1:-help}"
if [ "$#" -gt 0 ]; then
  shift
fi

trusted_git() {
  env \
    -u GIT_ALTERNATE_OBJECT_DIRECTORIES \
    -u GIT_ASKPASS \
    -u GIT_COMMON_DIR \
    -u GIT_CONFIG \
    -u GIT_CONFIG_COUNT \
    -u GIT_CONFIG_GLOBAL \
    -u GIT_CONFIG_NOSYSTEM \
    -u GIT_CONFIG_PARAMETERS \
    -u GIT_CURL_VERBOSE \
    -u GIT_DIR \
    -u GIT_EXEC_PATH \
    -u GIT_EXTERNAL_DIFF \
    -u GIT_GRAFT_FILE \
    -u GIT_INDEX_FILE \
    -u GIT_OBJECT_DIRECTORY \
    -u GIT_PREFIX \
    -u GIT_PROXY_COMMAND \
    -u GIT_PROXY_SSL_CAINFO \
    -u GIT_PROXY_SSL_CERT \
    -u GIT_PROXY_SSL_CERT_PASSWORD_PROTECTED \
    -u GIT_PROXY_SSL_KEY \
    -u GIT_SSH \
    -u GIT_SSH_COMMAND \
    -u GIT_SSH_VARIANT \
    -u GIT_SSL_CAINFO \
    -u GIT_SSL_CAPATH \
    -u GIT_SSL_CERT \
    -u GIT_SSL_CERT_PASSWORD_PROTECTED \
    -u GIT_SSL_CERT_TYPE \
    -u GIT_SSL_CIPHER_LIST \
    -u GIT_SSL_KEY \
    -u GIT_SSL_KEY_TYPE \
    -u GIT_SSL_NO_VERIFY \
    -u GIT_SSL_VERSION \
    -u GIT_TRACE \
    -u GIT_TRACE_CURL \
    -u GIT_TRACE_CURL_NO_DATA \
    -u GIT_TRACE_PACKET \
    -u GIT_TRACE_PERFORMANCE \
    -u GIT_TRACE_SETUP \
    -u GIT_TRACE_SHALLOW \
    -u GIT_TRACE2 \
    -u GIT_TRACE2_EVENT \
    -u GIT_TRACE2_PERF \
    -u GIT_WORK_TREE \
    -u GIT_HTTP_KEEPALIVE_COUNT \
    -u GIT_HTTP_KEEPALIVE_IDLE \
    -u GIT_HTTP_KEEPALIVE_INTERVAL \
    -u GIT_HTTP_LOW_SPEED_LIMIT \
    -u GIT_HTTP_LOW_SPEED_TIME \
    -u GIT_HTTP_MAX_REQUESTS \
    -u GIT_HTTP_PROXY_AUTHMETHOD \
    -u GIT_HTTP_USER_AGENT \
    -u ALL_PROXY \
    -u CURL_CA_BUNDLE \
    -u CURL_SSL_BACKEND \
    -u HTTP_PROXY \
    -u HTTPS_PROXY \
    -u NO_PROXY \
    -u SSH_ASKPASS \
    -u SSL_CERT_DIR \
    -u SSL_CERT_FILE \
    -u SSLKEYLOGFILE \
    -u all_proxy \
    -u http_proxy \
    -u https_proxy \
    -u no_proxy \
    GIT_TERMINAL_PROMPT=0 \
    GIT_TRACE_REDACT=1 \
    git \
    -c core.hooksPath=/dev/null \
    -c core.fsmonitor=false \
    -c http.proxy= \
    -c http.sslVerify=true \
    -c protocol.ext.allow=never \
    "$@"
}

readonly candidate_root="$(trusted_git rev-parse --show-toplevel)"
readonly temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/openmeld-trusted-final-candidate.XXXXXX")"
readonly network_root="$temporary_root/network.git"
readonly control_root="$temporary_root/control"

cleanup() {
  if [ -d "$control_root" ]; then
    trusted_git -C "$candidate_root" worktree remove --force "$control_root" >/dev/null 2>&1 || true
  fi
  rm -rf "$temporary_root"
}
trap cleanup EXIT INT TERM

readonly trusted_remote_url="$(trusted_git -C "$candidate_root" config --local --get remote.origin.url)"
case "$trusted_remote_url" in
  /* | file://*) ;;
  https://*)
    node -e '
      const url = new URL(process.argv[1]);
      if (url.protocol !== "https:" || url.username || url.password) {
        process.exit(1);
      }
    ' "$trusted_remote_url" || {
      echo "Final Candidate requires a clean HTTPS origin URL." >&2
      exit 66
    }
    ;;
  *)
    echo "Final Candidate requires an explicit clean HTTPS, absolute-path, or file origin URL." >&2
    exit 66
    ;;
esac
trusted_git init --bare --quiet "$network_root"
trusted_git --git-dir="$network_root" fetch --no-tags "$trusted_remote_url" \
  refs/heads/main:refs/heads/main
trusted_git -C "$candidate_root" fetch --no-tags "$network_root" \
  refs/heads/main:refs/remotes/origin/main
readonly current_main="$(trusted_git -C "$candidate_root" rev-parse --verify refs/remotes/origin/main^{commit})"
readonly candidate_head="$(trusted_git -C "$candidate_root" rev-parse --verify HEAD^{commit})"
readonly bootstrap_relative_path="scripts/ci/final-candidate-bootstrap.mjs"
control_sha="$current_main"
control_trust="current-main"

if ! trusted_git -C "$candidate_root" cat-file -e "$current_main:$bootstrap_relative_path" 2>/dev/null; then
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
    [ "$(trusted_git -C "$candidate_root" rev-parse --verify "$bootstrap_control_sha^{commit}" 2>/dev/null || true)" != "$candidate_head" ] ||
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

trusted_git -C "$candidate_root" worktree add --detach --quiet "$control_root" "$control_sha"
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
