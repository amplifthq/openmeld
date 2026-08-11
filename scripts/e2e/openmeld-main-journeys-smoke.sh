#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
GATEWAY_URL="${1:-http://127.0.0.1:8080}"
RUN_ID="$(date +%s)"
SESSION_ID="journey-${RUN_ID}"
OPENMELD_DEV=(node "$ROOT_DIR/clients/openmeld-cli/dist/openmeld-dev.js")

HUMAN_NAME="journey-human-${RUN_ID}"
AGENT_ALPHA_NAME="journey-agent-alpha-${RUN_ID}"
AGENT_BETA_NAME="journey-agent-beta-${RUN_ID}"
AGENT_BETA_DUP_NAME="${AGENT_BETA_NAME}"

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

read_json_line_field() {
  local path="$1"

  node -e '
    const [path] = process.argv.slice(1);
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
  ' "$path"
}

read_human_profile_id_from_text() {
  node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => {
      const match = raw.match(/Profile ID:\s*([A-Za-z0-9_-]+)/i);
      if (!match || !match[1]) {
        process.exit(1);
      }
      process.stdout.write(match[1]);
    });
  '
}

read_space_id_from_text() {
  node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => {
      const match = raw.match(/\b[0-9a-f]{64}\b/i);
      if (!match || !match[0]) {
        process.exit(1);
      }
      process.stdout.write(match[0]);
    });
  '
}

run_openmeld() {
  local view="$1"
  shift
  OPENMELD_CLI_CONTEXT_ID="$SESSION_ID" \
  OPENMELD_GATEWAY_URL="$GATEWAY_URL" \
  "${OPENMELD_DEV[@]}" --view "$view" "$@"
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

assert_history_has_message() {
  local history_output="$1"
  local expected_text="$2"
  local expected_profile_id="$3"
  local label="$4"

  printf "%s\n" "$history_output" | node -e '
    const [expectedText, expectedProfileId, label] = process.argv.slice(1);
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
        const payload =
          parsed.code === "tail.signal" ? (parsed.payload ?? {}) : parsed;
        const text = payload?.data?.text;
        const profileId = payload?.profile?.profileId;
        if (text === expectedText && profileId === expectedProfileId) {
          process.exit(0);
        }
      }
      console.error(`missing expected signal for ${label}`);
      process.exit(1);
    });
  ' "$expected_text" "$expected_profile_id" "$label"
}

assert_history_contains_text() {
  local history_output="$1"
  local expected_substring="$2"
  local label="$3"

  printf "%s\n" "$history_output" | node -e '
    const [expectedSubstring, label] = process.argv.slice(1);
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
        const payload =
          parsed.code === "tail.signal" ? (parsed.payload ?? {}) : parsed;
        const text = String(payload?.data?.text ?? "");
        if (text.includes(expectedSubstring)) {
          process.exit(0);
        }
      }
      console.error(`missing expected substring for ${label}`);
      process.exit(1);
    });
  ' "$expected_substring" "$label"
}

assert_history_not_contains_text() {
  local history_output="$1"
  local unexpected_substring="$2"
  local label="$3"

  printf "%s\n" "$history_output" | node -e '
    const [unexpectedSubstring, label] = process.argv.slice(1);
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
        const payload =
          parsed.code === "tail.signal" ? (parsed.payload ?? {}) : parsed;
        const text = String(payload?.data?.text ?? "");
        if (text.includes(unexpectedSubstring)) {
          console.error(`unexpected substring found for ${label}`);
          process.exit(1);
        }
      }
      process.exit(0);
    });
  ' "$unexpected_substring" "$label"
}

echo "==> building CLI"
pnpm -C "$ROOT_DIR" exec turbo run build --filter=openmeld >/dev/null

create_profile() {
  local kind="$1"
  local name="$2"
  local view="agent"
  if [[ "$kind" == "human" ]]; then
    view="human"
  fi
  local output=""
  set +e
  output="$(run_openmeld "$view" profile create "$name" --kind "$kind" 2>&1)"
  local rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    echo "❌ failed to create profile (${kind}): ${name}"
    echo "$output"
    exit 1
  fi

  local profile_id
  if [[ "$view" == "human" ]]; then
    profile_id="$(printf "%s\n" "$output" | read_human_profile_id_from_text)"
  else
    profile_id="$(printf "%s\n" "$output" | read_ndjson_field "profile.created" "data.openMeldProfileId")"
  fi
  if [[ -z "$profile_id" ]]; then
    echo "❌ failed to parse profile id for ${name}"
    echo "$output"
    exit 1
  fi
  printf "%s" "$profile_id"
}

create_space() {
  local view="$1"
  local profile_id="$2"
  local space_name="$3"
  local output=""
  set +e
  output="$(run_openmeld "$view" space create --name "$space_name" --no-join --profile "$profile_id" 2>&1)"
  local rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    echo "❌ failed to create space (${space_name})"
    echo "$output"
    exit 1
  fi

  local space_id
  if [[ "$view" == "human" ]]; then
    space_id="$(printf "%s\n" "$output" | read_space_id_from_text)"
  else
    space_id="$(printf "%s\n" "$output" | read_ndjson_field "space.create.created" "data.spaceId")"
  fi
  if [[ -z "$space_id" ]]; then
    echo "❌ failed to parse space id (${space_name})"
    echo "$output"
    exit 1
  fi
  printf "%s" "$space_id"
}

send_message() {
  local view="$1"
  local profile_id="$2"
  local space_id="$3"
  local message="$4"

  local output=""
  set +e
  output="$(run_openmeld "$view" space send "$space_id" "$message" --profile "$profile_id" 2>&1)"
  local rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    echo "❌ failed to send message"
    echo "$output"
    exit 1
  fi

  local sender_profile_id
  if [[ "$view" == "human" ]]; then
    sender_profile_id="$(printf "%s\n" "$output" | read_json_line_field "profile.profileId")"
  else
    sender_profile_id="$(printf "%s\n" "$output" | read_ndjson_field "send.response" "payload.profile.profileId")"
  fi
  assert_eq "$sender_profile_id" "$profile_id" "send sender profile"
}

read_history() {
  local view="$1"
  local profile_id="$2"
  local space_id="$3"

  local output=""
  set +e
  output="$(run_openmeld "$view" space history "$space_id" --limit 120 --json --profile "$profile_id" 2>&1)"
  local rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    echo "❌ failed to read history"
    echo "$output"
    exit 1
  fi
  printf "%s" "$output"
}

echo "==> checking gateway reachability: ${GATEWAY_URL}"
if ! curl --silent --show-error --output /dev/null --max-time 3 "$GATEWAY_URL/"; then
  echo "❌ gateway is unreachable: ${GATEWAY_URL}"
  echo "start local gateway first (example: pnpm --dir services/gateway dev)"
  exit 1
fi

echo "==> validating auth session"
set +e
AUTH_STATUS_OUTPUT="$(run_openmeld agent auth status 2>&1)"
AUTH_STATUS_RC=$?
set -e
AUTH_STATE="$(printf "%s\n" "$AUTH_STATUS_OUTPUT" | read_ndjson_field "auth.status.session" "payload.state" || true)"
if [[ "$AUTH_STATUS_RC" -ne 0 || "$AUTH_STATE" != "valid" ]]; then
  echo "❌ signed-in auth session required for journey smoke"
  echo "install shortcut if missing: pnpm openmeld:dev:install"
  echo "run: openmeld-dev login"
  echo "details: ${AUTH_STATUS_OUTPUT}"
  exit 1
fi

echo "==> creating test profiles"
HUMAN_PROFILE_ID="$(create_profile human "$HUMAN_NAME")"
AGENT_ALPHA_PROFILE_ID="$(create_profile agent "$AGENT_ALPHA_NAME")"
AGENT_BETA_PROFILE_ID="$(create_profile agent "$AGENT_BETA_NAME")"
AGENT_BETA_DUP_PROFILE_ID="$(create_profile agent "$AGENT_BETA_DUP_NAME")"

echo "==> creating journey spaces"
HUMAN_SPACE_ID="$(create_space human "$HUMAN_PROFILE_ID" "journey-human-space-${RUN_ID}")"
AGENT_SPACE_ID="$(create_space agent "$AGENT_ALPHA_PROFILE_ID" "journey-agent-space-${RUN_ID}")"

echo "==> Journey 1: human controls agent (command/system/failure)"
J1_MESSAGE="journey1 ${RUN_ID} @${AGENT_ALPHA_NAME} please ack"
send_message human "$HUMAN_PROFILE_ID" "$HUMAN_SPACE_ID" "$J1_MESSAGE"
J1_HISTORY="$(read_history human "$HUMAN_PROFILE_ID" "$HUMAN_SPACE_ID")"
assert_history_has_message "$J1_HISTORY" "$J1_MESSAGE" "$HUMAN_PROFILE_ID" "journey1 command path"

J1_FAILURE_MESSAGE="journey1-failure ${RUN_ID} @missing_target_${RUN_ID} ping"
send_message human "$HUMAN_PROFILE_ID" "$HUMAN_SPACE_ID" "$J1_FAILURE_MESSAGE"
J1_FAILURE_HISTORY="$(read_history human "$HUMAN_PROFILE_ID" "$HUMAN_SPACE_ID")"
assert_history_not_contains_text "$J1_FAILURE_HISTORY" "Mention skipped for \"missing_target_" "journey1 failure path"

echo "==> Journey 2: agent controls agent (command/system/failure)"
J2_MESSAGE="journey2 ${RUN_ID} @${AGENT_BETA_NAME} handoff"
send_message agent "$AGENT_ALPHA_PROFILE_ID" "$HUMAN_SPACE_ID" "$J2_MESSAGE"
J2_HISTORY="$(read_history agent "$AGENT_ALPHA_PROFILE_ID" "$HUMAN_SPACE_ID")"
assert_history_has_message "$J2_HISTORY" "$J2_MESSAGE" "$AGENT_ALPHA_PROFILE_ID" "journey2 command path"

J2_CONFLICT_WARMUP_ONE="journey2-warmup-one ${RUN_ID}"
J2_CONFLICT_WARMUP_TWO="journey2-warmup-two ${RUN_ID}"
send_message agent "$AGENT_BETA_PROFILE_ID" "$HUMAN_SPACE_ID" "$J2_CONFLICT_WARMUP_ONE"
send_message agent "$AGENT_BETA_DUP_PROFILE_ID" "$HUMAN_SPACE_ID" "$J2_CONFLICT_WARMUP_TWO"

J2_FAILURE_MESSAGE="journey2-failure ${RUN_ID} @${AGENT_BETA_NAME} please route"
send_message agent "$AGENT_ALPHA_PROFILE_ID" "$HUMAN_SPACE_ID" "$J2_FAILURE_MESSAGE"
J2_FAILURE_HISTORY="$(read_history agent "$AGENT_ALPHA_PROFILE_ID" "$HUMAN_SPACE_ID")"
assert_history_has_message "$J2_FAILURE_HISTORY" "$J2_FAILURE_MESSAGE" "$AGENT_ALPHA_PROFILE_ID" "journey2 failure path"
assert_history_not_contains_text "$J2_FAILURE_HISTORY" "matches multiple profiles" "journey2 failure legacy copy"

echo "==> Journey 3: human starts space, agents collaborate"
J3_MESSAGE_AGENT="journey3 ${RUN_ID} agent alpha online"
send_message agent "$AGENT_ALPHA_PROFILE_ID" "$HUMAN_SPACE_ID" "$J3_MESSAGE_AGENT"
J3_HISTORY="$(read_history human "$HUMAN_PROFILE_ID" "$HUMAN_SPACE_ID")"
assert_history_has_message "$J3_HISTORY" "$J3_MESSAGE_AGENT" "$AGENT_ALPHA_PROFILE_ID" "journey3 system path"

echo "==> Journey 4: agent starts space, human joins chain"
J4_MESSAGE_AGENT="journey4 ${RUN_ID} agent alpha created space"
send_message agent "$AGENT_ALPHA_PROFILE_ID" "$AGENT_SPACE_ID" "$J4_MESSAGE_AGENT"
J4_MESSAGE_HUMAN="journey4 ${RUN_ID} human acknowledged"
send_message human "$HUMAN_PROFILE_ID" "$AGENT_SPACE_ID" "$J4_MESSAGE_HUMAN"
J4_HISTORY="$(read_history human "$HUMAN_PROFILE_ID" "$AGENT_SPACE_ID")"
assert_history_has_message "$J4_HISTORY" "$J4_MESSAGE_AGENT" "$AGENT_ALPHA_PROFILE_ID" "journey4 agent path"
assert_history_has_message "$J4_HISTORY" "$J4_MESSAGE_HUMAN" "$HUMAN_PROFILE_ID" "journey4 human path"

echo "✅ main journeys smoke passed"
echo "gateway_url=${GATEWAY_URL}"
echo "human_profile_id=${HUMAN_PROFILE_ID}"
echo "agent_alpha_profile_id=${AGENT_ALPHA_PROFILE_ID}"
echo "agent_beta_profile_id=${AGENT_BETA_PROFILE_ID}"
echo "agent_beta_dup_profile_id=${AGENT_BETA_DUP_PROFILE_ID}"
echo "human_space_id=${HUMAN_SPACE_ID}"
echo "agent_space_id=${AGENT_SPACE_ID}"
