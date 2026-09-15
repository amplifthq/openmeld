#!/bin/sh
set -u

OPENMELD_TEST_COMMAND="${0##*/}"

append_call() {
  if [ -n "${OPENMELD_TEST_CALLS_PATH:-}" ]; then
    printf '%s\n' "$1" >> "$OPENMELD_TEST_CALLS_PATH"
  fi
}

json_string_or_null() {
  if [ -n "$1" ]; then
    printf '"%s"' "$1"
  else
    printf 'null'
  fi
}

run_fake_openmeld() {
  append_call "$*"

  if [ "$OPENMELD_TEST_COMMAND" = "npx" ] && [ "${OPENMELD_TEST_NPX_FAILURE_MODE:-}" = "local-proxy" ]; then
    # Zero-padded noise lines let tests assert the bootstrap replays only a
    # bounded tail of this output.
    for OPENMELD_TEST_PADDING_INDEX in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20; do
      printf 'npm verbose padding line %s\n' "$OPENMELD_TEST_PADDING_INDEX" >&2
    done
    printf 'npm error code EPERM\n' >&2
    printf 'npm error FetchError: request to https://registry.npmjs.org/openmeld failed, reason: connect EPERM 127.0.0.1:7890-Local (0.0.0.0:0)\n' >&2
    exit 1
  fi

  if [ "${1:-}" = "repair" ] && [ -n "${OPENMELD_TEST_REPAIR_EXIT:-}" ]; then
    exit "$OPENMELD_TEST_REPAIR_EXIT"
  fi

  OPENMELD_TEST_IS_SETUP=0
  for OPENMELD_TEST_ARG in "$@"; do
    if [ "$OPENMELD_TEST_ARG" = "setup" ]; then
      OPENMELD_TEST_IS_SETUP=1
    fi
  done

  if [ "$OPENMELD_TEST_IS_SETUP" = "1" ]; then
    if [ -n "${OPENMELD_TEST_SETUP_EXIT:-}" ]; then
      exit "$OPENMELD_TEST_SETUP_EXIT"
    fi
    OPENMELD_TEST_PREFIX="${OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND:-${OPENMELD_USER_FACING_CLI_COMMAND:-openmeld}}"
    OPENMELD_TEST_LANE="${OPENMELD_ENV_PRESET:-prod}"
    OPENMELD_TEST_LANE_ROOT="$(json_string_or_null "${OPENMELD_HOME:-}")"
    OPENMELD_TEST_AUTH_URL="$(json_string_or_null "${OPENMELD_AUTH_URL:-}")"
    OPENMELD_TEST_GATEWAY_URL="$(json_string_or_null "${OPENMELD_GATEWAY_URL:-}")"
    OPENMELD_TEST_FORCE_SERVICE_REFRESH="${OPENMELD_SETUP_FORCE_SERVICE_REFRESH:-}"
    printf '{"type":"result","code":"setup.complete","payload":{"lane":"%s","cliCommandPrefix":"%s","laneRoot":%s,"authBaseUrl":%s,"gatewayUrl":%s,"forceServiceRefresh":"%s","nextCommands":["%s whoami --view agent","%s service status --view agent"]}}\n' "$OPENMELD_TEST_LANE" "$OPENMELD_TEST_PREFIX" "$OPENMELD_TEST_LANE_ROOT" "$OPENMELD_TEST_AUTH_URL" "$OPENMELD_TEST_GATEWAY_URL" "$OPENMELD_TEST_FORCE_SERVICE_REFRESH" "$OPENMELD_TEST_PREFIX" "$OPENMELD_TEST_PREFIX"
  fi

  if [ -n "${OPENMELD_TEST_CHILD_STDIN_PATH:-}" ]; then
    cat >> "$OPENMELD_TEST_CHILD_STDIN_PATH"
  fi

  exit 0
}

run_fake_npm() {
  case "${1:-}" in
    root)
      if [ -n "${OPENMELD_TEST_NPM_ROOT:-}" ]; then
        printf '%s\n' "$OPENMELD_TEST_NPM_ROOT"
      fi
      ;;
    view)
      printf '%s\n' "${OPENMELD_TEST_NPM_VIEW_VERSION:-9.9.9}"
      ;;
    uninstall|install)
      case "${OPENMELD_TEST_NPM_MUTATION_MODE:-record}" in
        record)
          append_call "npm $*"
          if [ "${1:-}" = "install" ] && [ -n "${OPENMELD_TEST_NPM_ROOT:-}" ]; then
            OPENMELD_TEST_PACKAGE_SPEC="${3:-}"
            OPENMELD_TEST_INSTALLED_VERSION="${OPENMELD_TEST_PACKAGE_SPEC##*@}"
            if [ "$OPENMELD_TEST_INSTALLED_VERSION" = "latest" ]; then
              OPENMELD_TEST_INSTALLED_VERSION="${OPENMELD_TEST_NPM_VIEW_VERSION:-9.9.9}"
            fi
            mkdir -p "$OPENMELD_TEST_NPM_ROOT/openmeld"
            printf '{"version":"%s"}\n' "$OPENMELD_TEST_INSTALLED_VERSION" > "$OPENMELD_TEST_NPM_ROOT/openmeld/package.json"
          fi
          ;;
        reject)
          printf 'unexpected npm mutation: %s\n' "$*" >&2
          exit 10
          ;;
      esac
      ;;
  esac
  exit 0
}

run_fake_uname() {
  case "${1:-}" in
    -s)
      printf 'Darwin\n'
      ;;
    -m)
      printf 'arm64\n'
      ;;
    *)
      printf 'Darwin\n'
      ;;
  esac
  exit 0
}

run_fake_shasum() {
  OPENMELD_TEST_SHASUM_PATH="${3:-${2:-${1:-}}}"
  case "$OPENMELD_TEST_SHASUM_PATH" in
    */.openmeld/bin/openmeld)
      if [ "${OPENMELD_TEST_MANAGED_BINARY_SHA256_MISMATCH:-0}" = "1" ]; then
        printf 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  %s\n' "$OPENMELD_TEST_SHASUM_PATH"
        exit 0
      fi
      ;;
  esac
  printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  %s\n' "$OPENMELD_TEST_SHASUM_PATH"
  exit 0
}

write_fake_binary() {
  cat > "$1" <<'EOF'
#!/bin/sh
set -u

append_call() {
  if [ -n "${OPENMELD_TEST_CALLS_PATH:-}" ]; then
    printf '%s\n' "$1" >> "$OPENMELD_TEST_CALLS_PATH"
  fi
}

json_string_or_null() {
  if [ -n "$1" ]; then
    printf '"%s"' "$1"
  else
    printf 'null'
  fi
}

run_setup_complete() {
  OPENMELD_TEST_PREFIX="${OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND:-${OPENMELD_USER_FACING_CLI_COMMAND:-openmeld}}"
  OPENMELD_TEST_LANE="${OPENMELD_ENV_PRESET:-prod}"
  OPENMELD_TEST_LANE_ROOT="$(json_string_or_null "${OPENMELD_HOME:-}")"
  OPENMELD_TEST_AUTH_URL="$(json_string_or_null "${OPENMELD_AUTH_URL:-}")"
  OPENMELD_TEST_GATEWAY_URL="$(json_string_or_null "${OPENMELD_GATEWAY_URL:-}")"
  OPENMELD_TEST_FORCE_SERVICE_REFRESH="${OPENMELD_SETUP_FORCE_SERVICE_REFRESH:-}"
  printf '{"type":"result","code":"setup.complete","payload":{"lane":"%s","cliCommandPrefix":"%s","laneRoot":%s,"authBaseUrl":%s,"gatewayUrl":%s,"forceServiceRefresh":"%s","nextCommands":["%s whoami --view agent","%s service status --view agent"]}}\n' "$OPENMELD_TEST_LANE" "$OPENMELD_TEST_PREFIX" "$OPENMELD_TEST_LANE_ROOT" "$OPENMELD_TEST_AUTH_URL" "$OPENMELD_TEST_GATEWAY_URL" "$OPENMELD_TEST_FORCE_SERVICE_REFRESH" "$OPENMELD_TEST_PREFIX" "$OPENMELD_TEST_PREFIX"
}

if [ "${1:-}" = "install-self" ]; then
  append_call "$*"
  OPENMELD_TEST_ROOT="${OPENMELD_HOME:-$HOME/.openmeld}"
  mkdir -p "$OPENMELD_TEST_ROOT/bin"
  cp "$0" "$OPENMELD_TEST_ROOT/bin/openmeld"
  chmod +x "$OPENMELD_TEST_ROOT/bin/openmeld"
  exit 0
fi

append_call "$*"

OPENMELD_TEST_IS_SETUP=0
for OPENMELD_TEST_ARG in "$@"; do
  if [ "$OPENMELD_TEST_ARG" = "setup" ]; then
    OPENMELD_TEST_IS_SETUP=1
  fi
done

if [ "$OPENMELD_TEST_IS_SETUP" = "1" ]; then
  run_setup_complete
fi

exit 0
EOF
}

run_fake_curl() {
  OPENMELD_TEST_URL=""
  OPENMELD_TEST_OUTPUT=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -o)
        shift
        OPENMELD_TEST_OUTPUT="${1:-}"
        ;;
      http://*|https://*)
        OPENMELD_TEST_URL="$1"
        ;;
    esac
    shift || break
  done
  [ -n "$OPENMELD_TEST_OUTPUT" ] || exit 64

  if [ -n "${OPENMELD_TEST_CURL_CALLS_PATH:-}" ]; then
    printf '%s\n' "$OPENMELD_TEST_URL" >> "$OPENMELD_TEST_CURL_CALLS_PATH"
  fi

  if [ -n "${OPENMELD_TEST_CURL_FAIL_ONCE_SUFFIX:-}" ] && [ -n "${OPENMELD_TEST_CURL_FAIL_ONCE_MARKER_PATH:-}" ]; then
    case "$OPENMELD_TEST_URL" in
      *"$OPENMELD_TEST_CURL_FAIL_ONCE_SUFFIX")
        if [ ! -f "$OPENMELD_TEST_CURL_FAIL_ONCE_MARKER_PATH" ]; then
          printf 'partial download' > "$OPENMELD_TEST_OUTPUT"
          printf 'failed\n' > "$OPENMELD_TEST_CURL_FAIL_ONCE_MARKER_PATH"
          exit 18
        fi
        ;;
    esac
  fi

  case "$OPENMELD_TEST_URL" in
    */cli/manifest.json)
	  OPENMELD_TEST_RAW_BINARY="$OPENMELD_TEST_OUTPUT.raw"
	  OPENMELD_TEST_ARCHIVE="$OPENMELD_TEST_OUTPUT.gz"
	  write_fake_binary "$OPENMELD_TEST_RAW_BINARY"
	  gzip -n -c "$OPENMELD_TEST_RAW_BINARY" > "$OPENMELD_TEST_ARCHIVE"
	  OPENMELD_TEST_RAW_SIZE="$(wc -c < "$OPENMELD_TEST_RAW_BINARY" | tr -d '[:space:]')"
	  OPENMELD_TEST_ARCHIVE_SIZE="$(wc -c < "$OPENMELD_TEST_ARCHIVE" | tr -d '[:space:]')"
	  printf '{"schemaVersion":1,"channels":{"stable":{"version":"9.9.9","minRequiredCliVersion":"0.1.3","platforms":{"darwin-arm64":{"url":"https://openmeld.test/cli/download/openmeld-cli-darwin-arm64-9.9.9","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sizeBytes":%s,"archiveFormat":"gzip","archiveUrl":"https://openmeld.test/cli/download/openmeld-cli-darwin-arm64-9.9.9.gz","archiveSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","archiveSizeBytes":%s}}}}}\n' "$OPENMELD_TEST_RAW_SIZE" "$OPENMELD_TEST_ARCHIVE_SIZE" > "$OPENMELD_TEST_OUTPUT"
	  if [ "${OPENMELD_TEST_SEPARATE_SERVICE:-0}" = "1" ]; then
        node -e 'const fs=require("fs");const p=process.argv[1];const m=JSON.parse(fs.readFileSync(p));const c=m.channels.stable;const a=c.platforms["darwin-arm64"];c.service={version:"9.8.0",platforms:{"darwin-arm64":{...a,url:a.url.replace("9.9.9","9.8.0"),archiveUrl:a.archiveUrl.replace("9.9.9","9.8.0")}}};fs.writeFileSync(p,JSON.stringify(m));' "$OPENMELD_TEST_OUTPUT"
      fi
	  rm -f "$OPENMELD_TEST_RAW_BINARY" "$OPENMELD_TEST_ARCHIVE"
      ;;
	*/cli/download/*.gz)
	  OPENMELD_TEST_RAW_BINARY="$OPENMELD_TEST_OUTPUT.raw"
	  write_fake_binary "$OPENMELD_TEST_RAW_BINARY"
	  gzip -n -c "$OPENMELD_TEST_RAW_BINARY" > "$OPENMELD_TEST_OUTPUT"
	  rm -f "$OPENMELD_TEST_RAW_BINARY"
	  ;;
    */cli/download/*)
	  write_fake_binary "$OPENMELD_TEST_OUTPUT"
      ;;
    *)
      printf 'unexpected fake curl URL: %s\n' "$OPENMELD_TEST_URL" >&2
      exit 65
      ;;
  esac
  exit 0
}

case "$OPENMELD_TEST_COMMAND" in
  npx|openmeld-dev)
    run_fake_openmeld "$@"
    ;;
  npm)
    run_fake_npm "$@"
    ;;
  curl)
    run_fake_curl "$@"
    ;;
  shasum)
    run_fake_shasum "$@"
    ;;
  uname)
    run_fake_uname "$@"
    ;;
  openmeld)
    if [ "${1:-}" = "--version" ]; then
      if [ -n "${OPENMELD_TEST_OPENMELD_VERSION:-}" ]; then
        printf '%s\n' "$OPENMELD_TEST_OPENMELD_VERSION"
      elif [ -n "${OPENMELD_TEST_NPM_ROOT:-}" ] && [ -f "$OPENMELD_TEST_NPM_ROOT/openmeld/package.json" ]; then
        node -p "require(process.argv[1]).version" "$OPENMELD_TEST_NPM_ROOT/openmeld/package.json"
      fi
    fi
    exit 0
    ;;
  *)
    printf 'unexpected fake command: %s\n' "$OPENMELD_TEST_COMMAND" >&2
    exit 127
    ;;
esac
