#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
GATEWAY_URL="${1:-http://127.0.0.1:8080}"
SESSION_ID="e2e-openmeld-$(date +%s)"
RUN_ID="$(date +%s)"
PROFILE_NAME="e2e-agent-${RUN_ID}"
SPACE_NAME="e2e-${RUN_ID}"
MESSAGE="e2e hello ${RUN_ID}"

OPENMELD_DEV=(node "$ROOT_DIR/clients/openmeld-cli/dist/openmeld-dev.js")

run_openmeld() {
  OPENMELD_CLI_CONTEXT_ID="$SESSION_ID" \
  OPENMELD_GATEWAY_URL="$GATEWAY_URL" \
  "${OPENMELD_DEV[@]}" --view agent "$@"
}

read_ndjson_field() {
  local code="$1"
  local path="$2"

  node -e '
    const [code, path] = process.argv.slice(1);
    const keys = path.split(".").filter(Boolean);
    let raw = "";
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => {
      const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (code && parsed.code !== code) {
          continue;
        }
        let cursor = parsed;
        for (const key of keys) {
          if (cursor === null || cursor === undefined) {
            cursor = undefined;
            break;
          }
          cursor = cursor[key];
        }
        if (cursor !== undefined && cursor !== null) {
          process.stdout.write(String(cursor));
          return;
        }
      }
      process.exit(1);
    });
  ' "$code" "$path"
}

assert_eq() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "❌ ${label}: expected '${expected}', got '${actual}'"
    exit 1
  fi
}

echo "==> building CLI"
pnpm -C "$ROOT_DIR" exec turbo run build --filter=openmeld >/dev/null

echo "==> checking gateway reachability: ${GATEWAY_URL}"
if ! curl --silent --show-error --output /dev/null --max-time 3 "$GATEWAY_URL/"; then
  echo "❌ gateway is unreachable: ${GATEWAY_URL}"
  echo "start local gateway first (example: pnpm --dir services/gateway dev)"
  exit 1
fi

echo "==> validating auth session"
set +e
AUTH_STATUS_OUTPUT="$(run_openmeld auth status 2>&1)"
AUTH_STATUS_RC=$?
set -e
AUTH_STATE="$(printf "%s\n" "$AUTH_STATUS_OUTPUT" | read_ndjson_field "auth.status.session" "payload.state" || true)"
if [[ "$AUTH_STATUS_RC" -ne 0 || "$AUTH_STATE" != "valid" ]]; then
  echo "❌ signed-in auth session required for CLI smoke"
  echo "install shortcut if missing: pnpm openmeld:dev:install"
  echo "run: openmeld-dev login"
  echo "details: ${AUTH_STATUS_OUTPUT}"
  exit 1
fi

echo "==> creating OpenMeld agent profile: ${PROFILE_NAME}"
set +e
CREATE_PROFILE_OUTPUT="$(run_openmeld profiles create --name "$PROFILE_NAME" --kind agent 2>&1)"
CREATE_PROFILE_RC=$?
set -e
if [[ "$CREATE_PROFILE_RC" -ne 0 ]]; then
  echo "❌ failed to create OpenMeld profile"
  echo "$CREATE_PROFILE_OUTPUT"
  exit 1
fi
OPENMELD_PROFILE_ID="$(printf "%s\n" "$CREATE_PROFILE_OUTPUT" | read_ndjson_field "profile.created" "data.openMeldProfileId")"
if [[ -z "$OPENMELD_PROFILE_ID" ]]; then
  echo "❌ failed to parse created OpenMeld profile id"
  echo "$CREATE_PROFILE_OUTPUT"
  exit 1
fi

echo "==> selecting OpenMeld profile: ${OPENMELD_PROFILE_ID}"
set +e
SET_PROFILE_OUTPUT="$(run_openmeld profiles set "$OPENMELD_PROFILE_ID" 2>&1)"
SET_PROFILE_RC=$?
set -e
if [[ "$SET_PROFILE_RC" -ne 0 ]]; then
  echo "❌ failed to set OpenMeld profile"
  echo "$SET_PROFILE_OUTPUT"
  exit 1
fi
SELECTED_PROFILE_ID="$(printf "%s\n" "$SET_PROFILE_OUTPUT" | read_ndjson_field "profile.current_set" "data.profile")"
assert_eq "$SELECTED_PROFILE_ID" "$OPENMELD_PROFILE_ID" "profile selection"

echo "==> creating space via gateway: ${SPACE_NAME}"
set +e
CREATE_SPACE_OUTPUT="$(run_openmeld space create --name "$SPACE_NAME" --no-join 2>&1)"
CREATE_SPACE_RC=$?
set -e
if [[ "$CREATE_SPACE_RC" -ne 0 ]]; then
  echo "❌ failed to create space"
  echo "$CREATE_SPACE_OUTPUT"
  exit 1
fi
SPACE_ID="$(printf "%s\n" "$CREATE_SPACE_OUTPUT" | read_ndjson_field "space.create.created" "data.spaceId")"
if [[ -z "$SPACE_ID" ]]; then
  echo "❌ failed to parse space id"
  echo "$CREATE_SPACE_OUTPUT"
  exit 1
fi

echo "==> sending message"
set +e
SEND_OUTPUT="$(run_openmeld space send "$SPACE_ID" "$MESSAGE" 2>&1)"
SEND_RC=$?
set -e
if [[ "$SEND_RC" -ne 0 ]]; then
  echo "❌ failed to send message"
  echo "$SEND_OUTPUT"
  exit 1
fi
SEND_PROFILE_ID="$(printf "%s\n" "$SEND_OUTPUT" | read_ndjson_field "send.response" "payload.profile.profileId")"
assert_eq "$SEND_PROFILE_ID" "$OPENMELD_PROFILE_ID" "send uses selected OpenMeld profile"

echo "==> reading history"
set +e
HISTORY_OUTPUT="$(run_openmeld space history "$SPACE_ID" --limit 10 2>&1)"
HISTORY_RC=$?
set -e
if [[ "$HISTORY_RC" -ne 0 ]]; then
  echo "❌ failed to read history"
  echo "$HISTORY_OUTPUT"
  exit 1
fi
printf "%s\n" "$HISTORY_OUTPUT" | node -e '
  const expectedMessage = process.argv[1];
  const expectedProfileId = process.argv[2];
  let raw = "";
  process.stdin.on("data", (chunk) => {
    raw += chunk;
  });
  process.stdin.on("end", () => {
    const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    let found = false;
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.type !== "signal.text") continue;
      const text = entry?.data?.text;
      const profileId = entry?.profile?.profileId;
      if (text === expectedMessage && profileId === expectedProfileId) {
        found = true;
        break;
      }
    }
    if (!found) {
      console.error("history output did not include expected signal");
      process.exit(1);
    }
  });
' "$MESSAGE" "$OPENMELD_PROFILE_ID"

echo "✅ gateway cli smoke passed"
echo "gateway_url=${GATEWAY_URL} session_id=${SESSION_ID} openmeld_profile_id=${OPENMELD_PROFILE_ID} space_id=${SPACE_ID}"
