import {
	execFileSync,
	type SpawnSyncReturns,
	spawnSync,
} from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	buildOpenMeldSetupBootstrapPowerShellScript,
	buildOpenMeldSetupBootstrapScript,
	resolveOpenMeldSetupBootstrapScriptConfig,
} from "./setup-bootstrap-script";

const SHELL_BOOTSTRAP_COMMAND_TIMEOUT_MS = 90_000;
const SHELL_BOOTSTRAP_TEST_TIMEOUT_MS = 120_000;
const BOOTSTRAP_FAKE_COMMAND_BIN = join(
	dirname(fileURLToPath(import.meta.url)),
	"__fixtures__",
	"setup-bootstrap-bin"
);
const BOOTSTRAP_FAKE_COMMAND_BIN_WITHOUT_ATS = join(
	dirname(fileURLToPath(import.meta.url)),
	"__fixtures__",
	"setup-bootstrap-bin-no-openmeld"
);

function buildExpectedDevLocalFollowUpPrefix(input: {
	binaryManifestUrl?: string;
	command: string;
	openMeldHome?: string;
}): string {
	return [
		"env",
		...(input.openMeldHome ? [`OPENMELD_HOME='${input.openMeldHome}'`] : []),
		"OPENMELD_ENV_PRESET='dev-local'",
		"OPENMELD_GATEWAY_URL='http://localhost:8080'",
		"OPENMELD_AUTH_URL='http://localhost:8788'",
		...(input.binaryManifestUrl
			? [`OPENMELD_CLI_BINARY_MANIFEST_URL='${input.binaryManifestUrl}'`]
			: []),
		`'${input.command}'`,
	].join(" ");
}

type BootstrapScriptRunOptions = {
	env: Record<string, string>;
	stdinMode?: "script-file" | "script-stdin-file";
	timeout?: number;
};

describe("setup-bootstrap-script", () => {
	it("builds a production bootstrap that runs OpenMeld in a clean production environment", () => {
		const script = buildOpenMeldSetupBootstrapScript({
			lane: "prod",
		});

		expect(script).toContain(
			"env -u OPENMELD_HOME -u OPENMELD_GATEWAY_URL -u OPENMELD_AUTH_URL -u OPENMELD_CLI_BINARY_MANIFEST_URL -u OPENMELD_USER_FACING_CLI_COMMAND"
		);
		expect(script).toContain(
			'OPENMELD_ENV_PRESET="$OPENMELD_SETUP_ENV_PRESET"'
		);
		expect(script).toContain(
			'OPENMELD_USER_FACING_CLI_COMMAND="$(resolve_follow_up_cli_command_prefix)"'
		);
		expect(script).toContain(
			'OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND="$(resolve_follow_up_cli_command_prefix)"'
		);
		expect(script).toContain("OPENMELD_SETUP_DISTRIBUTION='binary'");
		expect(script).toContain("OPENMELD_SETUP_FORCE_SERVICE_REFRESH=0");
		expect(script).toContain(
			'OPENMELD_SETUP_FORCE_SERVICE_REFRESH="$OPENMELD_SETUP_FORCE_SERVICE_REFRESH"'
		);
		expect(script).toContain(
			'format_binary_download_notice "$OPENMELD_SETUP_BINARY_ARCHIVE_SIZE_BYTES"'
		);
		expect(script).toContain(
			'say "Downloading OpenMeld (about $OPENMELD_SETUP_BINARY_DOWNLOAD_SIZE_MB MB)..."'
		);
		expect(script).toContain('gzip -dc "$OPENMELD_SETUP_BINARY_ARCHIVE_PATH"');
		expect(script).toContain(
			`mktemp -d "\${TMPDIR:-/tmp}/openmeld-cli-binary.XXXXXX"`
		);
		expect(script).toContain("trap cleanup_binary_download EXIT");
		expect(script).toContain("download_file_with_retry");
		expect(script).toContain("OPENMELD_SETUP_DOWNLOAD_ATTEMPT=1");
		expect(script).toContain("Download didn't finish. Retrying...");
		expect(script).toContain("curl -fL --progress-bar");
		expect(script).toContain("install_binary_openmeld");
		expect(script).toContain(
			'/usr/bin/codesign --verify --strict --verbose=2 "$OPENMELD_SETUP_SIGNATURE_PATH"'
		);
		expect(script).toContain(
			'/usr/bin/codesign --display --verbose=4 "$OPENMELD_SETUP_SIGNATURE_PATH"'
		);
		expect(script).not.toContain(
			"run_openmeld repair local-state --data-only --view human"
		);
		expect(script).toContain('run_openmeld "$@" || exit $?');
		expect(script).not.toContain("emit_setup_complete");
		expect(script).toContain(
			"Replace it with OpenMeld CLI v$OPENMELD_SETUP_LATEST_VERSION for future openmeld commands?"
		);
		expect(script).toContain(
			"Use this setup script only with an OpenMeld Web setup command. It must include --start-session, either --device-code or --ott, and either --view human or --view agent."
		);
		expect(script).toContain(
			"Downloading OpenMeld CLI (first run may take up to a minute)..."
		);
		expect(script).toContain('say "$OPENMELD_SETUP_PACKAGE_DOWNLOAD_NOTICE"');
		expect(script).not.toContain(
			'setup --start-session <token> --ott <token> --view human"'
		);
		expect(script).toContain(
			"read -r OPENMELD_SETUP_REPLY 2>/dev/null < /dev/tty"
		);
		expect(script).toContain(
			"if ! { [ -t 2 ] && [ -r /dev/tty ] && [ -w /dev/tty ]; } 2>/dev/null; then"
		);
		expect(script).not.toContain("npm uninstall -g");
		// The interactive CLI run attaches stdin to a real terminal when one is
		// available so setup prompts (e.g. the Assistant's local-agent choice)
		// are reachable under curl | sh, while helper commands stay on /dev/null.
		expect(script).toContain(
			'run_interactive_openmeld_cli npx -y "$OPENMELD_SETUP_PACKAGE_SPEC" "$@"'
		);
		expect(script).toContain(
			"if { [ -t 1 ] && [ -r /dev/tty ]; } 2>/dev/null; then"
		);
		expect(script).toContain("OPENMELD_SETUP_INTERACTIVE_STDIN=/dev/tty");
		expect(script).toContain(
			'OPENMELD_SETUP_RUN_STDIN="$OPENMELD_SETUP_INTERACTIVE_STDIN"'
		);
		expect(script).toContain("resolve_interactive_stdin_source");
		expect(script).not.toContain("run_package_command npx");
		expect(script).toContain("probe_package_acquisition_failure");
		expect(script).toContain(
			'run_clean_openmeld_env npx -y "$OPENMELD_SETUP_PACKAGE_SPEC" --version 2>&1'
		);
		expect(script).toContain(
			"OpenMeld re-ran the npm package download to diagnose the failure. npm reported:"
		);
		expect(script).toContain(
			"printf '%s\\n' \"$OPENMELD_SETUP_PACKAGE_PROBE_OUTPUT\" | tail -n 15"
		);
		expect(script).toContain(
			"OpenMeld could not download the latest CLI because npm is trying to use a local proxy that is not reachable."
		);
		expect(script).toContain("npm root -g < /dev/null");
		expect(script).toContain(
			'npm view "$OPENMELD_SETUP_PACKAGE_NAME" version < /dev/null'
		);
		expect(script).toContain("< /dev/null 2>/dev/null || printf '0'");
		expect(script).toContain(
			'if [ "$OPENMELD_SETUP_USER_FACING_COMMAND" = "openmeld" ]; then'
		);
		// Child OpenMeld commands read from an explicit file (default /dev/null),
		// never the inherited pipe carrying the install script.
		expect(script).toContain('"$@" < "$OPENMELD_SETUP_RUN_STDIN"');
		expect(script).toContain("OPENMELD_SETUP_RUN_STDIN=/dev/null");
	});

	it("requires a Prepare Session command with an approved computer grant", () => {
		const script = buildOpenMeldSetupBootstrapScript({
			lane: "prod",
		});

		expect(script).toContain(
			'if [ "$OPENMELD_SETUP_HAS_START_SESSION" -ne 1 ] || { [ "$OPENMELD_SETUP_HAS_DEVICE_CODE" -ne 1 ] && [ "$OPENMELD_SETUP_HAS_OTT" -ne 1 ]; }; then'
		);
		expect(script).toContain(
			"This setup script needs --start-session and either --device-code or --ott from OpenMeld Web."
		);
	});

	it("builds a Windows PowerShell bootstrap that runs the latest OpenMeld runner", () => {
		const script = buildOpenMeldSetupBootstrapPowerShellScript({
			distribution: "npm",
			lane: "prod",
		});

		expect(script).toContain(
			"param(\n  [Parameter(ValueFromRemainingArguments = $true)]"
		);
		expect(script).toContain("$OpenMeldSetupPackageSpec = 'openmeld@latest'");
		expect(script).toContain("$OpenMeldSetupPackageName = 'openmeld'");
		expect(script).toContain("Update-GlobalOpenMeldCliIfAvailable");
		expect(script).not.toContain(
			"Run-OpenMeld @('repair', 'local-state', '--data-only', '--view', 'human')"
		);
		expect(script).toContain("Run-OpenMeld $OpenMeldArgs");
		expect(script).not.toContain("Emit-SetupComplete");
		expect(script).toContain(
			"Die 'This setup script needs --start-session and either --device-code or --ott from OpenMeld Web."
		);
		expect(script).toContain(
			"$OpenMeldSetupPrepareCommandHint = 'Use this setup script only with an OpenMeld Web setup command. It must include --start-session, either --device-code or --ott, and either --view human or --view agent.'"
		);
		expect(script).not.toContain(
			"Die 'Use this setup script only with: setup --start-session <token> --ott <token> --view human'"
		);
		expect(script).toContain(
			"$OpenMeldSetupPackageDownloadNotice = 'Downloading OpenMeld CLI (first run may take up to a minute)...'"
		);
		expect(script).toContain("Say $OpenMeldSetupPackageDownloadNotice");
		expect(script).toContain(
			"Invoke-CleanOpenMeldEnv 'npx' (@('-y', $OpenMeldSetupPackageSpec) + $Arguments)"
		);
		expect(script).toContain(
			"OpenMeld re-ran the npm package download to diagnose the failure. npm reported:"
		);
		expect(script).toContain("Select-Object -Last 15");
		expect(script).toContain(
			"if ($script:OpenMeldSetupGlobalCliReady) {\n      return \"& 'openmeld'\"\n    }"
		);
	});

	it("keeps the exact local environment in Windows follow-up commands", () => {
		const script = buildOpenMeldSetupBootstrapPowerShellScript({
			authUrl: "http://localhost:8788",
			distribution: "npm",
			gatewayUrl: "http://localhost:8080",
			lane: "dev-local",
			openMeldHome: "C:\\OpenMeld Dev\\state",
		});

		expect(script).toContain(
			"$parts += '$env:OPENMELD_HOME=' + (ConvertTo-PowerShellSingleQuoted $OpenMeldSetupOpenMeldHome)"
		);
		expect(script).toContain(
			"$parts += '$env:OPENMELD_ENV_PRESET=' + (ConvertTo-PowerShellSingleQuoted $OpenMeldSetupEnvPreset)"
		);
		expect(script).toContain(
			"$parts += '$env:OPENMELD_GATEWAY_URL=' + (ConvertTo-PowerShellSingleQuoted $OpenMeldSetupGatewayUrl)"
		);
		expect(script).toContain(
			"$parts += '$env:OPENMELD_AUTH_URL=' + (ConvertTo-PowerShellSingleQuoted $OpenMeldSetupAuthUrl)"
		);
		expect(script).toContain("$parts += Resolve-FollowUpCliInvocation");
	});

	it(
		"emits production setup completion with the managed binary prefix",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const callsPath = join(tempDir, "calls.txt");
			const managedBinaryPath = join(tempDir, ".openmeld", "bin", "openmeld");
			try {
				mkdirSync(binDir);
				linkRealNodeRuntime(binDir);
				linkFakeBootstrapCommand(binDir, "curl");
				linkFakeBootstrapCommand(binDir, "shasum");
				linkFakeBootstrapCommand(binDir, "uname");

				const script = buildOpenMeldSetupBootstrapScript({
					lane: "prod",
				});

				const output = execBootstrapScript(
					tempDir,
					script,
					[
						"-s",
						"--",
						"setup",
						"--start-session",
						"preptok_demo",
						"--ott",
						"ott_demo",
						"--view",
						"agent",
					],
					{
						env: {
							HOME: tempDir,
							TMPDIR: tempDir,
							OPENMELD_TEST_CALLS_PATH: callsPath,
							PATH: bootstrapTestPath(binDir),
						},
					}
				);

				const setupComplete = parseSetupCompleteEvent(output);
				expect(setupComplete.payload).toMatchObject({
					authBaseUrl: null,
					cliCommandPrefix: managedBinaryPath,
					forceServiceRefresh: "1",
					gatewayUrl: null,
					lane: "prod",
				});
				expect(setupComplete.payload.nextCommands).toEqual([
					`${managedBinaryPath} whoami --view agent`,
					`${managedBinaryPath} service status --view agent`,
				]);
				expect(readFileSync(callsPath, "utf8")).toBe(
					[
						"install-self",
						"setup --start-session preptok_demo --ott ott_demo --view agent",
						"",
					].join("\n")
				);
				expect(
					readdirSync(tempDir).filter((name) =>
						name.startsWith("openmeld-cli-binary.")
					)
				).toEqual([]);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it(
		"retries an interrupted binary archive download without asking the user to rerun setup",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const callsPath = join(tempDir, "calls.txt");
			const curlCallsPath = join(tempDir, "curl-calls.txt");
			const failedOnceMarkerPath = join(tempDir, "curl-failed-once.txt");
			try {
				mkdirSync(binDir);
				linkRealNodeRuntime(binDir);
				linkFakeBootstrapCommand(binDir, "curl");
				linkFakeBootstrapCommand(binDir, "shasum");
				linkFakeBootstrapCommand(binDir, "uname");

				const output = execBootstrapScript(
					tempDir,
					buildOpenMeldSetupBootstrapScript({ lane: "prod" }),
					[
						"-s",
						"--",
						"setup",
						"--start-session",
						"preptok_demo",
						"--ott",
						"ott_demo",
						"--view",
						"agent",
					],
					{
						env: {
							HOME: tempDir,
							OPENMELD_TEST_CALLS_PATH: callsPath,
							OPENMELD_TEST_CURL_CALLS_PATH: curlCallsPath,
							OPENMELD_TEST_CURL_FAIL_ONCE_MARKER_PATH: failedOnceMarkerPath,
							OPENMELD_TEST_CURL_FAIL_ONCE_SUFFIX: ".gz",
							PATH: bootstrapTestPath(binDir),
						},
					}
				);

				expect(output).toContain("Download didn't finish. Retrying...");
				expect(parseSetupCompleteEvent(output).payload).toMatchObject({
					forceServiceRefresh: "1",
					lane: "prod",
				});
				expect(
					readFileSync(curlCallsPath, "utf8")
						.trim()
						.split("\n")
						.filter((url) => url.endsWith(".gz"))
				).toHaveLength(2);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it(
		"updates an older npm CLI before binary setup can report completion",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const npmRootDir = join(tempDir, "npm-root");
			const packageDir = join(npmRootDir, "openmeld");
			const callsPath = join(tempDir, "calls.txt");
			try {
				mkdirSync(binDir);
				linkRealNodeRuntime(binDir);
				linkFakeBootstrapCommand(binDir, "curl");
				linkFakeBootstrapCommand(binDir, "shasum");
				linkFakeBootstrapCommand(binDir, "uname");
				mkdirSync(packageDir, { recursive: true });
				writeFileSync(
					join(packageDir, "package.json"),
					JSON.stringify({ version: "1.0.0" })
				);

				const script = buildOpenMeldSetupBootstrapScript({ lane: "prod" });
				const output = execBootstrapScript(
					tempDir,
					script,
					[
						"-s",
						"--",
						"setup",
						"--start-session",
						"preptok_demo",
						"--ott",
						"ott_demo",
						"--view",
						"agent",
					],
					{
						env: {
							HOME: tempDir,
							OPENMELD_TEST_CALLS_PATH: callsPath,
							OPENMELD_TEST_NPM_ROOT: npmRootDir,
							PATH: bootstrapTestPath(binDir),
						},
					}
				);

				expect(parseSetupCompleteEvent(output).payload.cliCommandPrefix).toBe(
					join(tempDir, ".openmeld", "bin", "openmeld")
				);
				expect(readFileSync(callsPath, "utf8")).toBe(
					[
						"install-self",
						"npm install -g openmeld@9.9.9",
						"setup --start-session preptok_demo --ott ott_demo --view agent",
						"",
					].join("\n")
				);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it(
		"reuses the exact managed binary without downloading or installing it again",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const callsPath = join(tempDir, "calls.txt");
			try {
				mkdirSync(binDir);
				linkRealNodeRuntime(binDir);
				linkFakeBootstrapCommand(binDir, "curl");
				linkFakeBootstrapCommand(binDir, "shasum");
				linkFakeBootstrapCommand(binDir, "uname");

				const script = buildOpenMeldSetupBootstrapScript({ lane: "prod" });
				const args = [
					"-s",
					"--",
					"setup",
					"--start-session",
					"preptok_demo",
					"--ott",
					"ott_demo",
					"--view",
					"agent",
				];
				const options = {
					env: {
						HOME: tempDir,
						TMPDIR: tempDir,
						OPENMELD_TEST_CALLS_PATH: callsPath,
						PATH: bootstrapTestPath(binDir),
					},
				};

				execBootstrapScript(tempDir, script, args, options);
				const repeatedOutput = execBootstrapScript(
					tempDir,
					script,
					args,
					options
				);

				expect(repeatedOutput).not.toContain("Downloading OpenMeld (about");
				expect(parseSetupCompleteEvent(repeatedOutput).payload).toMatchObject({
					forceServiceRefresh: "0",
				});
				expect(readFileSync(callsPath, "utf8")).toBe(
					[
						"install-self",
						"setup --start-session preptok_demo --ott ott_demo --view agent",
						"setup --start-session preptok_demo --ott ott_demo --view agent",
						"",
					].join("\n")
				);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it(
		"repairs a same-size managed binary when its sha256 does not match",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const callsPath = join(tempDir, "calls.txt");
			try {
				mkdirSync(binDir);
				linkRealNodeRuntime(binDir);
				linkFakeBootstrapCommand(binDir, "curl");
				linkFakeBootstrapCommand(binDir, "shasum");
				linkFakeBootstrapCommand(binDir, "uname");

				const script = buildOpenMeldSetupBootstrapScript({ lane: "prod" });
				const args = [
					"-s",
					"--",
					"setup",
					"--start-session",
					"preptok_demo",
					"--ott",
					"ott_demo",
					"--view",
					"agent",
				];
				const baseEnv = {
					HOME: tempDir,
					TMPDIR: tempDir,
					OPENMELD_TEST_CALLS_PATH: callsPath,
					PATH: bootstrapTestPath(binDir),
				};

				execBootstrapScript(tempDir, script, args, { env: baseEnv });
				const repairOutput = execBootstrapScript(tempDir, script, args, {
					env: {
						...baseEnv,
						OPENMELD_TEST_MANAGED_BINARY_SHA256_MISMATCH: "1",
					},
				});

				expect(repairOutput).toContain("Downloading OpenMeld (about 1 MB)");
				expect(parseSetupCompleteEvent(repairOutput).payload).toMatchObject({
					forceServiceRefresh: "1",
				});
				expect(readFileSync(callsPath, "utf8")).toContain(
					"install-self\nsetup --start-session preptok_demo --ott ott_demo --view agent\ninstall-self"
				);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it(
		"completes binary setup when the older npm CLI cannot be updated",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const npmRootDir = join(tempDir, "npm-root");
			const packageDir = join(npmRootDir, "openmeld");
			const callsPath = join(tempDir, "calls.txt");
			try {
				mkdirSync(binDir);
				linkRealNodeRuntime(binDir);
				linkFakeBootstrapCommand(binDir, "curl");
				linkFakeBootstrapCommand(binDir, "shasum");
				linkFakeBootstrapCommand(binDir, "uname");
				mkdirSync(packageDir, { recursive: true });
				writeFileSync(
					join(packageDir, "package.json"),
					JSON.stringify({ version: "1.0.0" })
				);

				const result = spawnBootstrapScript(
					tempDir,
					buildOpenMeldSetupBootstrapScript({ lane: "prod" }),
					[
						"-s",
						"--",
						"setup",
						"--start-session",
						"preptok_demo",
						"--ott",
						"ott_demo",
						"--view",
						"agent",
					],
					{
						env: {
							HOME: tempDir,
							OPENMELD_TEST_CALLS_PATH: callsPath,
							OPENMELD_TEST_NPM_MUTATION_MODE: "reject",
							OPENMELD_TEST_NPM_ROOT: npmRootDir,
							PATH: bootstrapTestPath(binDir),
						},
					}
				);

				expect(result.status).toBe(0);
				expect(result.stdout).toContain(
					"Setup will continue with the new OpenMeld binary."
				);
				expect(result.stdout).toContain('"code":"setup.complete"');
				expect(readFileSync(callsPath, "utf8")).toBe(
					"install-self\nsetup --start-session preptok_demo --ott ott_demo --view agent\n"
				);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it(
		"does not reinstall npm when openmeld already reaches the managed binary",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const npmRootDir = join(tempDir, "npm-root");
			const packageDir = join(npmRootDir, "openmeld");
			const callsPath = join(tempDir, "calls.txt");
			try {
				mkdirSync(binDir);
				linkRealNodeRuntime(binDir);
				linkFakeBootstrapCommand(binDir, "curl");
				linkFakeBootstrapCommand(binDir, "shasum");
				linkFakeBootstrapCommand(binDir, "uname");
				mkdirSync(packageDir, { recursive: true });
				writeFileSync(
					join(packageDir, "package.json"),
					JSON.stringify({ version: "1.0.0" })
				);

				const output = execBootstrapScript(
					tempDir,
					buildOpenMeldSetupBootstrapScript({ lane: "prod" }),
					[
						"-s",
						"--",
						"setup",
						"--start-session",
						"preptok_demo",
						"--ott",
						"ott_demo",
						"--view",
						"agent",
					],
					{
						env: {
							HOME: tempDir,
							OPENMELD_TEST_CALLS_PATH: callsPath,
							OPENMELD_TEST_NPM_MUTATION_MODE: "reject",
							OPENMELD_TEST_NPM_ROOT: npmRootDir,
							OPENMELD_TEST_OPENMELD_VERSION: "9.9.9",
							PATH: bootstrapTestPath(binDir),
						},
					}
				);

				expect(parseSetupCompleteEvent(output).payload.cliCommandPrefix).toBe(
					join(tempDir, ".openmeld", "bin", "openmeld")
				);
				expect(readFileSync(callsPath, "utf8")).toBe(
					[
						"install-self",
						"setup --start-session preptok_demo --ott ott_demo --view agent",
						"",
					].join("\n")
				);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it(
		"force-installs the downloaded binary for local dev-lane binary setup",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const callsPath = join(tempDir, "calls.txt");
			const openMeldHome = join(tempDir, ".openmeld-dev");
			const managedBinaryPath = join(openMeldHome, "bin", "openmeld");
			const followUpCommandPrefix = buildExpectedDevLocalFollowUpPrefix({
				binaryManifestUrl: "http://127.0.0.1:3197/cli/manifest.json",
				command: managedBinaryPath,
				openMeldHome,
			});
			try {
				mkdirSync(binDir);
				linkRealNodeRuntime(binDir);
				linkFakeBootstrapCommand(binDir, "curl");
				linkFakeBootstrapCommand(binDir, "shasum");
				linkFakeBootstrapCommand(binDir, "uname");

				const script = buildOpenMeldSetupBootstrapScript({
					authUrl: "http://localhost:8788",
					binaryManifestUrl: "http://127.0.0.1:3197/cli/manifest.json",
					distribution: "binary",
					gatewayUrl: "http://localhost:8080",
					lane: "dev-local",
					openMeldHome,
				});
				expect(script).toContain("OPENMELD_SETUP_FORCE_SERVICE_REFRESH=1");

				const output = execBootstrapScript(
					tempDir,
					script,
					[
						"-s",
						"--",
						"setup",
						"--start-session",
						"preptok_demo",
						"--ott",
						"ott_demo",
						"--view",
						"human",
					],
					{
						env: {
							HOME: tempDir,
							OPENMELD_TEST_CALLS_PATH: callsPath,
							PATH: bootstrapTestPath(binDir),
						},
					}
				);

				const setupComplete = parseSetupCompleteEvent(output);
				expect(setupComplete.payload).toMatchObject({
					authBaseUrl: "http://localhost:8788",
					cliCommandPrefix: followUpCommandPrefix,
					forceServiceRefresh: "1",
					gatewayUrl: "http://localhost:8080",
					lane: "dev-local",
				});
				expect(readFileSync(callsPath, "utf8")).toBe(
					[
						"install-self --force",
						"setup --start-session preptok_demo --ott ott_demo --view human",
						"",
					].join("\n")
				);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it(
		"explains local proxy failures when the latest production runner cannot be downloaded",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const npmRootDir = join(tempDir, "npm-root");
			const callsPath = join(tempDir, "calls.txt");
			try {
				mkdirSync(binDir);
				mkdirSync(npmRootDir);
				linkRealNodeRuntime(binDir);

				const script = buildOpenMeldSetupBootstrapScript({
					distribution: "npm",
					lane: "prod",
				});

				const result = spawnBootstrapScript(
					tempDir,
					script,
					[
						"-s",
						"--",
						"setup",
						"--start-session",
						"preptok_demo",
						"--ott",
						"ott_demo",
						"--view",
						"agent",
					],
					{
						env: {
							OPENMELD_TEST_CALLS_PATH: callsPath,
							OPENMELD_TEST_NPM_ROOT: npmRootDir,
							OPENMELD_TEST_NPX_FAILURE_MODE: "local-proxy",
							PATH: bootstrapTestPath(binDir),
						},
					}
				);

				expect(result.status).toBe(1);
				// The CLI run stays attached to the caller's stdio (no tee pipe), so
				// npm's own error reaches the user on stderr instead of a replayed
				// stdout transcript.
				expect(result.stderr).toContain("connect EPERM 127.0.0.1:7890");
				// The probe captures npm's output into a variable, so the bootstrap
				// must replay it on stdout — otherwise "the error shown above" points
				// at nothing.
				expect(result.stdout).toContain(
					"OpenMeld re-ran the npm package download to diagnose the failure. npm reported:"
				);
				expect(result.stdout).toContain("connect EPERM 127.0.0.1:7890");
				// The replay is bounded to the last 15 lines: the oldest padding
				// lines are dropped while the trailing error block survives.
				expect(result.stdout).toContain("npm verbose padding line 20");
				expect(result.stdout).not.toContain("npm verbose padding line 01");
				expect(result.stdout).toContain(
					"OpenMeld could not download the latest CLI because npm is trying to use a local proxy that is not reachable."
				);
				expect(result.stdout).toContain("npm config get https-proxy");
				expect(result.stdout).not.toContain(
					"OpenMeld setup could not continue."
				);
				expect(readFileSync(callsPath, "utf8")).toBe(
					[
						"-y openmeld@latest setup --start-session preptok_demo --ott ott_demo --view agent",
						"-y openmeld@latest --version",
						"",
					].join("\n")
				);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it(
		"does not blame npm downloads when the production CLI itself fails",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const npmRootDir = join(tempDir, "npm-root");
			const callsPath = join(tempDir, "calls.txt");
			try {
				mkdirSync(binDir);
				mkdirSync(npmRootDir);
				linkRealNodeRuntime(binDir);

				const script = buildOpenMeldSetupBootstrapScript({
					distribution: "npm",
					lane: "prod",
				});

				const result = spawnBootstrapScript(
					tempDir,
					script,
					[
						"-s",
						"--",
						"setup",
						"--start-session",
						"preptok_demo",
						"--ott",
						"ott_demo",
						"--view",
						"agent",
					],
					{
						env: {
							OPENMELD_TEST_CALLS_PATH: callsPath,
							OPENMELD_TEST_NPM_ROOT: npmRootDir,
							OPENMELD_TEST_SETUP_EXIT: "23",
							PATH: bootstrapTestPath(binDir),
						},
					}
				);

				expect(result.status).toBe(23);
				expect(result.stdout).not.toContain(
					"OpenMeld setup could not continue."
				);
				// The acquisition probe succeeds, so no npm download diagnosis or
				// replayed npm output is shown.
				expect(result.stdout).not.toContain(
					"OpenMeld could not download the latest CLI"
				);
				expect(result.stdout).not.toContain("npm reported:");
				expect(readFileSync(callsPath, "utf8")).toBe(
					[
						"-y openmeld@latest setup --start-session preptok_demo --ott ott_demo --view agent",
						"-y openmeld@latest --version",
						"",
					].join("\n")
				);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it(
		"updates an old production global CLI during non-interactive setup and prefers openmeld afterward",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const npmRootDir = join(tempDir, "npm-root");
			const packageDir = join(npmRootDir, "openmeld");
			const callsPath = join(tempDir, "calls.txt");
			try {
				mkdirSync(binDir, { recursive: true });
				linkRealNodeRuntime(binDir);
				mkdirSync(packageDir, { recursive: true });
				writeFileSync(
					join(packageDir, "package.json"),
					JSON.stringify({ version: "1.0.0" })
				);

				const script = buildOpenMeldSetupBootstrapScript({
					distribution: "npm",
					lane: "prod",
				});
				const result = spawnBootstrapScript(
					tempDir,
					script,
					[
						"-s",
						"--",
						"setup",
						"--start-session",
						"preptok_demo",
						"--ott",
						"ott_demo",
						"--view",
						"agent",
					],
					{
						env: {
							OPENMELD_TEST_CALLS_PATH: callsPath,
							OPENMELD_TEST_NPM_MUTATION_MODE: "record",
							OPENMELD_TEST_NPM_ROOT: npmRootDir,
							OPENMELD_TEST_NPM_VIEW_VERSION: "9.9.9",
							PATH: bootstrapTestPath(binDir),
						},
					}
				);

				expect(result.status).toBe(0);
				expect(result.stderr).not.toContain("/dev/tty");
				expect(result.stdout).toContain(
					"OpenMeld found an older global CLI: v1.0.0."
				);
				expect(result.stdout).toContain(
					"No interactive confirmation is available. OpenMeld will update the global CLI after setup succeeds."
				);
				expect(parseSetupCompleteEvent(result.stdout).payload).toMatchObject({
					cliCommandPrefix: "npx -y openmeld@latest",
					lane: "prod",
				});
				expect(
					parseSetupCompleteEvent(result.stdout).payload.nextCommands
				).toEqual([
					"npx -y openmeld@latest whoami --view agent",
					"npx -y openmeld@latest service status --view agent",
				]);
				expect(readFileSync(callsPath, "utf8")).toBe(
					[
						"-y openmeld@latest setup --start-session preptok_demo --ott ott_demo --view agent",
						"npm install -g openmeld@latest",
						"",
					].join("\n")
				);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it(
		"keeps npx follow-up commands while checking the global CLI after setup",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const npmRootDir = join(tempDir, "npm-root");
			const packageDir = join(npmRootDir, "openmeld");
			const callsPath = join(tempDir, "calls.txt");
			try {
				mkdirSync(binDir, { recursive: true });
				linkRealNodeRuntime(binDir);
				mkdirSync(packageDir, { recursive: true });
				writeFileSync(
					join(packageDir, "package.json"),
					JSON.stringify({ version: "9.9.9" })
				);

				const script = buildOpenMeldSetupBootstrapScript({
					distribution: "npm",
					lane: "prod",
				});
				const output = execBootstrapScript(
					tempDir,
					script,
					[
						"-s",
						"--",
						"setup",
						"--start-session",
						"preptok_demo",
						"--ott",
						"ott_demo",
						"--view",
						"agent",
					],
					{
						env: {
							OPENMELD_TEST_CALLS_PATH: callsPath,
							OPENMELD_TEST_NPM_MUTATION_MODE: "reject",
							OPENMELD_TEST_NPM_ROOT: npmRootDir,
							OPENMELD_TEST_NPM_VIEW_VERSION: "9.9.9",
							PATH: bootstrapTestPath(binDir),
						},
					}
				);

				const setupComplete = parseSetupCompleteEvent(output);
				expect(setupComplete.payload).toMatchObject({
					cliCommandPrefix: "npx -y openmeld@latest",
					lane: "prod",
				});
				expect(setupComplete.payload.nextCommands).toEqual([
					"npx -y openmeld@latest whoami --view agent",
					"npx -y openmeld@latest service status --view agent",
				]);
				expect(readFileSync(callsPath, "utf8")).toBe(
					[
						"-y openmeld@latest setup --start-session preptok_demo --ott ott_demo --view agent",
						"",
					].join("\n")
				);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it(
		"keeps npx follow-up commands when the global package exists but openmeld is not on PATH",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const npmRootDir = join(tempDir, "npm-root");
			const packageDir = join(npmRootDir, "openmeld");
			const callsPath = join(tempDir, "calls.txt");
			try {
				mkdirSync(binDir, { recursive: true });
				linkRealNodeRuntime(binDir);
				mkdirSync(packageDir, { recursive: true });
				writeFileSync(
					join(packageDir, "package.json"),
					JSON.stringify({ version: "9.9.9" })
				);

				const script = buildOpenMeldSetupBootstrapScript({
					distribution: "npm",
					lane: "prod",
				});
				const output = execBootstrapScript(
					tempDir,
					script,
					[
						"-s",
						"--",
						"setup",
						"--start-session",
						"preptok_demo",
						"--ott",
						"ott_demo",
						"--view",
						"agent",
					],
					{
						env: {
							OPENMELD_TEST_CALLS_PATH: callsPath,
							OPENMELD_TEST_NPM_ROOT: npmRootDir,
							OPENMELD_TEST_NPM_VIEW_VERSION: "9.9.9",
							PATH: bootstrapTestPathWithoutOpenMeld(binDir),
						},
					}
				);

				const setupComplete = parseSetupCompleteEvent(output);
				expect(setupComplete.payload).toMatchObject({
					cliCommandPrefix: "npx -y openmeld@latest",
					lane: "prod",
				});
				expect(setupComplete.payload.nextCommands).toEqual([
					"npx -y openmeld@latest whoami --view agent",
					"npx -y openmeld@latest service status --view agent",
				]);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it("keeps local dev-lane bootstrap testing scoped to local services", () => {
		const result = resolveOpenMeldSetupBootstrapScriptConfig({
			authUrl: "http://localhost:8788",
			gatewayUrl: "http://localhost:8080",
			platform: "posix",
			requestUrl:
				"http://localhost:3000/setup?lane=dev-local&openMeldHome=/tmp/openmeld-home",
			webAppUrl: "http://localhost:3000",
		});

		expect(result).toEqual({
			config: {
				openMeldHome: "/tmp/openmeld-home",
				authUrl: "http://localhost:8788",
				binaryManifestUrl: "http://127.0.0.1:3197/cli/manifest.json",
				distribution: "binary",
				gatewayUrl: "http://localhost:8080",
				lane: "dev-local",
			},
			status: "ok",
		});
	});

	it("uses the local binary manifest override for local dev-lane setup", () => {
		const result = resolveOpenMeldSetupBootstrapScriptConfig({
			authUrl: "http://localhost:8788",
			binaryManifestUrl: "http://127.0.0.1:3197/cli/manifest.json",
			gatewayUrl: "http://localhost:8080",
			platform: "posix",
			requestUrl:
				"http://localhost:3000/setup?lane=dev-local&openMeldHome=/tmp/openmeld-home",
			webAppUrl: "http://localhost:3000",
		});

		expect(result).toEqual({
			config: {
				openMeldHome: "/tmp/openmeld-home",
				authUrl: "http://localhost:8788",
				binaryManifestUrl: "http://127.0.0.1:3197/cli/manifest.json",
				distribution: "binary",
				gatewayUrl: "http://localhost:8080",
				lane: "dev-local",
			},
			status: "ok",
		});
	});

	it("treats IPv6 localhost as local for dev-lane bootstrap testing", () => {
		const result = resolveOpenMeldSetupBootstrapScriptConfig({
			authUrl: "http://[::1]:8788",
			gatewayUrl: "http://[::1]:8080",
			platform: "posix",
			requestUrl:
				"http://[::1]:3000/setup?lane=dev-local&openMeldHome=/tmp/openmeld-home",
			webAppUrl: "http://[::1]:3000",
		});

		expect(result).toEqual({
			config: {
				openMeldHome: "/tmp/openmeld-home",
				authUrl: "http://[::1]:8788",
				binaryManifestUrl: "http://127.0.0.1:3197/cli/manifest.json",
				distribution: "binary",
				gatewayUrl: "http://[::1]:8080",
				lane: "dev-local",
			},
			status: "ok",
		});
	});

	it("ignores the local binary manifest override for production setup", () => {
		const result = resolveOpenMeldSetupBootstrapScriptConfig({
			authUrl: "https://auth.openmeld.invalid",
			binaryManifestUrl: "http://127.0.0.1:3197/cli/manifest.json",
			gatewayUrl: "https://gateway.openmeld.invalid",
			platform: "posix",
			requestUrl: "https://openmeld.invalid/setup",
			webAppUrl: "https://openmeld.invalid",
		});

		expect(result).toEqual({
			config: {
				binaryManifestUrl: "https://openmeld.invalid/cli/manifest.json",
				distribution: "binary",
				lane: "prod",
			},
			status: "ok",
		});
	});

	it("keeps production setup on binary by default and allows npm opt-out", () => {
		expect(
			resolveOpenMeldSetupBootstrapScriptConfig({
				authUrl: "https://auth.openmeld.invalid",
				gatewayUrl: "https://gateway.openmeld.invalid",
				platform: "posix",
				requestUrl: "https://openmeld.invalid/setup",
				webAppUrl: "https://openmeld.invalid",
			})
		).toEqual({
			config: {
				binaryManifestUrl: "https://openmeld.invalid/cli/manifest.json",
				distribution: "binary",
				lane: "prod",
			},
			status: "ok",
		});
		expect(
			resolveOpenMeldSetupBootstrapScriptConfig({
				authUrl: "https://auth.openmeld.invalid",
				gatewayUrl: "https://gateway.openmeld.invalid",
				platform: "posix",
				requestUrl: "https://openmeld.invalid/setup?dist=npm",
				webAppUrl: "https://openmeld.invalid",
			})
		).toEqual({
			config: {
				binaryManifestUrl: "https://openmeld.invalid/cli/manifest.json",
				distribution: "npm",
				lane: "prod",
			},
			status: "ok",
		});
	});

	it("lets local dev setup opt back into npm distribution", () => {
		expect(
			resolveOpenMeldSetupBootstrapScriptConfig({
				authUrl: "http://localhost:8788",
				gatewayUrl: "http://localhost:8080",
				platform: "posix",
				requestUrl: "http://localhost:3000/setup?lane=dev-local&dist=npm",
				webAppUrl: "http://localhost:3000",
			})
		).toEqual({
			config: {
				authUrl: "http://localhost:8788",
				binaryManifestUrl: "http://127.0.0.1:3197/cli/manifest.json",
				distribution: "npm",
				gatewayUrl: "http://localhost:8080",
				lane: "dev-local",
			},
			status: "ok",
		});
	});

	it("rejects binary setup for Windows", () => {
		expect(
			resolveOpenMeldSetupBootstrapScriptConfig({
				authUrl: "http://localhost:8788",
				gatewayUrl: "http://localhost:8080",
				platform: "windows",
				requestUrl: "http://localhost:3000/setup?lane=dev-local",
				webAppUrl: "http://localhost:3000",
			})
		).toEqual({
			body: "OpenMeld binary setup is not available for Windows yet. Use ?dist=npm.",
			status: "error",
			statusCode: 400,
		});
	});

	it("runs local dev bootstrap through openmeld-dev instead of the production npx runner", () => {
		const script = buildOpenMeldSetupBootstrapScript({
			authUrl: "http://localhost:8788",
			distribution: "npm",
			gatewayUrl: "http://localhost:8080",
			lane: "dev-local",
		});

		expect(script).toContain("OPENMELD_SETUP_ENV_PRESET='dev-local'");
		expect(script).toContain(
			"OPENMELD_SETUP_USER_FACING_COMMAND='openmeld-dev'"
		);
		expect(script).toContain(
			'run_interactive_openmeld_cli "$OPENMELD_SETUP_USER_FACING_COMMAND" "$@"'
		);
		expect(script).toContain(
			"The local openmeld-dev command is not installed. From the OpenMeld repo root, run: pnpm openmeld:dev:install"
		);
	});

	it(
		"does not let child OpenMeld commands consume the piped setup script",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const callsPath = join(tempDir, "calls.txt");
			const childStdinPath = join(tempDir, "child-stdin.txt");
			try {
				mkdirSync(binDir);
				linkRealNodeRuntime(binDir);

				const script = buildOpenMeldSetupBootstrapScript({
					authUrl: "http://localhost:8788",
					distribution: "npm",
					gatewayUrl: "http://localhost:8080",
					lane: "dev-local",
				});

				const output = execBootstrapScript(
					tempDir,
					script,
					[
						"-s",
						"--",
						"setup",
						"--start-session",
						"preptok_demo",
						"--ott",
						"ott_demo",
						"--view",
						"human",
					],
					{
						env: {
							OPENMELD_TEST_CALLS_PATH: callsPath,
							OPENMELD_TEST_CHILD_STDIN_PATH: childStdinPath,
							PATH: bootstrapTestPath(binDir),
						},
						stdinMode: "script-stdin-file",
					}
				);
				const followUpCommandPrefix = buildExpectedDevLocalFollowUpPrefix({
					command: "openmeld-dev",
				});

				expect(output).toContain("Starting OpenMeld...");
				expect(output).toContain('"code":"setup.complete"');
				expect(output).toContain(
					`"cliCommandPrefix":"${followUpCommandPrefix}"`
				);
				expect(output).toContain(
					`"${followUpCommandPrefix} whoami --view agent"`
				);
				expect(readFileSync(callsPath, "utf8")).toBe(
					[
						"setup --start-session preptok_demo --ott ott_demo --view human",
						"",
					].join("\n")
				);
				expect(readFileSync(childStdinPath, "utf8")).toBe("");
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it(
		"accepts Agent Interface agent-view Prepare Session handoff arguments",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const callsPath = join(tempDir, "calls.txt");
			try {
				mkdirSync(binDir);
				linkRealNodeRuntime(binDir);

				const script = buildOpenMeldSetupBootstrapScript({
					authUrl: "http://localhost:8788",
					distribution: "npm",
					gatewayUrl: "http://localhost:8080",
					lane: "dev-local",
				});

				const output = execBootstrapScript(
					tempDir,
					script,
					[
						"-s",
						"--",
						"setup",
						"--start-session",
						"preptok_demo",
						"--local-agents",
						"all",
						"--device-code",
						"device_code_demo",
						"--view",
						"agent",
					],
					{
						env: {
							OPENMELD_TEST_CALLS_PATH: callsPath,
							PATH: bootstrapTestPath(binDir),
						},
					}
				);
				const followUpCommandPrefix = buildExpectedDevLocalFollowUpPrefix({
					command: "openmeld-dev",
				});

				expect(output).toContain("Starting OpenMeld...");
				const setupComplete = parseSetupCompleteEvent(output);
				expect(setupComplete.payload).toMatchObject({
					authBaseUrl: "http://localhost:8788",
					cliCommandPrefix: followUpCommandPrefix,
					gatewayUrl: "http://localhost:8080",
					lane: "dev-local",
				});
				expect(setupComplete.payload.nextCommands).toEqual([
					`${followUpCommandPrefix} whoami --view agent`,
					`${followUpCommandPrefix} service status --view agent`,
				]);
				expect(readFileSync(callsPath, "utf8")).toBe(
					[
						"setup --start-session preptok_demo --local-agents all --device-code device_code_demo --view agent",
						"",
					].join("\n")
				);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it(
		"stops local dev bootstrap when setup fails",
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), "openmeld-setup-bootstrap-"));
			const binDir = join(tempDir, "bin");
			const callsPath = join(tempDir, "calls.txt");
			try {
				mkdirSync(binDir);
				linkRealNodeRuntime(binDir);

				const script = buildOpenMeldSetupBootstrapScript({
					authUrl: "http://localhost:8788",
					distribution: "npm",
					gatewayUrl: "http://localhost:8080",
					lane: "dev-local",
				});

				const result = spawnBootstrapScript(
					tempDir,
					script,
					[
						"-s",
						"--",
						"setup",
						"--start-session",
						"preptok_demo",
						"--ott",
						"ott_demo",
						"--view",
						"human",
					],
					{
						env: {
							OPENMELD_TEST_CALLS_PATH: callsPath,
							OPENMELD_TEST_SETUP_EXIT: "23",
							PATH: bootstrapTestPath(binDir),
						},
					}
				);

				expect(result.status).toBe(23);
				expect(result.stdout).toContain("Starting OpenMeld...");
				expect(result.stdout).not.toContain(
					"OpenMeld setup could not continue."
				);
				expect(result.stdout).not.toContain("copy a fresh setup command");
				expect(readFileSync(callsPath, "utf8")).toBe(
					"setup --start-session preptok_demo --ott ott_demo --view human\n"
				);
			} finally {
				rmSync(tempDir, { force: true, recursive: true });
			}
		},
		SHELL_BOOTSTRAP_TEST_TIMEOUT_MS
	);

	it("rejects non-production lanes outside localhost", () => {
		const result = resolveOpenMeldSetupBootstrapScriptConfig({
			authUrl: "https://auth.openmeld.invalid",
			gatewayUrl: "https://gateway.openmeld.invalid",
			platform: "posix",
			requestUrl: "https://openmeld.invalid/setup?lane=dev-local",
			webAppUrl: "https://openmeld.invalid",
		});

		expect(result).toEqual({
			body: "Non-production OpenMeld setup lanes are only available from localhost or OpenMeld staging.",
			status: "error",
			statusCode: 404,
		});
	});

	it("allows worktree setup with its isolated Auth and Gateway", () => {
		expect(
			resolveOpenMeldSetupBootstrapScriptConfig({
				authUrl: "http://wt-example.localhost:31002",
				gatewayUrl: "http://wt-example.localhost:31001",
				platform: "posix",
				requestUrl:
					"http://wt-example.localhost:31000/setup?lane=dev-local&dist=npm",
				webAppUrl: "http://wt-example.localhost:31000",
			})
		).toMatchObject({
			status: "ok",
			config: {
				lane: "dev-local",
				authUrl: "http://wt-example.localhost:31002",
				gatewayUrl: "http://wt-example.localhost:31001",
			},
		});
	});

	it("allows the isolated binary canary lane from the official staging app", () => {
		const result = resolveOpenMeldSetupBootstrapScriptConfig({
			authUrl: "https://auth.staging.openmeld.ai",
			gatewayUrl: "https://gateway.staging.openmeld.ai",
			platform: "posix",
			requestUrl: "https://staging.openmeld.ai/setup?lane=canary&dist=binary",
			webAppUrl: "https://staging.openmeld.ai",
		});

		expect(result).toEqual({
			config: {
				authUrl: "https://auth.staging.openmeld.ai",
				binaryManifestUrl: "https://staging.openmeld.ai/cli/manifest.json",
				distribution: "binary",
				gatewayUrl: "https://gateway.staging.openmeld.ai",
				lane: "canary",
			},
			status: "ok",
		});
	});

	it("keeps dev-local and lookalike hosts unavailable outside localhost", () => {
		for (const requestUrl of [
			"https://staging.openmeld.ai/setup?lane=dev-local",
			"https://staging.openmeld.invalid/setup?lane=canary&dist=binary",
			"https://wt-example.localhost.example.com/setup?lane=dev-local",
			"https://notlocalhost/setup?lane=dev-local",
		]) {
			const result = resolveOpenMeldSetupBootstrapScriptConfig({
				authUrl: "https://auth.staging.openmeld.ai",
				gatewayUrl: "https://gateway.staging.openmeld.ai",
				platform: "posix",
				requestUrl,
				webAppUrl: new URL(requestUrl).origin,
			});

			expect(result).toEqual({
				body: "Non-production OpenMeld setup lanes are only available from localhost or OpenMeld staging.",
				status: "error",
				statusCode: 404,
			});
		}
	});

	it("does not allow a production request to set OPENMELD_HOME", () => {
		const result = resolveOpenMeldSetupBootstrapScriptConfig({
			authUrl: "https://auth.openmeld.invalid",
			gatewayUrl: "https://gateway.openmeld.invalid",
			platform: "posix",
			requestUrl: "https://openmeld.invalid/setup?openMeldHome=/tmp/custom",
			webAppUrl: "https://openmeld.invalid",
		});

		expect(result).toEqual({
			body: "Custom OPENMELD_HOME is only available for local setup testing.",
			status: "error",
			statusCode: 400,
		});
	});
});

function execBootstrapScript(
	tempDir: string,
	script: string,
	args: string[],
	options: BootstrapScriptRunOptions
): string {
	const scriptPath = writeBootstrapScript(tempDir, script);
	return execFileSync(
		"sh",
		buildBootstrapShellArgs(scriptPath, args, options),
		{
			encoding: "utf8",
			env: options.env as NodeJS.ProcessEnv,
			timeout: options.timeout ?? SHELL_BOOTSTRAP_COMMAND_TIMEOUT_MS,
		}
	);
}

function spawnBootstrapScript(
	tempDir: string,
	script: string,
	args: string[],
	options: BootstrapScriptRunOptions
): SpawnSyncReturns<string> {
	const scriptPath = writeBootstrapScript(tempDir, script);
	return spawnSync("sh", buildBootstrapShellArgs(scriptPath, args, options), {
		encoding: "utf8",
		env: options.env as NodeJS.ProcessEnv,
		timeout: options.timeout ?? SHELL_BOOTSTRAP_COMMAND_TIMEOUT_MS,
	});
}

function buildBootstrapShellArgs(
	scriptPath: string,
	args: string[],
	options: BootstrapScriptRunOptions
): string[] {
	const setupArgs = args[0] === "-s" && args[1] === "--" ? args.slice(2) : args;
	if (options.stdinMode === "script-stdin-file") {
		return [
			"-c",
			'script_path="$1"; shift; sh -s -- "$@" < "$script_path"',
			"openmeld-bootstrap-test",
			scriptPath,
			...setupArgs,
		];
	}

	return [scriptPath, ...setupArgs];
}

function writeBootstrapScript(tempDir: string, script: string): string {
	const scriptPath = join(tempDir, "setup-bootstrap.sh");
	writeFileSync(scriptPath, script);
	chmodSync(scriptPath, 0o755);
	return scriptPath;
}

function linkRealNodeRuntime(binDir: string): void {
	symlinkSync(process.execPath, join(binDir, "node"));
}

function linkFakeBootstrapCommand(binDir: string, command: string): void {
	symlinkSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			"__fixtures__",
			"setup-bootstrap-fake-command.sh"
		),
		join(binDir, command)
	);
}

function bootstrapTestPath(binDir: string): string {
	return `${binDir}:${BOOTSTRAP_FAKE_COMMAND_BIN}:/usr/bin:/bin`;
}

function bootstrapTestPathWithoutOpenMeld(binDir: string): string {
	return `${binDir}:${BOOTSTRAP_FAKE_COMMAND_BIN_WITHOUT_ATS}:/usr/bin:/bin`;
}

function parseSetupCompleteEvent(output: string): {
	code: string;
	payload: {
		authBaseUrl: string | null;
		cliCommandPrefix: string;
		forceServiceRefresh?: string;
		gatewayUrl: string | null;
		lane: string;
		nextCommands: string[];
	};
} {
	const line = output
		.split("\n")
		.map((candidate) => candidate.trim())
		.find((candidate) => candidate.includes('"code":"setup.complete"'));
	if (!line) {
		throw new Error(`Missing setup.complete event in output:\n${output}`);
	}
	return JSON.parse(line) as {
		code: string;
		payload: {
			authBaseUrl: string | null;
			cliCommandPrefix: string;
			forceServiceRefresh?: string;
			gatewayUrl: string | null;
			lane: string;
			nextCommands: string[];
		};
	};
}
