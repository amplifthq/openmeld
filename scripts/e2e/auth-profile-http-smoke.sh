#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:8788}"
RUN_ID="$(date +%s)"
PASSWORD="TestPass123!"
EMAIL_ONE="e2e-auth-${RUN_ID}-1@openmeld.invalid"
EMAIL_TWO="e2e-auth-${RUN_ID}-2@openmeld.invalid"
NAME_ONE="E2E User One"
NAME_TWO="E2E User Two"
TOKEN_ONE_OVERRIDE="${OPENMELD_E2E_VERIFIED_TOKEN_ONE:-}"
TOKEN_TWO_OVERRIDE="${OPENMELD_E2E_VERIFIED_TOKEN_TWO:-}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

function json_read() {
  local file="$1"
  local path="$2"

  node -e '
    const fs = require("node:fs");
    const [file, path] = process.argv.slice(1);
    const source = fs.readFileSync(file, "utf8");
    const data = source.trim() ? JSON.parse(source) : null;
    const target = path.split(".").filter(Boolean).reduce((acc, key) => {
      if (acc === null || acc === undefined) return undefined;
      return acc[key];
    }, data);
    process.stdout.write(
      target === undefined || target === null ? "" : String(target)
    );
  ' "$file" "$path"
}

function json_array_length() {
  local file="$1"
  local path="$2"

  node -e '
    const fs = require("node:fs");
    const [file, path] = process.argv.slice(1);
    const source = fs.readFileSync(file, "utf8");
    const data = source.trim() ? JSON.parse(source) : null;
    const target = path.split(".").filter(Boolean).reduce((acc, key) => {
      if (acc === null || acc === undefined) return undefined;
      return acc[key];
    }, data);
    process.stdout.write(Array.isArray(target) ? String(target.length) : "0");
  ' "$file" "$path"
}

function assert_eq() {
  local actual="$1"
  local expected="$2"
  local label="$3"

  if [[ "$actual" != "$expected" ]]; then
    echo "❌ ${label}: expected '${expected}', got '${actual}'"
    exit 1
  fi
}

function assert_ne() {
  local actual="$1"
  local unexpected="$2"
  local label="$3"

  if [[ "$actual" == "$unexpected" ]]; then
    echo "❌ ${label}: expected value different from '${unexpected}', got '${actual}'"
    exit 1
  fi
}

function assert_prefix() {
  local value="$1"
  local prefix="$2"
  local label="$3"

  if [[ "${value}" != "${prefix}"* ]]; then
    echo "❌ ${label}: expected prefix '${prefix}', got '${value}'"
    exit 1
  fi
}

function request_json() {
  local method="$1"
  local url="$2"
  local payload="${3:-}"
  local token="${4:-}"
  local output_file="$5"

  if [[ -n "${token}" && -n "${payload}" ]]; then
    curl --silent --show-error \
      -o "${output_file}" \
      -w "%{http_code}" \
      -X "${method}" \
      "${url}" \
      -H "authorization: Bearer ${token}" \
      -H "content-type: application/json" \
      -d "${payload}"
    return
  fi

  if [[ -n "${token}" ]]; then
    curl --silent --show-error \
      -o "${output_file}" \
      -w "%{http_code}" \
      -X "${method}" \
      "${url}" \
      -H "authorization: Bearer ${token}"
    return
  fi

  if [[ -n "${payload}" ]]; then
    curl --silent --show-error \
      -o "${output_file}" \
      -w "%{http_code}" \
      -X "${method}" \
      "${url}" \
      -H "content-type: application/json" \
      -d "${payload}"
    return
  fi

  curl --silent --show-error \
    -o "${output_file}" \
    -w "%{http_code}" \
    -X "${method}" \
    "${url}"
}

echo "==> auth profile http smoke @ ${BASE_URL}"

echo "==> I-001 unauthenticated profiles list should be 401"
STATUS="$(request_json GET "${BASE_URL}/v1/profiles" "" "" "${TMP_DIR}/unauth_profiles.json")"
assert_eq "${STATUS}" "401" "I-001 unauth list status"

echo "==> Sign up user one"
STATUS="$(request_json POST "${BASE_URL}/api/auth/sign-up/email" "{\"email\":\"${EMAIL_ONE}\",\"password\":\"${PASSWORD}\",\"name\":\"${NAME_ONE}\"}" "" "${TMP_DIR}/signup_one.json")"
assert_eq "${STATUS}" "200" "signup user one status"
TOKEN_ONE="$(json_read "${TMP_DIR}/signup_one.json" "token")"
USER_ONE_ID="$(json_read "${TMP_DIR}/signup_one.json" "user.id")"
if [[ -z "${USER_ONE_ID}" ]]; then
  echo "❌ signup user one missing user.id"
  cat "${TMP_DIR}/signup_one.json"
  exit 1
fi
if [[ -z "${TOKEN_ONE}" && -n "${TOKEN_ONE_OVERRIDE}" ]]; then
  TOKEN_ONE="${TOKEN_ONE_OVERRIDE}"
fi

echo "==> R-001 email sign-in should require verification"
STATUS="$(request_json POST "${BASE_URL}/api/auth/sign-in/email" "{\"email\":\"${EMAIL_ONE}\",\"password\":\"${PASSWORD}\",\"callbackURL\":\"${BASE_URL}/protected\"}" "" "${TMP_DIR}/signin_email_unverified.json")"
assert_eq "${STATUS}" "403" "R-001 sign-in email unverified status"
SIGNIN_EMAIL_UNVERIFIED_CODE="$(json_read "${TMP_DIR}/signin_email_unverified.json" "code")"
assert_eq "${SIGNIN_EMAIL_UNVERIFIED_CODE}" "EMAIL_NOT_VERIFIED" "R-001 sign-in email unverified code"

echo "==> R-001A send-verification-email endpoint should be healthy"
STATUS="$(request_json POST "${BASE_URL}/api/auth/send-verification-email" "{\"email\":\"${EMAIL_ONE}\",\"callbackURL\":\"${BASE_URL}/protected\"}" "" "${TMP_DIR}/send_verify_one.json")"
assert_eq "${STATUS}" "200" "R-001A send verification status"
SEND_VERIFY_STATUS="$(json_read "${TMP_DIR}/send_verify_one.json" "status")"
assert_eq "${SEND_VERIFY_STATUS}" "true" "R-001A send verification payload.status"

if [[ -z "${TOKEN_ONE}" ]]; then
  echo "⚠️  Email verification is required; sign-up no longer returns bearer token before verification."
  echo "⚠️  Skipping authenticated profile/device/ott checks."
  echo "ℹ️  To run full authenticated smoke, provide OPENMELD_E2E_VERIFIED_TOKEN_ONE (and optionally OPENMELD_E2E_VERIFIED_TOKEN_TWO)."
  echo "✅ auth email-verification smoke passed (unauth + verification path)"
  exit 0
fi

echo "==> R-001B get-session with bearer token"
STATUS="$(request_json GET "${BASE_URL}/api/auth/get-session" "" "${TOKEN_ONE}" "${TMP_DIR}/get_session_one.json")"
assert_eq "${STATUS}" "200" "R-001B get-session status"
SESSION_ONE_USER_ID="$(json_read "${TMP_DIR}/get_session_one.json" "user.id")"
assert_eq "${SESSION_ONE_USER_ID}" "${USER_ONE_ID}" "R-001B get-session user id"

echo "==> R-002 magic-link endpoint should be healthy"
STATUS="$(
  curl --silent --show-error \
    -o "${TMP_DIR}/magic_link_one.json" \
    -w "%{http_code}" \
    -X POST \
    "${BASE_URL}/api/auth/sign-in/magic-link" \
    -H "content-type: application/json" \
    -H "origin: ${BASE_URL}" \
    -d "{\"email\":\"${EMAIL_ONE}\",\"callbackURL\":\"${BASE_URL}/protected\"}"
)"
assert_eq "${STATUS}" "200" "R-002 magic-link status"
MAGIC_LINK_STATUS="$(json_read "${TMP_DIR}/magic_link_one.json" "status")"
assert_eq "${MAGIC_LINK_STATUS}" "true" "R-002 magic-link payload.status"

echo "==> R-003 device endpoints should be healthy"
STATUS="$(request_json POST "${BASE_URL}/api/auth/device/code" "{\"client_id\":\"openmeld-cli-dev\"}" "${TOKEN_ONE}" "${TMP_DIR}/device_code_one.json")"
assert_eq "${STATUS}" "200" "R-003 device code status"
DEVICE_CODE="$(json_read "${TMP_DIR}/device_code_one.json" "device_code")"
DEVICE_INTERVAL="$(json_read "${TMP_DIR}/device_code_one.json" "interval")"
if [[ -z "${DEVICE_CODE}" ]]; then
  echo "❌ R-003 device code missing device_code"
  cat "${TMP_DIR}/device_code_one.json"
  exit 1
fi
assert_eq "${DEVICE_INTERVAL}" "5" "R-003 device polling interval"
STATUS="$(request_json POST "${BASE_URL}/api/auth/device/token" "{\"grant_type\":\"urn:ietf:params:oauth:grant-type:device_code\",\"device_code\":\"${DEVICE_CODE}\",\"client_id\":\"openmeld-cli-dev\"}" "" "${TMP_DIR}/device_token_pending.json")"
assert_eq "${STATUS}" "400" "R-003 device token pending status"
PENDING_ERROR="$(json_read "${TMP_DIR}/device_token_pending.json" "error")"
assert_eq "${PENDING_ERROR}" "authorization_pending" "R-003 device token pending code"

echo "==> R-004 one-time-token endpoints should be healthy"
STATUS="$(request_json GET "${BASE_URL}/api/auth/one-time-token/generate" "" "${TOKEN_ONE}" "${TMP_DIR}/ott_generate_one.json")"
assert_eq "${STATUS}" "200" "R-004 ott generate status"
OTT_TOKEN="$(json_read "${TMP_DIR}/ott_generate_one.json" "token")"
if [[ -z "${OTT_TOKEN}" ]]; then
  echo "❌ R-004 ott generate missing token"
  cat "${TMP_DIR}/ott_generate_one.json"
  exit 1
fi
STATUS="$(request_json POST "${BASE_URL}/api/auth/one-time-token/verify" "{\"token\":\"${OTT_TOKEN}\"}" "" "${TMP_DIR}/ott_verify_one.json")"
assert_eq "${STATUS}" "200" "R-004 ott verify status"
OTT_VERIFY_USER_ID="$(json_read "${TMP_DIR}/ott_verify_one.json" "user.id")"
assert_eq "${OTT_VERIFY_USER_ID}" "${USER_ONE_ID}" "R-004 ott verify user id"
STATUS="$(request_json POST "${BASE_URL}/api/auth/one-time-token/verify" "{\"token\":\"${OTT_TOKEN}\"}" "" "${TMP_DIR}/ott_verify_replay.json")"
assert_eq "${STATUS}" "400" "R-004 ott replay verify status"
OTT_REPLAY_MESSAGE="$(json_read "${TMP_DIR}/ott_verify_replay.json" "message")"
assert_eq "${OTT_REPLAY_MESSAGE}" "Invalid token" "R-004 ott replay message"

echo "==> I-002 first profiles list should auto contain primary human profile"
STATUS="$(request_json GET "${BASE_URL}/v1/profiles" "" "${TOKEN_ONE}" "${TMP_DIR}/profiles_one_first.json")"
assert_eq "${STATUS}" "200" "I-002 profiles list status"
FIRST_LIST_COUNT="$(json_array_length "${TMP_DIR}/profiles_one_first.json" "profiles")"
assert_eq "${FIRST_LIST_COUNT}" "1" "I-002 profile count"
FIRST_PROFILE_ID="$(json_read "${TMP_DIR}/profiles_one_first.json" "profiles.0.openMeldProfileId")"
FIRST_PROFILE_KIND="$(json_read "${TMP_DIR}/profiles_one_first.json" "profiles.0.profileKind")"
FIRST_PROFILE_IS_DEFAULT="$(json_read "${TMP_DIR}/profiles_one_first.json" "profiles.0.isDefault")"
assert_ne "${FIRST_PROFILE_ID}" "${USER_ONE_ID}" "I-002 primary profile id should not equal auth user id"
assert_eq "${FIRST_PROFILE_KIND}" "human" "I-002 primary profile kind"
assert_eq "${FIRST_PROFILE_IS_DEFAULT}" "true" "I-002 primary profile isDefault"

echo "==> I-003 second profiles list remains idempotent"
STATUS="$(request_json GET "${BASE_URL}/v1/profiles" "" "${TOKEN_ONE}" "${TMP_DIR}/profiles_one_second.json")"
assert_eq "${STATUS}" "200" "I-003 profiles second status"
SECOND_LIST_COUNT="$(json_array_length "${TMP_DIR}/profiles_one_second.json" "profiles")"
assert_eq "${SECOND_LIST_COUNT}" "1" "I-003 profile count"

echo "==> I-004 create agent profile"
STATUS="$(request_json POST "${BASE_URL}/v1/profiles/agents" "{\"profileName\":\"E2E Agent One\"}" "${TOKEN_ONE}" "${TMP_DIR}/create_agent_one.json")"
assert_eq "${STATUS}" "201" "I-004 create agent status"
AGENT_PROFILE_ID="$(json_read "${TMP_DIR}/create_agent_one.json" "profile.openMeldProfileId")"
AGENT_OWNER_ID="$(json_read "${TMP_DIR}/create_agent_one.json" "profile.ownerUserId")"
AGENT_PROFILE_IS_DEFAULT="$(json_read "${TMP_DIR}/create_agent_one.json" "profile.isDefault")"
assert_prefix "${AGENT_PROFILE_ID}" "agt_" "I-004 agent profile id"
assert_eq "${AGENT_OWNER_ID}" "${USER_ONE_ID}" "I-004 agent owner id"
assert_eq "${AGENT_PROFILE_IS_DEFAULT}" "false" "I-004 agent profile isDefault"

echo "==> I-004a create agent with invalid controllerEnabled should fail-fast"
STATUS="$(request_json POST "${BASE_URL}/v1/profiles/agents" "{\"profileName\":\"E2E Agent Invalid ControllerEnabled\",\"agentControllerRef\":\"builtin:codex\",\"controllerEnabled\":\"true\"}" "${TOKEN_ONE}" "${TMP_DIR}/create_agent_invalid_controller_enabled.json")"
assert_eq "${STATUS}" "400" "I-004a invalid controllerEnabled create status"
CREATE_INVALID_CONTROLLER_ENABLED_CODE="$(json_read "${TMP_DIR}/create_agent_invalid_controller_enabled.json" "code")"
assert_eq "${CREATE_INVALID_CONTROLLER_ENABLED_CODE}" "profile.invalid_input" "I-004a invalid controllerEnabled create code"

echo "==> I-007 resolve owned explicit profile should pass"
STATUS="$(request_json POST "${BASE_URL}/v1/profiles/resolve" "{\"openMeldProfileId\":\"${AGENT_PROFILE_ID}\"}" "${TOKEN_ONE}" "${TMP_DIR}/resolve_owned_agent.json")"
assert_eq "${STATUS}" "200" "I-007 resolve owned status"
RESOLVED_OWNED_ID="$(json_read "${TMP_DIR}/resolve_owned_agent.json" "profile.openMeldProfileId")"
assert_eq "${RESOLVED_OWNED_ID}" "${AGENT_PROFILE_ID}" "I-007 resolved id"

echo "==> I-005 resolve missing profile should be 404"
STATUS="$(request_json POST "${BASE_URL}/v1/profiles/resolve" "{\"openMeldProfileId\":\"agt_missing_profile\"}" "${TOKEN_ONE}" "${TMP_DIR}/resolve_missing.json")"
assert_eq "${STATUS}" "404" "I-005 resolve missing status"

echo "==> Sign up user two"
STATUS="$(request_json POST "${BASE_URL}/api/auth/sign-up/email" "{\"email\":\"${EMAIL_TWO}\",\"password\":\"${PASSWORD}\",\"name\":\"${NAME_TWO}\"}" "" "${TMP_DIR}/signup_two.json")"
assert_eq "${STATUS}" "200" "signup user two status"
TOKEN_TWO="$(json_read "${TMP_DIR}/signup_two.json" "token")"
USER_TWO_ID="$(json_read "${TMP_DIR}/signup_two.json" "user.id")"
if [[ -z "${USER_TWO_ID}" ]]; then
  echo "❌ signup user two missing user.id"
  cat "${TMP_DIR}/signup_two.json"
  exit 1
fi
if [[ -z "${TOKEN_TWO}" && -n "${TOKEN_TWO_OVERRIDE}" ]]; then
  TOKEN_TWO="${TOKEN_TWO_OVERRIDE}"
fi
if [[ -z "${TOKEN_TWO}" ]]; then
  echo "⚠️  signup user two has no bearer token before email verification."
  echo "⚠️  Skipping cross-user authorization checks."
  echo "✅ auth profile smoke passed (single-user authenticated path + email verification checks)"
  exit 0
fi

echo "==> I-006 resolve unowned profile should be 404 (anti-enumeration)"
STATUS="$(request_json POST "${BASE_URL}/v1/profiles/resolve" "{\"openMeldProfileId\":\"${AGENT_PROFILE_ID}\"}" "${TOKEN_TWO}" "${TMP_DIR}/resolve_unowned.json")"
assert_eq "${STATUS}" "404" "I-006 resolve unowned status"

echo "==> resolve without explicit profile should return user two primary profile"
STATUS="$(request_json POST "${BASE_URL}/v1/profiles/resolve" "{}" "${TOKEN_TWO}" "${TMP_DIR}/resolve_default_two.json")"
assert_eq "${STATUS}" "200" "resolve default profile status"
DEFAULT_TWO_PROFILE_ID="$(json_read "${TMP_DIR}/resolve_default_two.json" "profile.openMeldProfileId")"
DEFAULT_TWO_PROFILE_IS_DEFAULT="$(json_read "${TMP_DIR}/resolve_default_two.json" "profile.isDefault")"
assert_ne "${DEFAULT_TWO_PROFILE_ID}" "${USER_TWO_ID}" "resolve default profile id should differ from auth user id"
assert_eq "${DEFAULT_TWO_PROFILE_IS_DEFAULT}" "true" "resolve default profile isDefault"

echo "==> I-008 update owned profile name should pass"
STATUS="$(request_json PATCH "${BASE_URL}/v1/profiles/${AGENT_PROFILE_ID}" "{\"profileName\":\"E2E Agent One Renamed\"}" "${TOKEN_ONE}" "${TMP_DIR}/update_owned.json")"
assert_eq "${STATUS}" "200" "I-008 update owned status"
UPDATED_PROFILE_NAME="$(json_read "${TMP_DIR}/update_owned.json" "profile.profileName")"
assert_eq "${UPDATED_PROFILE_NAME}" "E2E Agent One Renamed" "I-008 update owned profile name"

echo "==> I-008a update with invalid controllerEnabled should fail-fast"
STATUS="$(request_json PATCH "${BASE_URL}/v1/profiles/${AGENT_PROFILE_ID}" "{\"agentControllerRef\":\"builtin:codex\",\"controllerEnabled\":\"false\"}" "${TOKEN_ONE}" "${TMP_DIR}/update_invalid_controller_enabled.json")"
assert_eq "${STATUS}" "400" "I-008a invalid controllerEnabled update status"
UPDATE_INVALID_CONTROLLER_ENABLED_CODE="$(json_read "${TMP_DIR}/update_invalid_controller_enabled.json" "code")"
assert_eq "${UPDATE_INVALID_CONTROLLER_ENABLED_CODE}" "profile.invalid_input" "I-008a invalid controllerEnabled update code"

echo "==> I-009 update unowned profile should be 404"
STATUS="$(request_json PATCH "${BASE_URL}/v1/profiles/${AGENT_PROFILE_ID}" "{\"profileName\":\"Unauthorized Rename\"}" "${TOKEN_TWO}" "${TMP_DIR}/update_unowned.json")"
assert_eq "${STATUS}" "404" "I-009 update unowned status"

echo "==> I-010 delete unowned profile should be 404"
STATUS="$(request_json DELETE "${BASE_URL}/v1/profiles/${AGENT_PROFILE_ID}" "" "${TOKEN_TWO}" "${TMP_DIR}/delete_unowned.json")"
assert_eq "${STATUS}" "404" "I-010 delete unowned status"

echo "==> I-011 delete primary human profile should be 400"
STATUS="$(request_json DELETE "${BASE_URL}/v1/profiles/${FIRST_PROFILE_ID}" "" "${TOKEN_ONE}" "${TMP_DIR}/delete_primary_human.json")"
assert_eq "${STATUS}" "400" "I-011 delete primary human status"
DELETE_PRIMARY_CODE="$(json_read "${TMP_DIR}/delete_primary_human.json" "code")"
assert_eq "${DELETE_PRIMARY_CODE}" "profile.primary_human_delete_forbidden" "I-011 delete primary human code"

echo "==> I-012 delete owned agent profile should pass"
STATUS="$(request_json DELETE "${BASE_URL}/v1/profiles/${AGENT_PROFILE_ID}" "" "${TOKEN_ONE}" "${TMP_DIR}/delete_owned_agent.json")"
assert_eq "${STATUS}" "200" "I-012 delete owned status"
DELETED_PROFILE_ID="$(json_read "${TMP_DIR}/delete_owned_agent.json" "profile.openMeldProfileId")"
assert_eq "${DELETED_PROFILE_ID}" "${AGENT_PROFILE_ID}" "I-012 deleted profile id"

echo "==> I-013 resolve deleted profile should be 404"
STATUS="$(request_json POST "${BASE_URL}/v1/profiles/resolve" "{\"openMeldProfileId\":\"${AGENT_PROFILE_ID}\"}" "${TOKEN_ONE}" "${TMP_DIR}/resolve_deleted.json")"
assert_eq "${STATUS}" "404" "I-013 resolve deleted profile status"

echo "✅ auth profile http smoke passed"
echo "base_url=${BASE_URL} user_one=${USER_ONE_ID} user_two=${USER_TWO_ID} agent=${AGENT_PROFILE_ID}"
