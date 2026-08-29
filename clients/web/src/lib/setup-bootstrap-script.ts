import { getSetupFlowCopy } from "@openmeld/start";

const OPENMELD_SETUP_PACKAGE_NAME = "openmeld";
const OPENMELD_SETUP_PACKAGE_SPEC = `${OPENMELD_SETUP_PACKAGE_NAME}@latest`;
// Bounded replay size for captured npm probe output: enough to keep the
// trailing "npm error" block without flooding the terminal.
const OPENMELD_SETUP_PACKAGE_PROBE_TAIL_LINES = 15;
const OPENMELD_SETUP_PREPARE_COMMAND_HINT =
	"Use this setup script only with an OpenMeld Web setup command. It must include --start-session, either --device-code or --ott, and either --view human or --view agent.";
const OPENMELD_SETUP_PACKAGE_DOWNLOAD_NOTICE =
	"Downloading OpenMeld CLI (first run may take up to a minute)...";
const DEFAULT_MIN_NODE_MAJOR_VERSION = 20;
const DEFAULT_LOCAL_CLI_BINARY_MANIFEST_URL =
	"http://127.0.0.1:3197/cli/manifest.json";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const OPENMELD_STAGING_HOSTNAME = "staging.openmeld.ai";

export type OpenMeldSetupBootstrapLane = "prod" | "dev-local" | "canary";
type OpenMeldSetupBootstrapPlatform = "posix" | "windows";
type OpenMeldSetupDistribution = "npm" | "binary";

type OpenMeldSetupBootstrapScriptConfig = {
	openMeldHome?: string;
	authUrl?: string;
	binaryManifestUrl?: string;
	distribution?: OpenMeldSetupDistribution;
	gatewayUrl?: string;
	lane: OpenMeldSetupBootstrapLane;
	minNodeMajorVersion?: number;
};

type ResolveOpenMeldSetupBootstrapScriptConfigInput = {
	authUrl: string;
	binaryManifestUrl?: string;
	gatewayUrl: string;
	platform: OpenMeldSetupBootstrapPlatform;
	requestUrl: string;
	webAppUrl: string;
};

type ResolveOpenMeldSetupBootstrapScriptConfigResult =
	| {
			config: OpenMeldSetupBootstrapScriptConfig;
			status: "ok";
	  }
	| {
			body: string;
			status: "error";
			statusCode: number;
	  };

const LANE_CONFIG = {
	prod: {
		envPreset: "prod",
		userFacingCommand: "openmeld",
	},
	"dev-local": {
		envPreset: "dev-local",
		userFacingCommand: "openmeld-dev",
	},
	canary: {
		envPreset: "canary",
		userFacingCommand: "openmeld-canary",
	},
} as const satisfies Record<
	OpenMeldSetupBootstrapLane,
	{
		envPreset: string;
		userFacingCommand: string;
	}
>;

export function resolveOpenMeldSetupBootstrapScriptConfig(
	input: ResolveOpenMeldSetupBootstrapScriptConfigInput
): ResolveOpenMeldSetupBootstrapScriptConfigResult {
	const requestUrl = new URL(input.requestUrl);
	const requestedLane = requestUrl.searchParams.get("lane");
	const lane = normalizeOpenMeldSetupBootstrapLane(requestedLane);
	if (!lane) {
		return {
			body: "Unsupported OpenMeld setup lane.",
			status: "error",
			statusCode: 400,
		};
	}

	const localRequest = isLocalUrl(requestUrl) || isLocalUrl(input.webAppUrl);
	const stagingRequest = isOfficialStagingRequest(requestUrl, input.webAppUrl);
	if (
		lane !== "prod" &&
		!localRequest &&
		!(lane === "canary" && stagingRequest)
	) {
		return {
			body: "Non-production OpenMeld setup lanes are only available from localhost or OpenMeld staging.",
			status: "error",
			statusCode: 404,
		};
	}

	const openMeldHome = normalizeOptionalString(
		requestUrl.searchParams.get("openMeldHome")
	);
	if (openMeldHome && (lane === "prod" || !localRequest)) {
		return {
			body: "Custom OPENMELD_HOME is only available for local setup testing.",
			status: "error",
			statusCode: 400,
		};
	}

	const distribution = normalizeOpenMeldSetupDistribution(
		requestUrl.searchParams.get("dist"),
		lane
	);
	if (!distribution) {
		return {
			body: "Unsupported OpenMeld setup distribution.",
			status: "error",
			statusCode: 400,
		};
	}
	if (distribution === "binary" && input.platform === "windows") {
		return {
			body: "OpenMeld binary setup is not available for Windows yet. Use ?dist=npm.",
			status: "error",
			statusCode: 400,
		};
	}
	const binaryManifestUrlOverride = normalizeOptionalString(
		input.binaryManifestUrl
	);
	const binaryManifestUrl =
		(localRequest || stagingRequest) && binaryManifestUrlOverride
			? binaryManifestUrlOverride
			: buildSetupBinaryManifestUrl(requestUrl, { lane, localRequest });

	return {
		config: {
			...(openMeldHome ? { openMeldHome } : {}),
			binaryManifestUrl,
			distribution,
			...(lane === "prod"
				? {}
				: {
						authUrl: input.authUrl,
						gatewayUrl: input.gatewayUrl,
					}),
			lane,
		},
		status: "ok",
	};
}

export function buildOpenMeldSetupBootstrapScript(
	input: OpenMeldSetupBootstrapScriptConfig
): string {
	const laneConfig = LANE_CONFIG[input.lane];
	const setupCopy = getSetupFlowCopy("setup");
	const minNodeMajorVersion =
		input.minNodeMajorVersion ?? DEFAULT_MIN_NODE_MAJOR_VERSION;
	const distribution =
		input.distribution ?? resolveDefaultSetupDistribution(input.lane);
	const binaryManifestUrl =
		input.binaryManifestUrl ?? "https://openmeld.ai/cli/manifest.json";

	return `#!/bin/sh
set -u

OPENMELD_SETUP_PACKAGE_NAME=${shellSingleQuote(OPENMELD_SETUP_PACKAGE_NAME)}
OPENMELD_SETUP_PACKAGE_SPEC=${shellSingleQuote(OPENMELD_SETUP_PACKAGE_SPEC)}
OPENMELD_SETUP_MIN_NODE_MAJOR_VERSION=${shellSingleQuote(String(minNodeMajorVersion))}
OPENMELD_SETUP_ENV_PRESET=${shellSingleQuote(laneConfig.envPreset)}
OPENMELD_SETUP_USER_FACING_COMMAND=${shellSingleQuote(laneConfig.userFacingCommand)}
OPENMELD_SETUP_DISTRIBUTION=${shellSingleQuote(distribution)}
OPENMELD_SETUP_BINARY_MANIFEST_URL=${shellSingleQuote(binaryManifestUrl)}
OPENMELD_SETUP_GATEWAY_URL=${shellSingleQuote(input.gatewayUrl ?? "")}
OPENMELD_SETUP_AUTH_URL=${shellSingleQuote(input.authUrl ?? "")}
OPENMELD_SETUP_OPENMELD_HOME=${shellSingleQuote(input.openMeldHome ?? "")}
OPENMELD_SETUP_PREPARE_COMMAND_HINT=${shellSingleQuote(OPENMELD_SETUP_PREPARE_COMMAND_HINT)}
OPENMELD_SETUP_PACKAGE_DOWNLOAD_NOTICE=${shellSingleQuote(OPENMELD_SETUP_PACKAGE_DOWNLOAD_NOTICE)}
OPENMELD_SETUP_BINARY_COMMAND=""
OPENMELD_SETUP_BINARY_VERSION=""
OPENMELD_SETUP_BINARY_TMP=""
OPENMELD_SETUP_FORCE_SERVICE_REFRESH=0
OPENMELD_SETUP_GLOBAL_CLI_READY=0
OPENMELD_SETUP_GLOBAL_CLI_UPDATE_AFTER_SETUP=0
OPENMELD_SETUP_GLOBAL_CLI_UPDATE_VERSION=""
# Stdin source for a child OpenMeld invocation. Defaults to /dev/null so the
# piped install script (curl ... | sh) is never consumed by a child command.
# The interactive CLI run re-points this at /dev/tty when a terminal is
# available so setup can prompt (e.g. which local agent runs the Assistant),
# rustup-style, without ever inheriting the pipe as stdin.
OPENMELD_SETUP_RUN_STDIN=/dev/null
# Resolved once: /dev/tty when it is a readable terminal, otherwise /dev/null.
OPENMELD_SETUP_INTERACTIVE_STDIN=/dev/null

say() {
  printf '%s\\n' "$1"
}

resolve_interactive_stdin_source() {
  if { [ -t 1 ] && [ -r /dev/tty ]; } 2>/dev/null; then
    OPENMELD_SETUP_INTERACTIVE_STDIN=/dev/tty
  else
    OPENMELD_SETUP_INTERACTIVE_STDIN=/dev/null
  fi
}

die() {
  say "OpenMeld setup could not continue."
  say "$1"
  exit 1
}

confirm() {
  if ! { [ -t 2 ] && [ -r /dev/tty ] && [ -w /dev/tty ]; } 2>/dev/null; then
    return 2
  fi
  if ! printf '%s [Y/n] ' "$1" 2>/dev/null > /dev/tty; then
    return 2
  fi
  if ! read -r OPENMELD_SETUP_REPLY 2>/dev/null < /dev/tty; then
    OPENMELD_SETUP_REPLY="n"
  fi
  case "$OPENMELD_SETUP_REPLY" in
    ""|y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

validate_setup_args() {
  if [ "$#" -lt 1 ]; then
    die "$OPENMELD_SETUP_PREPARE_COMMAND_HINT"
  fi
  if [ "$1" != "setup" ]; then
    die "$OPENMELD_SETUP_PREPARE_COMMAND_HINT"
  fi

  OPENMELD_SETUP_HAS_START_SESSION=0
  OPENMELD_SETUP_HAS_OTT=0
  OPENMELD_SETUP_HAS_DEVICE_CODE=0
  for OPENMELD_SETUP_ARG in "$@"; do
    case "$OPENMELD_SETUP_ARG" in
      --start-session|--start-session=*) OPENMELD_SETUP_HAS_START_SESSION=1 ;;
      --ott|--ott=*) OPENMELD_SETUP_HAS_OTT=1 ;;
      --device-code|--device-code=*) OPENMELD_SETUP_HAS_DEVICE_CODE=1 ;;
    esac
  done

  if [ "$OPENMELD_SETUP_HAS_START_SESSION" -ne 1 ] || { [ "$OPENMELD_SETUP_HAS_DEVICE_CODE" -ne 1 ] && [ "$OPENMELD_SETUP_HAS_OTT" -ne 1 ]; }; then
    die "This setup script needs --start-session and either --device-code or --ott from OpenMeld Web. Copy the latest setup command from OpenMeld Web and run it again."
  fi
}

ensure_node_runtime() {
  if ! command_exists node; then
    say "OpenMeld setup needs Node.js ${minNodeMajorVersion} or newer."
    if command_exists brew && confirm "Install Node.js with Homebrew now?"; then
      brew install node < /dev/null || die "Homebrew could not install Node.js. Install Node.js ${minNodeMajorVersion} or newer, then run this setup command again."
    else
      die "Install Node.js ${minNodeMajorVersion} or newer, then run this setup command again."
    fi
  fi

  OPENMELD_SETUP_NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])" < /dev/null 2>/dev/null || printf '0')"
  case "$OPENMELD_SETUP_NODE_MAJOR" in
    ''|*[!0-9]*) OPENMELD_SETUP_NODE_MAJOR=0 ;;
  esac
  if [ "$OPENMELD_SETUP_NODE_MAJOR" -lt "$OPENMELD_SETUP_MIN_NODE_MAJOR_VERSION" ]; then
    say "OpenMeld setup found Node.js $(node --version < /dev/null 2>/dev/null || printf 'unknown')."
    if command_exists brew && confirm "Upgrade Node.js with Homebrew now?"; then
      brew upgrade node < /dev/null || brew install node < /dev/null || die "Homebrew could not upgrade Node.js. Install Node.js ${minNodeMajorVersion} or newer, then run this setup command again."
    else
      die "Upgrade Node.js to ${minNodeMajorVersion} or newer, then run this setup command again."
    fi
  fi

  command_exists npm || die "OpenMeld setup needs npm. Install Node.js ${minNodeMajorVersion} or newer from nodejs.org, then run this setup command again."
}

run_clean_openmeld_env() {
  if [ -n "$OPENMELD_SETUP_OPENMELD_HOME" ]; then
    env -u OPENMELD_GATEWAY_URL -u OPENMELD_AUTH_URL -u OPENMELD_CLI_BINARY_MANIFEST_URL -u OPENMELD_USER_FACING_CLI_COMMAND -u OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND -u OPENMELD_SETUP_FORCE_SERVICE_REFRESH \\
      OPENMELD_HOME="$OPENMELD_SETUP_OPENMELD_HOME" \\
      OPENMELD_ENV_PRESET="$OPENMELD_SETUP_ENV_PRESET" \\
      OPENMELD_USER_FACING_CLI_COMMAND="$(resolve_follow_up_cli_command_prefix)" \\
      OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND="$(resolve_follow_up_cli_command_prefix)" \\
      OPENMELD_SETUP_FORCE_SERVICE_REFRESH="$OPENMELD_SETUP_FORCE_SERVICE_REFRESH" \\
      OPENMELD_GATEWAY_URL="$OPENMELD_SETUP_GATEWAY_URL" \\
      OPENMELD_AUTH_URL="$OPENMELD_SETUP_AUTH_URL" \\
      OPENMELD_CLI_BINARY_MANIFEST_URL="$OPENMELD_SETUP_BINARY_MANIFEST_URL" \\
      "$@" < "$OPENMELD_SETUP_RUN_STDIN"
    return $?
  fi

  if [ -n "$OPENMELD_SETUP_GATEWAY_URL" ] || [ -n "$OPENMELD_SETUP_AUTH_URL" ]; then
    env -u OPENMELD_HOME -u OPENMELD_GATEWAY_URL -u OPENMELD_AUTH_URL -u OPENMELD_CLI_BINARY_MANIFEST_URL -u OPENMELD_USER_FACING_CLI_COMMAND -u OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND -u OPENMELD_SETUP_FORCE_SERVICE_REFRESH \\
      OPENMELD_ENV_PRESET="$OPENMELD_SETUP_ENV_PRESET" \\
      OPENMELD_USER_FACING_CLI_COMMAND="$(resolve_follow_up_cli_command_prefix)" \\
      OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND="$(resolve_follow_up_cli_command_prefix)" \\
      OPENMELD_SETUP_FORCE_SERVICE_REFRESH="$OPENMELD_SETUP_FORCE_SERVICE_REFRESH" \\
      OPENMELD_GATEWAY_URL="$OPENMELD_SETUP_GATEWAY_URL" \\
      OPENMELD_AUTH_URL="$OPENMELD_SETUP_AUTH_URL" \\
      OPENMELD_CLI_BINARY_MANIFEST_URL="$OPENMELD_SETUP_BINARY_MANIFEST_URL" \\
      "$@" < "$OPENMELD_SETUP_RUN_STDIN"
    return $?
  fi

  env -u OPENMELD_HOME -u OPENMELD_GATEWAY_URL -u OPENMELD_AUTH_URL -u OPENMELD_CLI_BINARY_MANIFEST_URL -u OPENMELD_USER_FACING_CLI_COMMAND -u OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND -u OPENMELD_SETUP_FORCE_SERVICE_REFRESH \\
    OPENMELD_ENV_PRESET="$OPENMELD_SETUP_ENV_PRESET" \\
    OPENMELD_USER_FACING_CLI_COMMAND="$(resolve_follow_up_cli_command_prefix)" \\
    OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND="$(resolve_follow_up_cli_command_prefix)" \\
    OPENMELD_SETUP_FORCE_SERVICE_REFRESH="$OPENMELD_SETUP_FORCE_SERVICE_REFRESH" \\
    OPENMELD_CLI_BINARY_MANIFEST_URL="$OPENMELD_SETUP_BINARY_MANIFEST_URL" \\
    "$@" < "$OPENMELD_SETUP_RUN_STDIN"
}

# Run the interactive OpenMeld CLI with stdin attached to a real terminal when
# one is available (so setup can prompt), while every helper command keeps its
# default /dev/null stdin. The pipe carrying the install script is never
# inherited: OPENMELD_SETUP_RUN_STDIN is always an explicit file.
run_interactive_openmeld_cli() {
  OPENMELD_SETUP_RUN_STDIN="$OPENMELD_SETUP_INTERACTIVE_STDIN"
  run_clean_openmeld_env "$@"
  OPENMELD_SETUP_RUN_INTERACTIVE_STATUS=$?
  OPENMELD_SETUP_RUN_STDIN=/dev/null
  return "$OPENMELD_SETUP_RUN_INTERACTIVE_STATUS"
}

explain_package_acquisition_failure() {
  OPENMELD_SETUP_PACKAGE_OUTPUT="$1"
  if printf '%s\n' "$OPENMELD_SETUP_PACKAGE_OUTPUT" | grep -E '(connect (EPERM|ECONNREFUSED|ECONNRESET|ETIMEDOUT) (127\\.0\\.0\\.1|localhost)|reason: connect (EPERM|ECONNREFUSED|ECONNRESET|ETIMEDOUT) (127\\.0\\.0\\.1|localhost))' >/dev/null 2>&1; then
    say "OpenMeld could not download the latest CLI because npm is trying to use a local proxy that is not reachable."
    say "Next: start the local proxy app or turn off the npm proxy setting, then run this setup command again."
    say "Useful checks: npm config get proxy; npm config get https-proxy; env | grep -i proxy"
    return 0
  fi

  if printf '%s\n' "$OPENMELD_SETUP_PACKAGE_OUTPUT" | grep -E '(Log files were not written|EACCES|EPERM).*(\\.npm|npm)' >/dev/null 2>&1; then
    say "OpenMeld could not install the latest CLI because npm cannot write to its local cache or log directory."
    say "Next: check permissions for ~/.npm and ~/.npm/_logs, then run this setup command again."
    return 0
  fi

  if printf '%s\n' "$OPENMELD_SETUP_PACKAGE_OUTPUT" | grep -E "(registry\\.npmjs\\.org|$OPENMELD_SETUP_PACKAGE_NAME)" >/dev/null 2>&1; then
    say "OpenMeld could not download the latest CLI from npm."
    say "Next: fix the npm or network error shown above, then run this setup command again."
  fi
}

probe_package_acquisition_failure() {
  # The OpenMeld CLI just ran attached to the terminal (a pipe here would downgrade
  # its progress UI to static lines), so there is no transcript to grep.
  # Re-run package acquisition alone: npx resolves and caches the package
  # before starting the CLI, so this reproduces download failures without
  # re-running setup. A passing probe means the failure came from the CLI
  # itself and the npm diagnostics do not apply.
  if command_exists npx; then
    OPENMELD_SETUP_PACKAGE_PROBE_OUTPUT="$(run_clean_openmeld_env npx -y "$OPENMELD_SETUP_PACKAGE_SPEC" --version 2>&1)" && return 0
  else
    OPENMELD_SETUP_PACKAGE_PROBE_OUTPUT="$(run_clean_openmeld_env npm exec --yes --package "$OPENMELD_SETUP_PACKAGE_SPEC" -- openmeld --version 2>&1)" && return 0
  fi
  # The command substitutions above captured npm's output away from the
  # terminal; replay a bounded tail so the guidance below can point at it.
  if [ -n "$OPENMELD_SETUP_PACKAGE_PROBE_OUTPUT" ]; then
    say "OpenMeld re-ran the npm package download to diagnose the failure. npm reported:"
    printf '%s\\n' "$OPENMELD_SETUP_PACKAGE_PROBE_OUTPUT" | tail -n ${OPENMELD_SETUP_PACKAGE_PROBE_TAIL_LINES}
  fi
  explain_package_acquisition_failure "$OPENMELD_SETUP_PACKAGE_PROBE_OUTPUT"
}

run_package_command() {
  OPENMELD_SETUP_PACKAGE_OUTPUT_FILE="$(mktemp /tmp/openmeld-setup-package-output.XXXXXX 2>/dev/null || printf '/tmp/openmeld-setup-package-output.%s' "$$")"
  OPENMELD_SETUP_PACKAGE_STATUS_FILE="$OPENMELD_SETUP_PACKAGE_OUTPUT_FILE.status"
  rm -f "$OPENMELD_SETUP_PACKAGE_STATUS_FILE"
  (
    run_clean_openmeld_env "$@" 2>&1
    printf '%s\n' "$?" > "$OPENMELD_SETUP_PACKAGE_STATUS_FILE"
  ) | tee "$OPENMELD_SETUP_PACKAGE_OUTPUT_FILE"
  OPENMELD_SETUP_PACKAGE_STATUS="$(cat "$OPENMELD_SETUP_PACKAGE_STATUS_FILE" 2>/dev/null || printf '1')"
  case "$OPENMELD_SETUP_PACKAGE_STATUS" in
    ''|*[!0-9]*) OPENMELD_SETUP_PACKAGE_STATUS=1 ;;
  esac
  if [ "$OPENMELD_SETUP_PACKAGE_STATUS" -ne 0 ]; then
    OPENMELD_SETUP_PACKAGE_OUTPUT="$(cat "$OPENMELD_SETUP_PACKAGE_OUTPUT_FILE" 2>/dev/null || true)"
    explain_package_acquisition_failure "$OPENMELD_SETUP_PACKAGE_OUTPUT"
  fi
  rm -f "$OPENMELD_SETUP_PACKAGE_OUTPUT_FILE" "$OPENMELD_SETUP_PACKAGE_STATUS_FILE"
  return "$OPENMELD_SETUP_PACKAGE_STATUS"
}

run_latest_openmeld() {
  # Keep the CLI's stdout/stderr attached to the terminal so its setup
  # progress can render the TTY spinner; wrapping this in a pipe (tee) makes
  # the CLI fall back to static progress lines. Attach stdin to the terminal
  # when available so setup prompts (e.g. the Assistant's local-agent choice)
  # are reachable even under curl | sh.
  say "$OPENMELD_SETUP_PACKAGE_DOWNLOAD_NOTICE"
  if command_exists npx; then
    run_interactive_openmeld_cli npx -y "$OPENMELD_SETUP_PACKAGE_SPEC" "$@"
  else
    run_interactive_openmeld_cli npm exec --yes --package "$OPENMELD_SETUP_PACKAGE_SPEC" -- openmeld "$@"
  fi
  OPENMELD_SETUP_LATEST_OPENMELD_STATUS=$?
  if [ "$OPENMELD_SETUP_LATEST_OPENMELD_STATUS" -ne 0 ]; then
    probe_package_acquisition_failure
  fi
  return "$OPENMELD_SETUP_LATEST_OPENMELD_STATUS"
}

resolve_binary_platform() {
  OPENMELD_SETUP_UNAME_SYSTEM="$(uname -s 2>/dev/null || true)"
  OPENMELD_SETUP_UNAME_MACHINE="$(uname -m 2>/dev/null || true)"
  case "$OPENMELD_SETUP_UNAME_SYSTEM:$OPENMELD_SETUP_UNAME_MACHINE" in
    Darwin:arm64) printf 'darwin-arm64' ;;
    *) die "OpenMeld binary setup currently supports Apple silicon Macs. Use ?dist=npm for this computer." ;;
  esac
}

resolve_managed_binary_command_path() {
  if [ -n "$OPENMELD_SETUP_OPENMELD_HOME" ]; then
    printf '%s/bin/openmeld' "$OPENMELD_SETUP_OPENMELD_HOME"
    return
  fi
  case "$OPENMELD_SETUP_ENV_PRESET" in
    prod) printf '%s/.openmeld/bin/openmeld' "$HOME" ;;
    dev-local) printf '%s/.openmeld-dev/bin/openmeld' "$HOME" ;;
    canary) printf '%s/.openmeld-canary/bin/openmeld' "$HOME" ;;
    *) die "OpenMeld setup could not resolve the managed binary path for this lane." ;;
  esac
}

read_manifest_string_field() {
  sed -n "s/.*\\"$1\\"[[:space:]]*:[[:space:]]*\\"\\([^\\"]*\\)\\".*/\\1/p" "$2" | head -n 1
}

read_manifest_number_field() {
  sed -n "s/.*\\"$1\\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p" "$2" | head -n 1
}

format_binary_download_notice() {
  OPENMELD_SETUP_BINARY_DOWNLOAD_BYTES="$1"
  case "$OPENMELD_SETUP_BINARY_DOWNLOAD_BYTES" in
    ''|*[!0-9]*) say "Downloading OpenMeld..." ;;
    *)
      OPENMELD_SETUP_BINARY_DOWNLOAD_SIZE_MB="$(( (OPENMELD_SETUP_BINARY_DOWNLOAD_BYTES + 524288) / 1048576 ))"
      [ "$OPENMELD_SETUP_BINARY_DOWNLOAD_SIZE_MB" -gt 0 ] || OPENMELD_SETUP_BINARY_DOWNLOAD_SIZE_MB=1
      say "Downloading OpenMeld (about $OPENMELD_SETUP_BINARY_DOWNLOAD_SIZE_MB MB)..."
      ;;
  esac
}

download_file_with_retry() {
  OPENMELD_SETUP_DOWNLOAD_URL="$1"
  OPENMELD_SETUP_DOWNLOAD_OUTPUT="$2"
  OPENMELD_SETUP_DOWNLOAD_SHOW_PROGRESS="\${3:-1}"
  OPENMELD_SETUP_DOWNLOAD_ATTEMPT=1

  while [ "$OPENMELD_SETUP_DOWNLOAD_ATTEMPT" -le 3 ]; do
    rm -f "$OPENMELD_SETUP_DOWNLOAD_OUTPUT"
    if [ "$OPENMELD_SETUP_DOWNLOAD_SHOW_PROGRESS" = "1" ] && { [ -t 2 ]; } 2>/dev/null; then
      if curl -fL --progress-bar "$OPENMELD_SETUP_DOWNLOAD_URL" -o "$OPENMELD_SETUP_DOWNLOAD_OUTPUT"; then
        return 0
      fi
    elif curl -fsSL "$OPENMELD_SETUP_DOWNLOAD_URL" -o "$OPENMELD_SETUP_DOWNLOAD_OUTPUT"; then
      return 0
    fi

    if [ "$OPENMELD_SETUP_DOWNLOAD_ATTEMPT" -ge 3 ]; then
      return 1
    fi
    say "Download didn't finish. Retrying..."
    sleep "$OPENMELD_SETUP_DOWNLOAD_ATTEMPT"
    OPENMELD_SETUP_DOWNLOAD_ATTEMPT="$((OPENMELD_SETUP_DOWNLOAD_ATTEMPT + 1))"
  done

  return 1
}

cleanup_binary_download() {
  if [ -n "\${OPENMELD_SETUP_BINARY_TMP:-}" ]; then
    rm -rf "$OPENMELD_SETUP_BINARY_TMP"
    OPENMELD_SETUP_BINARY_TMP=""
  fi
}

install_downloaded_binary_self() {
  if [ "$OPENMELD_SETUP_ENV_PRESET" = "dev-local" ]; then
    run_clean_openmeld_env "$OPENMELD_SETUP_BINARY_PATH" install-self --force >/dev/null || die "OpenMeld could not install the CLI binary."
    OPENMELD_SETUP_FORCE_SERVICE_REFRESH=1
    return
  fi
  run_clean_openmeld_env "$OPENMELD_SETUP_BINARY_PATH" install-self >/dev/null || die "OpenMeld could not install the CLI binary."
  OPENMELD_SETUP_FORCE_SERVICE_REFRESH=1
}

verify_binary_code_signature() {
  OPENMELD_SETUP_SIGNATURE_PATH="$1"
  if [ -z "$OPENMELD_SETUP_BINARY_CODE_IDENTIFIER$OPENMELD_SETUP_BINARY_TEAM_IDENTIFIER" ]; then
    return 0
  fi
  [ -x /usr/bin/codesign ] || die "OpenMeld needs macOS codesign to verify the downloaded CLI."
  /usr/bin/codesign --verify --strict --verbose=2 "$OPENMELD_SETUP_SIGNATURE_PATH" >/dev/null 2>&1 || die "OpenMeld CLI did not pass Apple code signature verification."
  OPENMELD_SETUP_SIGNATURE_DETAILS="$(/usr/bin/codesign --display --verbose=4 "$OPENMELD_SETUP_SIGNATURE_PATH" 2>&1)" || die "OpenMeld could not inspect the CLI code signature."
  printf '%s\n' "$OPENMELD_SETUP_SIGNATURE_DETAILS" | grep -F "Identifier=$OPENMELD_SETUP_BINARY_CODE_IDENTIFIER" >/dev/null || die "OpenMeld CLI code signature has the wrong identifier."
  printf '%s\n' "$OPENMELD_SETUP_SIGNATURE_DETAILS" | grep -F "TeamIdentifier=$OPENMELD_SETUP_BINARY_TEAM_IDENTIFIER" >/dev/null || die "OpenMeld CLI code signature has the wrong Apple team."
  printf '%s\n' "$OPENMELD_SETUP_SIGNATURE_DETAILS" | grep -F "Authority=Developer ID Application:" >/dev/null || die "OpenMeld CLI is not signed with an Apple Developer ID Application certificate."
  printf '%s\n' "$OPENMELD_SETUP_SIGNATURE_DETAILS" | grep -E 'flags=.*runtime' >/dev/null || die "OpenMeld CLI code signature is missing the hardened runtime."
  printf '%s\n' "$OPENMELD_SETUP_SIGNATURE_DETAILS" | grep -E '^Timestamp=' >/dev/null || die "OpenMeld CLI code signature is missing a trusted timestamp."
}

reuse_matching_managed_binary() {
  OPENMELD_SETUP_MANAGED_BINARY_PATH="$(resolve_managed_binary_command_path)"
  [ -x "$OPENMELD_SETUP_MANAGED_BINARY_PATH" ] || return 1
  OPENMELD_SETUP_MANAGED_BINARY_SIZE_BYTES="$(wc -c < "$OPENMELD_SETUP_MANAGED_BINARY_PATH" | tr -d '[:space:]')"
  [ "$OPENMELD_SETUP_MANAGED_BINARY_SIZE_BYTES" = "$OPENMELD_SETUP_BINARY_SIZE_BYTES" ] || return 1
  OPENMELD_SETUP_MANAGED_BINARY_SHA256="$(shasum -a 256 "$OPENMELD_SETUP_MANAGED_BINARY_PATH" | awk '{print $1}')"
  [ "$OPENMELD_SETUP_MANAGED_BINARY_SHA256" = "$OPENMELD_SETUP_BINARY_SHA256" ] || return 1
  verify_binary_code_signature "$OPENMELD_SETUP_MANAGED_BINARY_PATH"

  OPENMELD_SETUP_BINARY_COMMAND="$OPENMELD_SETUP_MANAGED_BINARY_PATH"
  maybe_update_old_global_openmeld_cli_for_binary_setup
  cleanup_binary_download
  return 0
}

install_binary_openmeld() {
  [ -n "$OPENMELD_SETUP_BINARY_MANIFEST_URL" ] || die "OpenMeld CLI binary manifest URL is missing."
  command_exists curl || die "OpenMeld binary setup needs curl."
  command_exists shasum || die "OpenMeld binary setup needs shasum."

  OPENMELD_SETUP_BINARY_PLATFORM="$(resolve_binary_platform)"
  OPENMELD_SETUP_BINARY_TMP="$(mktemp -d "\${TMPDIR:-/tmp}/openmeld-cli-binary.XXXXXX" 2>/dev/null || true)"
  [ -n "$OPENMELD_SETUP_BINARY_TMP" ] || die "OpenMeld could not create a temporary directory for the CLI binary."
  trap cleanup_binary_download EXIT
  OPENMELD_SETUP_BINARY_MANIFEST_PATH="$OPENMELD_SETUP_BINARY_TMP/manifest.json"
  OPENMELD_SETUP_BINARY_PATH="$OPENMELD_SETUP_BINARY_TMP/openmeld"
  OPENMELD_SETUP_BINARY_ARCHIVE_PATH="$OPENMELD_SETUP_BINARY_TMP/openmeld.gz"

  download_file_with_retry "$OPENMELD_SETUP_BINARY_MANIFEST_URL" "$OPENMELD_SETUP_BINARY_MANIFEST_PATH" 0 || die "OpenMeld could not download the CLI binary manifest."
  grep -F "\\"$OPENMELD_SETUP_BINARY_PLATFORM\\"" "$OPENMELD_SETUP_BINARY_MANIFEST_PATH" >/dev/null 2>&1 || die "OpenMeld CLI binary manifest does not include this platform."
  OPENMELD_SETUP_BINARY_VERSION="$(read_manifest_string_field version "$OPENMELD_SETUP_BINARY_MANIFEST_PATH")"
  OPENMELD_SETUP_BINARY_URL="$(read_manifest_string_field url "$OPENMELD_SETUP_BINARY_MANIFEST_PATH")"
  OPENMELD_SETUP_BINARY_SHA256="$(read_manifest_string_field sha256 "$OPENMELD_SETUP_BINARY_MANIFEST_PATH")"
  OPENMELD_SETUP_BINARY_SIZE_BYTES="$(read_manifest_number_field sizeBytes "$OPENMELD_SETUP_BINARY_MANIFEST_PATH")"
  OPENMELD_SETUP_BINARY_ARCHIVE_FORMAT="$(read_manifest_string_field archiveFormat "$OPENMELD_SETUP_BINARY_MANIFEST_PATH")"
  OPENMELD_SETUP_BINARY_ARCHIVE_URL="$(read_manifest_string_field archiveUrl "$OPENMELD_SETUP_BINARY_MANIFEST_PATH")"
  OPENMELD_SETUP_BINARY_ARCHIVE_SHA256="$(read_manifest_string_field archiveSha256 "$OPENMELD_SETUP_BINARY_MANIFEST_PATH")"
  OPENMELD_SETUP_BINARY_ARCHIVE_SIZE_BYTES="$(read_manifest_number_field archiveSizeBytes "$OPENMELD_SETUP_BINARY_MANIFEST_PATH")"
  OPENMELD_SETUP_BINARY_CODE_IDENTIFIER="$(read_manifest_string_field codeIdentifier "$OPENMELD_SETUP_BINARY_MANIFEST_PATH")"
  OPENMELD_SETUP_BINARY_TEAM_IDENTIFIER="$(read_manifest_string_field teamIdentifier "$OPENMELD_SETUP_BINARY_MANIFEST_PATH")"
  [ -n "$OPENMELD_SETUP_BINARY_VERSION" ] || die "OpenMeld CLI binary manifest is missing the version."
  [ -n "$OPENMELD_SETUP_BINARY_URL" ] || die "OpenMeld CLI binary manifest is missing the download URL."
  [ -n "$OPENMELD_SETUP_BINARY_SHA256" ] || die "OpenMeld CLI binary manifest is missing the sha256."
  [ -n "$OPENMELD_SETUP_BINARY_SIZE_BYTES" ] || die "OpenMeld CLI binary manifest is missing the size."
  if [ -n "$OPENMELD_SETUP_BINARY_CODE_IDENTIFIER$OPENMELD_SETUP_BINARY_TEAM_IDENTIFIER" ]; then
    [ -n "$OPENMELD_SETUP_BINARY_CODE_IDENTIFIER" ] || die "OpenMeld CLI binary manifest is missing the code identifier."
    [ -n "$OPENMELD_SETUP_BINARY_TEAM_IDENTIFIER" ] || die "OpenMeld CLI binary manifest is missing the Apple team identifier."
  fi

  OPENMELD_SETUP_BINARY_HAS_ARCHIVE=0
  if [ -n "$OPENMELD_SETUP_BINARY_ARCHIVE_FORMAT$OPENMELD_SETUP_BINARY_ARCHIVE_URL$OPENMELD_SETUP_BINARY_ARCHIVE_SHA256$OPENMELD_SETUP_BINARY_ARCHIVE_SIZE_BYTES" ]; then
    [ "$OPENMELD_SETUP_BINARY_ARCHIVE_FORMAT" = "gzip" ] || die "OpenMeld CLI binary manifest has an unsupported archive format."
    [ -n "$OPENMELD_SETUP_BINARY_ARCHIVE_URL" ] || die "OpenMeld CLI binary manifest is missing the archive download URL."
    [ -n "$OPENMELD_SETUP_BINARY_ARCHIVE_SHA256" ] || die "OpenMeld CLI binary manifest is missing the archive sha256."
    [ -n "$OPENMELD_SETUP_BINARY_ARCHIVE_SIZE_BYTES" ] || die "OpenMeld CLI binary manifest is missing the archive size."
    command_exists gzip || die "OpenMeld binary setup needs gzip."
    OPENMELD_SETUP_BINARY_HAS_ARCHIVE=1
  fi

  if reuse_matching_managed_binary; then
    return 0
  fi

  if [ "$OPENMELD_SETUP_BINARY_HAS_ARCHIVE" = "1" ]; then
    format_binary_download_notice "$OPENMELD_SETUP_BINARY_ARCHIVE_SIZE_BYTES"
    download_file_with_retry "$OPENMELD_SETUP_BINARY_ARCHIVE_URL" "$OPENMELD_SETUP_BINARY_ARCHIVE_PATH" || die "OpenMeld could not download the CLI binary archive."
    OPENMELD_SETUP_BINARY_ARCHIVE_ACTUAL_SIZE_BYTES="$(wc -c < "$OPENMELD_SETUP_BINARY_ARCHIVE_PATH" | tr -d '[:space:]')"
    [ "$OPENMELD_SETUP_BINARY_ARCHIVE_ACTUAL_SIZE_BYTES" = "$OPENMELD_SETUP_BINARY_ARCHIVE_SIZE_BYTES" ] || die "OpenMeld CLI binary archive size did not match the manifest."
    OPENMELD_SETUP_BINARY_ARCHIVE_ACTUAL_SHA256="$(shasum -a 256 "$OPENMELD_SETUP_BINARY_ARCHIVE_PATH" | awk '{print $1}')"
    [ "$OPENMELD_SETUP_BINARY_ARCHIVE_ACTUAL_SHA256" = "$OPENMELD_SETUP_BINARY_ARCHIVE_SHA256" ] || die "OpenMeld CLI binary archive sha256 did not match the manifest."
    gzip -dc "$OPENMELD_SETUP_BINARY_ARCHIVE_PATH" > "$OPENMELD_SETUP_BINARY_PATH" || die "OpenMeld could not decompress the CLI binary."
  else
    format_binary_download_notice "$OPENMELD_SETUP_BINARY_SIZE_BYTES"
    download_file_with_retry "$OPENMELD_SETUP_BINARY_URL" "$OPENMELD_SETUP_BINARY_PATH" || die "OpenMeld could not download the CLI binary."
  fi
  OPENMELD_SETUP_BINARY_ACTUAL_SIZE_BYTES="$(wc -c < "$OPENMELD_SETUP_BINARY_PATH" | tr -d '[:space:]')"
  [ "$OPENMELD_SETUP_BINARY_ACTUAL_SIZE_BYTES" = "$OPENMELD_SETUP_BINARY_SIZE_BYTES" ] || die "OpenMeld CLI binary size did not match the manifest."
  OPENMELD_SETUP_BINARY_ACTUAL_SHA256="$(shasum -a 256 "$OPENMELD_SETUP_BINARY_PATH" | awk '{print $1}')"
  if [ "$OPENMELD_SETUP_BINARY_ACTUAL_SHA256" != "$OPENMELD_SETUP_BINARY_SHA256" ]; then
    die "OpenMeld CLI binary sha256 did not match the manifest."
  fi

  chmod +x "$OPENMELD_SETUP_BINARY_PATH" || die "OpenMeld could not prepare the CLI binary."
  verify_binary_code_signature "$OPENMELD_SETUP_BINARY_PATH"
  install_downloaded_binary_self
  OPENMELD_SETUP_BINARY_COMMAND="$(resolve_managed_binary_command_path)"
  [ -x "$OPENMELD_SETUP_BINARY_COMMAND" ] || die "OpenMeld installed the CLI binary, but the managed command is not executable."
  maybe_update_old_global_openmeld_cli_for_binary_setup
  cleanup_binary_download
}

run_openmeld() {
  if [ "$OPENMELD_SETUP_DISTRIBUTION" = "binary" ]; then
    if [ -z "$OPENMELD_SETUP_BINARY_COMMAND" ]; then
      install_binary_openmeld
    fi
    run_interactive_openmeld_cli "$OPENMELD_SETUP_BINARY_COMMAND" "$@"
    return $?
  fi

  if [ "$OPENMELD_SETUP_USER_FACING_COMMAND" = "openmeld" ]; then
    run_latest_openmeld "$@"
    return $?
  fi

  if ! command_exists "$OPENMELD_SETUP_USER_FACING_COMMAND"; then
    case "$OPENMELD_SETUP_USER_FACING_COMMAND" in
      openmeld-dev)
        die "The local openmeld-dev command is not installed. From the OpenMeld repo root, run: pnpm openmeld:dev:install"
        ;;
      openmeld-canary)
        die "The openmeld-canary command is not installed. From the OpenMeld repo root, run: pnpm openmeld:canary:install"
        ;;
      *)
        die "The $OPENMELD_SETUP_USER_FACING_COMMAND command is not installed."
        ;;
    esac
  fi

  run_interactive_openmeld_cli "$OPENMELD_SETUP_USER_FACING_COMMAND" "$@"
}

resolve_follow_up_cli_command() {
  if [ "$OPENMELD_SETUP_DISTRIBUTION" = "binary" ]; then
    resolve_managed_binary_command_path
    return
  fi

  if [ "$OPENMELD_SETUP_USER_FACING_COMMAND" = "openmeld" ]; then
    if [ "$OPENMELD_SETUP_GLOBAL_CLI_READY" = "1" ]; then
      printf 'openmeld'
      return
    fi
    printf 'npx -y %s' "$OPENMELD_SETUP_PACKAGE_SPEC"
    return
  fi

  printf '%s' "$OPENMELD_SETUP_USER_FACING_COMMAND"
}

print_shell_single_quoted() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}

print_follow_up_shell_assignment() {
  printf ' %s=' "$1"
  print_shell_single_quoted "$2"
}

resolve_follow_up_cli_command_prefix() {
  if [ "$OPENMELD_SETUP_ENV_PRESET" = "prod" ] && [ -z "$OPENMELD_SETUP_OPENMELD_HOME" ]; then
    resolve_follow_up_cli_command
    return
  fi

  printf 'env'
  if [ -n "$OPENMELD_SETUP_OPENMELD_HOME" ]; then
    print_follow_up_shell_assignment OPENMELD_HOME "$OPENMELD_SETUP_OPENMELD_HOME"
  fi
  print_follow_up_shell_assignment OPENMELD_ENV_PRESET "$OPENMELD_SETUP_ENV_PRESET"
  if [ -n "$OPENMELD_SETUP_GATEWAY_URL" ]; then
    print_follow_up_shell_assignment OPENMELD_GATEWAY_URL "$OPENMELD_SETUP_GATEWAY_URL"
  fi
  if [ -n "$OPENMELD_SETUP_AUTH_URL" ]; then
    print_follow_up_shell_assignment OPENMELD_AUTH_URL "$OPENMELD_SETUP_AUTH_URL"
  fi
  if [ "$OPENMELD_SETUP_DISTRIBUTION" = "binary" ]; then
    print_follow_up_shell_assignment OPENMELD_CLI_BINARY_MANIFEST_URL "$OPENMELD_SETUP_BINARY_MANIFEST_URL"
  fi
  printf ' '
  OPENMELD_SETUP_FOLLOW_UP_COMMAND="$(resolve_follow_up_cli_command)"
  print_shell_single_quoted "$OPENMELD_SETUP_FOLLOW_UP_COMMAND"
}

compare_semver_direction() {
  node -e "const [from,to]=process.argv.slice(1); const parse=(v)=>String(v||'').replace(/^v/,'').split(/[.-]/).map((part)=>Number.parseInt(part,10)||0); const a=parse(from); const b=parse(to); for (let i=0;i<Math.max(a.length,b.length);i+=1){ if ((a[i]||0)<(b[i]||0)){ console.log('upgrade'); process.exit(0); } if ((a[i]||0)>(b[i]||0)){ console.log('downgrade'); process.exit(0); }} console.log('same');" "$1" "$2" < /dev/null
}

read_user_facing_openmeld_version() {
  if ! command_exists "$OPENMELD_SETUP_USER_FACING_COMMAND"; then
    return 0
  fi
  run_clean_openmeld_env "$OPENMELD_SETUP_USER_FACING_COMMAND" --version 2>/dev/null | tail -n 1 | sed 's/^v//'
}

maybe_update_old_global_openmeld_cli_for_binary_setup() {
  if [ "$OPENMELD_SETUP_ENV_PRESET" != "prod" ] || [ "$OPENMELD_SETUP_USER_FACING_COMMAND" != "openmeld" ]; then
    return 0
  fi
  command_exists npm || return 0
  command_exists node || return 0

  OPENMELD_SETUP_CURRENT_COMMAND_VERSION="$(read_user_facing_openmeld_version || true)"
  if [ "$OPENMELD_SETUP_CURRENT_COMMAND_VERSION" = "$OPENMELD_SETUP_BINARY_VERSION" ]; then
    OPENMELD_SETUP_GLOBAL_CLI_READY=1
    return 0
  fi

  OPENMELD_SETUP_NPM_ROOT="$(npm root -g < /dev/null 2>/dev/null || true)"
  [ -n "$OPENMELD_SETUP_NPM_ROOT" ] || return 0
  OPENMELD_SETUP_GLOBAL_PACKAGE_JSON="$OPENMELD_SETUP_NPM_ROOT/$OPENMELD_SETUP_PACKAGE_NAME/package.json"
  [ -f "$OPENMELD_SETUP_GLOBAL_PACKAGE_JSON" ] || return 0

  OPENMELD_SETUP_GLOBAL_VERSION="$(node -p "require(process.argv[1]).version" "$OPENMELD_SETUP_GLOBAL_PACKAGE_JSON" 2>/dev/null || true)"
  [ -n "$OPENMELD_SETUP_GLOBAL_VERSION" ] || return 0
  OPENMELD_SETUP_VERSION_DIRECTION="$(compare_semver_direction "$OPENMELD_SETUP_GLOBAL_VERSION" "$OPENMELD_SETUP_BINARY_VERSION" 2>/dev/null || printf 'unknown')"
  if [ "$OPENMELD_SETUP_VERSION_DIRECTION" != "upgrade" ]; then
    return 0
  fi

  OPENMELD_SETUP_BINARY_PACKAGE_SPEC="$OPENMELD_SETUP_PACKAGE_NAME@$OPENMELD_SETUP_BINARY_VERSION"
  say "OpenMeld found an older global CLI: v$OPENMELD_SETUP_GLOBAL_VERSION."
  say "Updating it to v$OPENMELD_SETUP_BINARY_VERSION so openmeld uses the same version in this Terminal..."
  if ! run_package_command npm install -g "$OPENMELD_SETUP_BINARY_PACKAGE_SPEC"; then
    die "OpenMeld could not update the older global CLI before setup. Fix the npm error above, then run this setup command again."
  fi

  hash -r 2>/dev/null || true
  OPENMELD_SETUP_UPDATED_COMMAND_VERSION="$(read_user_facing_openmeld_version || true)"
  if [ "$OPENMELD_SETUP_UPDATED_COMMAND_VERSION" != "$OPENMELD_SETUP_BINARY_VERSION" ]; then
    die "OpenMeld updated the global package, but openmeld still reports v\${OPENMELD_SETUP_UPDATED_COMMAND_VERSION:-unknown} instead of v$OPENMELD_SETUP_BINARY_VERSION. Open a new Terminal, then run this setup command again."
  fi
  OPENMELD_SETUP_GLOBAL_CLI_READY=1
}

upgrade_global_openmeld_cli() {
  run_package_command npm install -g "$OPENMELD_SETUP_PACKAGE_SPEC" || return 1
  if command_exists "$OPENMELD_SETUP_USER_FACING_COMMAND"; then
    OPENMELD_SETUP_GLOBAL_CLI_READY=1
  else
    say "OpenMeld updated the global package, but the openmeld command is not available on PATH. Follow-up commands will keep using npx."
  fi
}

maybe_queue_old_global_openmeld_update_after_setup() {
  if [ "$OPENMELD_SETUP_USER_FACING_COMMAND" != "openmeld" ]; then
    return 0
  fi
  OPENMELD_SETUP_NPM_ROOT="$(npm root -g < /dev/null 2>/dev/null || true)"
  if [ -z "$OPENMELD_SETUP_NPM_ROOT" ]; then
    return 0
  fi

  OPENMELD_SETUP_GLOBAL_PACKAGE_JSON="$OPENMELD_SETUP_NPM_ROOT/$OPENMELD_SETUP_PACKAGE_NAME/package.json"
  if [ ! -f "$OPENMELD_SETUP_GLOBAL_PACKAGE_JSON" ]; then
    return 0
  fi

  OPENMELD_SETUP_GLOBAL_VERSION="$(node -p "require(process.argv[1]).version" "$OPENMELD_SETUP_GLOBAL_PACKAGE_JSON" 2>/dev/null || true)"
  OPENMELD_SETUP_LATEST_VERSION="$(npm view "$OPENMELD_SETUP_PACKAGE_NAME" version < /dev/null 2>/dev/null || true)"
  if [ -z "$OPENMELD_SETUP_GLOBAL_VERSION" ] || [ -z "$OPENMELD_SETUP_LATEST_VERSION" ]; then
    return 0
  fi

  OPENMELD_SETUP_VERSION_DIRECTION="$(compare_semver_direction "$OPENMELD_SETUP_GLOBAL_VERSION" "$OPENMELD_SETUP_LATEST_VERSION" 2>/dev/null || printf 'unknown')"
  if [ "$OPENMELD_SETUP_VERSION_DIRECTION" != "upgrade" ]; then
    if command_exists "$OPENMELD_SETUP_USER_FACING_COMMAND"; then
      OPENMELD_SETUP_GLOBAL_CLI_READY=1
    fi
    return 0
  fi

  say "OpenMeld found an older global CLI: v$OPENMELD_SETUP_GLOBAL_VERSION."
  confirm "Replace it with OpenMeld CLI v$OPENMELD_SETUP_LATEST_VERSION for future openmeld commands?"
  OPENMELD_SETUP_CONFIRM_RESULT=$?
  if [ "$OPENMELD_SETUP_CONFIRM_RESULT" -eq 0 ]; then
    OPENMELD_SETUP_GLOBAL_CLI_UPDATE_AFTER_SETUP=1
    OPENMELD_SETUP_GLOBAL_CLI_UPDATE_VERSION="$OPENMELD_SETUP_LATEST_VERSION"
  elif [ "$OPENMELD_SETUP_CONFIRM_RESULT" -eq 2 ]; then
    say "No interactive confirmation is available. OpenMeld will update the global CLI after setup succeeds."
    OPENMELD_SETUP_GLOBAL_CLI_UPDATE_AFTER_SETUP=1
    OPENMELD_SETUP_GLOBAL_CLI_UPDATE_VERSION="$OPENMELD_SETUP_LATEST_VERSION"
  else
    say "Keeping the existing global OpenMeld CLI. This setup will still use the latest OpenMeld runner."
  fi
}

maybe_run_global_openmeld_update_after_setup() {
  if [ "$OPENMELD_SETUP_GLOBAL_CLI_UPDATE_AFTER_SETUP" != "1" ]; then
    return 0
  fi
  say "OpenMeld setup is complete. Updating the global OpenMeld CLI to v$OPENMELD_SETUP_GLOBAL_CLI_UPDATE_VERSION for future openmeld commands..."
  if ! upgrade_global_openmeld_cli; then
    say "OpenMeld setup finished, but OpenMeld could not update the global CLI. Try: npm install -g $OPENMELD_SETUP_PACKAGE_SPEC"
  fi
}

validate_setup_args "$@"
if [ "$OPENMELD_SETUP_DISTRIBUTION" = "npm" ]; then
  ensure_node_runtime
fi
resolve_interactive_stdin_source

say ${shellSingleQuote(setupCopy.cliBootstrapRunStatus)}
run_openmeld "$@" || exit $?
if [ "$OPENMELD_SETUP_DISTRIBUTION" = "npm" ]; then
  maybe_queue_old_global_openmeld_update_after_setup
  maybe_run_global_openmeld_update_after_setup
fi
`;
}

export function buildOpenMeldSetupBootstrapPowerShellScript(
	input: OpenMeldSetupBootstrapScriptConfig
): string {
	const laneConfig = LANE_CONFIG[input.lane];
	const setupCopy = getSetupFlowCopy("setup");
	const minNodeMajorVersion =
		input.minNodeMajorVersion ?? DEFAULT_MIN_NODE_MAJOR_VERSION;
	const distribution =
		input.distribution ?? resolveDefaultSetupDistribution(input.lane);

	return `param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$OpenMeldArgs
)

$ErrorActionPreference = 'Stop'

$OpenMeldSetupPackageName = ${powerShellString(OPENMELD_SETUP_PACKAGE_NAME)}
$OpenMeldSetupPackageSpec = ${powerShellString(OPENMELD_SETUP_PACKAGE_SPEC)}
$OpenMeldSetupMinNodeMajorVersion = ${minNodeMajorVersion}
$OpenMeldSetupEnvPreset = ${powerShellString(laneConfig.envPreset)}
$OpenMeldSetupUserFacingCommand = ${powerShellString(laneConfig.userFacingCommand)}
$OpenMeldSetupDistribution = ${powerShellString(distribution)}
$OpenMeldSetupGatewayUrl = ${powerShellString(input.gatewayUrl ?? "")}
$OpenMeldSetupAuthUrl = ${powerShellString(input.authUrl ?? "")}
$OpenMeldSetupOpenMeldHome = ${powerShellString(input.openMeldHome ?? "")}
$OpenMeldSetupPrepareCommandHint = ${powerShellString(OPENMELD_SETUP_PREPARE_COMMAND_HINT)}
$OpenMeldSetupPackageDownloadNotice = ${powerShellString(OPENMELD_SETUP_PACKAGE_DOWNLOAD_NOTICE)}
$script:OpenMeldSetupGlobalCliReady = $false

function Say {
  param([string]$Message)
  Write-Host $Message
}

function Die {
  param([string]$Message)
  Say 'OpenMeld setup could not continue.'
  Say $Message
  exit 1
}

function Test-CommandExists {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Show-PackageAcquisitionFailure {
  param([string]$OutputText)

  if ($OutputText -match '(connect (EPERM|ECONNREFUSED|ECONNRESET|ETIMEDOUT) (127\\.0\\.0\\.1|localhost)|reason: connect (EPERM|ECONNREFUSED|ECONNRESET|ETIMEDOUT) (127\\.0\\.0\\.1|localhost))') {
    Say 'OpenMeld could not download the latest CLI because npm is trying to use a local proxy that is not reachable.'
    Say 'Next: start the local proxy app or turn off the npm proxy setting, then run this setup command again.'
    Say 'Useful checks: npm config get proxy; npm config get https-proxy; Get-ChildItem Env:*proxy*'
    return
  }

  if ($OutputText -match '(Log files were not written|EACCES|EPERM).*(\\.npm|npm)') {
    Say 'OpenMeld could not install the latest CLI because npm cannot write to its local cache or log directory.'
    Say 'Next: check permissions for ~/.npm and ~/.npm/_logs, then run this setup command again.'
    return
  }

  if ($OutputText -match "registry\\.npmjs\\.org|$OpenMeldSetupPackageName") {
    Say 'OpenMeld could not download the latest CLI from npm.'
    Say 'Next: fix the npm or network error shown above, then run this setup command again.'
  }
}

function Show-PackageAcquisitionProbeFailure {
  # The OpenMeld CLI just ran attached to the console (buffering its output would
  # hide the live setup progress), so there is no transcript to inspect.
  # Re-run package acquisition alone to classify npm download failures; a
  # passing probe means the failure came from the CLI itself.
  if (Test-CommandExists 'npx') {
    $probeOutput = (& npx -y $OpenMeldSetupPackageSpec --version 2>&1 | Out-String)
  } else {
    $probeOutput = (& npm exec --yes --package $OpenMeldSetupPackageSpec -- openmeld --version 2>&1 | Out-String)
  }
  if ($LASTEXITCODE -ne 0) {
    # The probe captured npm's output away from the console; replay a bounded
    # tail so the guidance below can point at it.
    $probeText = ([string]$probeOutput).TrimEnd()
    if ($probeText.Length -gt 0) {
      Say 'OpenMeld re-ran the npm package download to diagnose the failure. npm reported:'
      foreach ($probeLine in @(($probeText -split '\\r?\\n') | Select-Object -Last ${OPENMELD_SETUP_PACKAGE_PROBE_TAIL_LINES})) {
        Say ([string]$probeLine)
      }
    }
    Show-PackageAcquisitionFailure $probeOutput
  }
}

function Validate-SetupArgs {
  if ($OpenMeldArgs.Count -lt 1 -or $OpenMeldArgs[0] -ne 'setup') {
    Die $OpenMeldSetupPrepareCommandHint
  }

  $hasStartSession = $false
  $hasOneTimeToken = $false
  $hasDeviceCode = $false
  foreach ($arg in $OpenMeldArgs) {
    if ($arg -eq '--start-session' -or $arg.StartsWith('--start-session=')) {
      $hasStartSession = $true
    }
    if ($arg -eq '--ott' -or $arg.StartsWith('--ott=')) {
      $hasOneTimeToken = $true
    }
    if ($arg -eq '--device-code' -or $arg.StartsWith('--device-code=')) {
      $hasDeviceCode = $true
    }
  }

  if (-not $hasStartSession -or (-not $hasDeviceCode -and -not $hasOneTimeToken)) {
    Die 'This setup script needs --start-session and either --device-code or --ott from OpenMeld Web. Copy the latest setup command from OpenMeld Web and run it again.'
  }
}

function Ensure-NodeRuntime {
  if (-not (Test-CommandExists 'node')) {
    Die 'Install Node.js ${minNodeMajorVersion} or newer from nodejs.org, then run this setup command again.'
  }

  $nodeMajorText = (& node -p "Number(process.versions.node.split('.')[0])" 2>$null)
  $nodeMajor = 0
  [void][int]::TryParse([string]$nodeMajorText, [ref]$nodeMajor)
  if ($nodeMajor -lt $OpenMeldSetupMinNodeMajorVersion) {
    $nodeVersion = (& node --version 2>$null)
    Die "OpenMeld setup found Node.js $nodeVersion. Upgrade Node.js to ${minNodeMajorVersion} or newer, then run this setup command again."
  }

  if (-not (Test-CommandExists 'npm')) {
    Die 'OpenMeld setup needs npm. Install Node.js ${minNodeMajorVersion} or newer from nodejs.org, then run this setup command again.'
  }
}

function Restore-EnvValue {
  param(
    [string]$Name,
    [AllowNull()][string]$Value
  )

  if ($null -eq $Value) {
    Remove-Item -Path "Env:$Name" -ErrorAction SilentlyContinue
  } else {
    Set-Item -Path "Env:$Name" -Value $Value
  }
}

function Invoke-CleanOpenMeldEnv {
  param(
    [string]$Executable,
    [string[]]$Arguments,
    [switch]$ExplainPackageAcquisitionFailure
  )

  $previousOpenMeldHome = [Environment]::GetEnvironmentVariable('OPENMELD_HOME', 'Process')
  $previousGatewayUrl = [Environment]::GetEnvironmentVariable('OPENMELD_GATEWAY_URL', 'Process')
  $previousAuthUrl = [Environment]::GetEnvironmentVariable('OPENMELD_AUTH_URL', 'Process')
  $previousUserFacingCommand = [Environment]::GetEnvironmentVariable('OPENMELD_USER_FACING_CLI_COMMAND', 'Process')
  $previousSetupFollowUpCommand = [Environment]::GetEnvironmentVariable('OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND', 'Process')
  $previousEnvPreset = [Environment]::GetEnvironmentVariable('OPENMELD_ENV_PRESET', 'Process')

  try {
    Remove-Item -Path Env:OPENMELD_HOME -ErrorAction SilentlyContinue
    Remove-Item -Path Env:OPENMELD_GATEWAY_URL -ErrorAction SilentlyContinue
    Remove-Item -Path Env:OPENMELD_AUTH_URL -ErrorAction SilentlyContinue
    Remove-Item -Path Env:OPENMELD_USER_FACING_CLI_COMMAND -ErrorAction SilentlyContinue
    Remove-Item -Path Env:OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND -ErrorAction SilentlyContinue

    $env:OPENMELD_ENV_PRESET = $OpenMeldSetupEnvPreset
    $env:OPENMELD_USER_FACING_CLI_COMMAND = Resolve-FollowUpCliCommandPrefix
    $env:OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND = Resolve-FollowUpCliCommandPrefix
    if ($OpenMeldSetupOpenMeldHome.Length -gt 0) {
      $env:OPENMELD_HOME = $OpenMeldSetupOpenMeldHome
    }
    if ($OpenMeldSetupGatewayUrl.Length -gt 0) {
      $env:OPENMELD_GATEWAY_URL = $OpenMeldSetupGatewayUrl
    }
    if ($OpenMeldSetupAuthUrl.Length -gt 0) {
      $env:OPENMELD_AUTH_URL = $OpenMeldSetupAuthUrl
    }

    if ($ExplainPackageAcquisitionFailure) {
      # Run attached to the console so the CLI's live setup progress renders;
      # capturing output here would buffer it until the CLI exits.
      & $Executable @Arguments
      $commandExitCode = $LASTEXITCODE
      if ($commandExitCode -ne 0) {
        Show-PackageAcquisitionProbeFailure
        exit $commandExitCode
      }
      return
    }

    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  } finally {
    Restore-EnvValue 'OPENMELD_HOME' $previousOpenMeldHome
    Restore-EnvValue 'OPENMELD_GATEWAY_URL' $previousGatewayUrl
    Restore-EnvValue 'OPENMELD_AUTH_URL' $previousAuthUrl
    Restore-EnvValue 'OPENMELD_USER_FACING_CLI_COMMAND' $previousUserFacingCommand
    Restore-EnvValue 'OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND' $previousSetupFollowUpCommand
    Restore-EnvValue 'OPENMELD_ENV_PRESET' $previousEnvPreset
  }
}

function Run-LatestOpenMeld {
  param([string[]]$Arguments)

  Say $OpenMeldSetupPackageDownloadNotice
  if (Test-CommandExists 'npx') {
    Invoke-CleanOpenMeldEnv 'npx' (@('-y', $OpenMeldSetupPackageSpec) + $Arguments) -ExplainPackageAcquisitionFailure
    return
  }

  Invoke-CleanOpenMeldEnv 'npm' (@('exec', '--yes', '--package', $OpenMeldSetupPackageSpec, '--', 'openmeld') + $Arguments) -ExplainPackageAcquisitionFailure
}

function Run-OpenMeld {
  param([string[]]$Arguments)

  if ($OpenMeldSetupUserFacingCommand -eq 'openmeld') {
    Run-LatestOpenMeld $Arguments
    return
  }

  if (-not (Test-CommandExists $OpenMeldSetupUserFacingCommand)) {
    if ($OpenMeldSetupUserFacingCommand -eq 'openmeld-dev') {
      Die 'The local openmeld-dev command is not installed. From the OpenMeld repo root, run: pnpm openmeld:dev:install'
    }
    if ($OpenMeldSetupUserFacingCommand -eq 'openmeld-canary') {
      Die 'The openmeld-canary command is not installed. From the OpenMeld repo root, run: pnpm openmeld:canary:install'
    }
    Die "The $OpenMeldSetupUserFacingCommand command is not installed."
  }

  Invoke-CleanOpenMeldEnv $OpenMeldSetupUserFacingCommand $Arguments
}

function Compare-SemverDirection {
  param(
    [string]$FromVersion,
    [string]$ToVersion
  )

  $fromParts = $FromVersion.TrimStart('v').Split('.', '-')
  $toParts = $ToVersion.TrimStart('v').Split('.', '-')
  $maxCount = [Math]::Max($fromParts.Count, $toParts.Count)
  for ($index = 0; $index -lt $maxCount; $index += 1) {
    $fromPart = 0
    $toPart = 0
    if ($index -lt $fromParts.Count) {
      [void][int]::TryParse($fromParts[$index], [ref]$fromPart)
    }
    if ($index -lt $toParts.Count) {
      [void][int]::TryParse($toParts[$index], [ref]$toPart)
    }
    if ($fromPart -lt $toPart) {
      return 'upgrade'
    }
    if ($fromPart -gt $toPart) {
      return 'downgrade'
    }
  }

  return 'same'
}

function Update-GlobalOpenMeldCliIfAvailable {
  if ($OpenMeldSetupUserFacingCommand -ne 'openmeld') {
    return
  }

  $npmRoot = (& npm root -g 2>$null)
  if ([string]::IsNullOrWhiteSpace($npmRoot)) {
    return
  }

  $globalPackageJson = Join-Path (Join-Path $npmRoot $OpenMeldSetupPackageName) 'package.json'
  if (-not (Test-Path $globalPackageJson)) {
    return
  }

  $globalVersion = (& node -p "require(process.argv[1]).version" $globalPackageJson 2>$null)
  $latestVersion = (& npm view $OpenMeldSetupPackageName version 2>$null)
  if ([string]::IsNullOrWhiteSpace($globalVersion) -or [string]::IsNullOrWhiteSpace($latestVersion)) {
    return
  }

  $direction = Compare-SemverDirection ([string]$globalVersion) ([string]$latestVersion)
  if ($direction -ne 'upgrade') {
    if (Test-CommandExists $OpenMeldSetupUserFacingCommand) {
      $script:OpenMeldSetupGlobalCliReady = $true
    }
    return
  }

  Say "OpenMeld found an older global CLI: v$globalVersion."
  Say "OpenMeld setup is complete. Updating the global OpenMeld CLI to v$latestVersion for future openmeld commands..."
  $installOutput = & npm install -g $OpenMeldSetupPackageSpec 2>&1
  $installExitCode = $LASTEXITCODE
  foreach ($line in $installOutput) {
    Write-Host ([string]$line)
  }
  if ($installExitCode -ne 0) {
    Show-PackageAcquisitionFailure (($installOutput | Out-String))
    Say "OpenMeld setup finished, but OpenMeld could not update the global CLI. Try: npm install -g $OpenMeldSetupPackageSpec"
    return
  }
  if (Test-CommandExists $OpenMeldSetupUserFacingCommand) {
    $script:OpenMeldSetupGlobalCliReady = $true
  } else {
    Say 'OpenMeld updated the global package, but the openmeld command is not available on PATH. Follow-up commands will keep using npx.'
  }
}

function ConvertTo-PowerShellSingleQuoted {
  param([string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Resolve-FollowUpCliInvocation {
  if ($OpenMeldSetupUserFacingCommand -eq 'openmeld') {
    if ($script:OpenMeldSetupGlobalCliReady) {
      return "& 'openmeld'"
    }
    return "& 'npx' '-y' $(ConvertTo-PowerShellSingleQuoted $OpenMeldSetupPackageSpec)"
  }

  return "& $(ConvertTo-PowerShellSingleQuoted $OpenMeldSetupUserFacingCommand)"
}

function Resolve-FollowUpCliCommandPrefix {
  $parts = @()
  if ($OpenMeldSetupEnvPreset -ne 'prod' -or $OpenMeldSetupOpenMeldHome.Length -gt 0) {
    if ($OpenMeldSetupOpenMeldHome.Length -gt 0) {
      $parts += '$env:OPENMELD_HOME=' + (ConvertTo-PowerShellSingleQuoted $OpenMeldSetupOpenMeldHome)
    }
    $parts += '$env:OPENMELD_ENV_PRESET=' + (ConvertTo-PowerShellSingleQuoted $OpenMeldSetupEnvPreset)
    if ($OpenMeldSetupGatewayUrl.Length -gt 0) {
      $parts += '$env:OPENMELD_GATEWAY_URL=' + (ConvertTo-PowerShellSingleQuoted $OpenMeldSetupGatewayUrl)
    }
    if ($OpenMeldSetupAuthUrl.Length -gt 0) {
      $parts += '$env:OPENMELD_AUTH_URL=' + (ConvertTo-PowerShellSingleQuoted $OpenMeldSetupAuthUrl)
    }
  }
  $parts += Resolve-FollowUpCliInvocation
  return $parts -join '; '
}

if ($OpenMeldSetupDistribution -eq 'binary') {
  Die 'OpenMeld binary setup is not available for Windows yet. Use ?dist=npm.'
}

Validate-SetupArgs
Ensure-NodeRuntime

Say ${powerShellString(setupCopy.cliBootstrapRunStatus)}
Run-OpenMeld $OpenMeldArgs
Update-GlobalOpenMeldCliIfAvailable
`;
}

function normalizeOpenMeldSetupBootstrapLane(
	value: string | null
): OpenMeldSetupBootstrapLane | null {
	if (!value) {
		return "prod";
	}
	if (value === "prod" || value === "dev-local" || value === "canary") {
		return value;
	}
	return null;
}

function normalizeOpenMeldSetupDistribution(
	value: string | null,
	lane: OpenMeldSetupBootstrapLane
): OpenMeldSetupDistribution | null {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return resolveDefaultSetupDistribution(lane);
	}
	if (normalized === "npm" || normalized === "binary") {
		return normalized;
	}
	return null;
}

function resolveDefaultSetupDistribution(
	lane: OpenMeldSetupBootstrapLane
): OpenMeldSetupDistribution {
	return lane === "canary" ? "npm" : "binary";
}

function buildSetupBinaryManifestUrl(
	requestUrl: URL,
	input?: {
		lane?: OpenMeldSetupBootstrapLane;
		localRequest?: boolean;
	}
): string {
	if (input?.localRequest && input.lane === "dev-local") {
		return DEFAULT_LOCAL_CLI_BINARY_MANIFEST_URL;
	}
	return new URL("/cli/manifest.json", requestUrl.origin).toString();
}

function isLocalUrl(value: string | URL): boolean {
	const url = typeof value === "string" ? new URL(value) : value;
	return LOCAL_HOSTNAMES.has(normalizeUrlHostname(url.hostname));
}

function isOfficialStagingRequest(requestUrl: URL, webAppUrl: string): boolean {
	const configuredWebAppUrl = new URL(webAppUrl);
	return (
		requestUrl.protocol === "https:" &&
		configuredWebAppUrl.protocol === "https:" &&
		requestUrl.hostname === OPENMELD_STAGING_HOSTNAME &&
		configuredWebAppUrl.hostname === OPENMELD_STAGING_HOSTNAME &&
		requestUrl.origin === configuredWebAppUrl.origin
	);
}

function normalizeUrlHostname(hostname: string): string {
	const normalized = hostname.trim().toLowerCase();
	if (normalized.startsWith("[") && normalized.endsWith("]")) {
		return normalized.slice(1, -1);
	}
	return normalized;
}

function normalizeOptionalString(
	value: string | null | undefined
): string | undefined {
	const normalized = String(value ?? "").trim();
	return normalized.length > 0 ? normalized : undefined;
}

function shellSingleQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function powerShellString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}
