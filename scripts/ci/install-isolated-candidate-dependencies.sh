#!/usr/bin/env bash

set -euo pipefail

: "${OPENMELD_CANDIDATE_HOME:?Missing isolated candidate home.}"
: "${OPENMELD_CANDIDATE_ROOT:?Missing isolated candidate root.}"
: "${OPENMELD_TRUSTED_CONTROL_ROOT:?Missing trusted control root.}"

readonly command_wrapper="$OPENMELD_TRUSTED_CONTROL_ROOT/scripts/ci/run-isolated-candidate-command.sh"
readonly approved_builds_script="$OPENMELD_TRUSTED_CONTROL_ROOT/scripts/ci/resolve-approved-native-builds.mjs"
readonly runner_pnpm_command="$(command -v pnpm)"
readonly runner_pnpm_executable="$(realpath "$runner_pnpm_command")"
if ! expected_pnpm_version="$(
  node -e '
    const manifest = require(process.argv[1]);
    const match = /^pnpm@(.+)$/.exec(String(manifest.packageManager ?? ""));
    if (!match) process.exit(1);
    process.stdout.write(match[1]);
  ' "$OPENMELD_TRUSTED_CONTROL_ROOT/package.json"
)"; then
  echo "Trusted control does not declare an exact pnpm packageManager version." >&2
  exit 65
fi
readonly expected_pnpm_version
readonly actual_pnpm_version="$("$runner_pnpm_command" --version)"
if [ "$actual_pnpm_version" != "$expected_pnpm_version" ]; then
  echo "Trusted pnpm version mismatch: expected $expected_pnpm_version, got $actual_pnpm_version." >&2
  exit 66
fi

pnpm_package_root=""
if [ -n "${PNPM_HOME:-}" ]; then
  case "$PNPM_HOME" in
    /*)
      readonly canonical_pnpm_home="$(realpath "$PNPM_HOME")"
      case "$runner_pnpm_command" in
        "$canonical_pnpm_home"/*)
          pnpm_setup_root="$(dirname "$(dirname "$canonical_pnpm_home")")"
          if [ -f "$pnpm_setup_root/package.json" ] &&
            node -e '
              const manifest = require(process.argv[1]);
              if (manifest.private !== true || Object.hasOwn(manifest, "name")) {
                process.exit(1);
              }
            ' "$pnpm_setup_root/package.json"; then
            case "$runner_pnpm_executable" in
              "$pnpm_setup_root"/*) pnpm_package_root="$pnpm_setup_root" ;;
            esac
          fi
          ;;
      esac
      ;;
  esac
fi

if [ -z "$pnpm_package_root" ]; then
  pnpm_package_root="$(dirname "$runner_pnpm_executable")"
  pnpm_package_name=""
  while [ "$pnpm_package_root" != "/" ]; do
    if [ -f "$pnpm_package_root/package.json" ]; then
      pnpm_package_name="$(
        node -e '
          const manifest = require(process.argv[1]);
          process.stdout.write(String(manifest.name ?? ""));
        ' "$pnpm_package_root/package.json"
      )"
      case "$pnpm_package_name" in
        corepack | pnpm) break ;;
      esac
    fi
    pnpm_package_root="$(dirname "$pnpm_package_root")"
  done
  case "$pnpm_package_name" in
    corepack | pnpm) ;;
    *)
      echo "Trusted pnpm executable did not resolve to the GitHub setup-pnpm layout, pnpm, or Corepack." >&2
      exit 67
      ;;
  esac
fi

case "$pnpm_package_root" in
  "$OPENMELD_CANDIDATE_ROOT" | "$OPENMELD_CANDIDATE_ROOT"/*)
    echo "Trusted pnpm package root must not come from the candidate checkout." >&2
    exit 68
    ;;
esac
readonly trusted_pnpm_root="$(
  mktemp -d "$OPENMELD_TRUSTED_CONTROL_ROOT/.openmeld-pnpm.XXXXXX"
)"
cleanup() {
  rm -rf "$trusted_pnpm_root"
}
trap cleanup EXIT INT TERM
cp -R "$pnpm_package_root/." "$trusted_pnpm_root/"
chmod -R a+rX,go-w "$trusted_pnpm_root"
readonly pnpm_relative_path="${runner_pnpm_executable#"$pnpm_package_root/"}"
readonly pnpm_executable="$(realpath "$trusted_pnpm_root/$pnpm_relative_path")"
case "$pnpm_executable" in
  "$trusted_pnpm_root"/*) ;;
  *)
    echo "Trusted pnpm executable escaped its staged package root." >&2
    exit 69
    ;;
esac

"$command_wrapper" \
  "$pnpm_executable" \
  --config.cache-dir="$OPENMELD_CANDIDATE_HOME/pnpm-cache" \
  --config.global-dir="$OPENMELD_CANDIDATE_HOME/pnpm-global" \
  --config.modules-dir=node_modules \
  --config.state-dir="$OPENMELD_CANDIDATE_HOME/pnpm-state" \
  --config.store-dir="$OPENMELD_CANDIDATE_HOME/pnpm-store" \
  --config.virtual-store-dir=node_modules/.pnpm \
  --dir "$OPENMELD_CANDIDATE_ROOT" install \
  --frozen-lockfile \
  --ignore-scripts

mapfile -t approved_native_builds < <(
  node "$approved_builds_script" "$OPENMELD_TRUSTED_CONTROL_ROOT/pnpm-workspace.yaml"
)
approved_build_flags=()
for package_name in "${approved_native_builds[@]}"; do
  approved_build_flags+=(--config.only-built-dependencies="$package_name")
done
printf 'Rebuilding trusted allowBuilds dependencies only: %s\n' "${approved_native_builds[*]}"
"$command_wrapper" \
  "$pnpm_executable" \
  "${approved_build_flags[@]}" \
  --config.cache-dir="$OPENMELD_CANDIDATE_HOME/pnpm-cache" \
  --config.global-dir="$OPENMELD_CANDIDATE_HOME/pnpm-global" \
  --config.modules-dir=node_modules \
  --config.state-dir="$OPENMELD_CANDIDATE_HOME/pnpm-state" \
  --config.store-dir="$OPENMELD_CANDIDATE_HOME/pnpm-store" \
  --config.virtual-store-dir=node_modules/.pnpm \
  --dir "$OPENMELD_CANDIDATE_ROOT" rebuild \
  "${approved_native_builds[@]}"
