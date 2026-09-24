// @vitest-environment node
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { spawnAgentControllerProcess } from "@openmeld/adapter-core";
import {
	powerShellEncodedArguments,
	resolveWindowsPowerShellPath,
} from "@openmeld/adapter-core/windows-system";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildWebSetupCommand } from "./cli-entry-command";
import { buildWindowsBinaryBootstrap } from "./setup-bootstrap-windows-binary";

const CERTIFICATE_THUMBPRINT = /^[0-9A-F]{40}$/u;
const NEWLINE = /\r?\n/u;

vi.mock("#/env", () => ({
	env: { VITE_OPENMELD_SETUP_USER_FACING_COMMAND: "openmeld" },
}));

// Unlike the npm fixture, this executes download, OS trust, the installation
// receipt and the actual displayed command. No production certificate/account.
describe.skipIf(process.platform !== "win32")(
	"signed binary setup in Windows PowerShell 5.1",
	{ timeout: 40_000 },
	() => {
		let root: string;
		let bytes: Buffer;
		let unsignedBytes: Buffer;
		const publisher = `OpenMeld test ${randomUUID()}`;
		const env = { ...process.env };
		for (const name of Object.keys(env)) {
			if (["PATH", "PSMODULEPATH"].includes(name.toUpperCase())) {
				delete env[name];
			}
		}

		beforeAll(async () => {
			root = await mkdtemp(join(tmpdir(), "openmeld bootstrap 中文 ' "));
			const prepared = await promisify(execFile)(
				resolveWindowsPowerShellPath(),
				[
					"-NoProfile",
					"-NonInteractive",
					"-ExecutionPolicy",
					"Bypass",
					"-File",
					fileURLToPath(
						new URL(
							"./__fixtures__/setup-bootstrap-signed-command.ps1",
							import.meta.url
						)
					),
					"-Root",
					root,
					"-Publisher",
					publisher,
				],
				{ env, timeout: 60_000, windowsHide: true }
			).catch((error) => {
				console.error(
					"[windows signing fixture preparation]",
					JSON.stringify({
						code: error.code,
						signal: error.signal,
						killed: error.killed,
						stdout: error.stdout,
						stderr: error.stderr,
					})
				);
				throw error;
			});
			console.info("[windows signing fixture preparation]", prepared.stdout);
			bytes = await readFile(join(root, "fixture.exe"));
			unsignedBytes = await readFile(join(root, "fixture-unsigned.exe"));
		}, 70_000);

		afterAll(async () => {
			if (!root) {
				return;
			}
			const thumbprint = await readFile(
				join(root, "certificate-thumbprint.txt"),
				"utf8"
			).catch(() => null);
			if (thumbprint) {
				if (!CERTIFICATE_THUMBPRINT.test(thumbprint)) {
					throw new Error("Invalid owned certificate identity");
				}
				await promisify(execFile)(
					resolveWindowsPowerShellPath(),
					powerShellEncodedArguments(
						String.raw`$ErrorActionPreference='Stop'; $root = 'Cert:\LocalMachine\Root\${thumbprint}'; if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Force }; $key = 'Cert:\CurrentUser\My\${thumbprint}'; if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -DeleteKey -Force }`
					),
					{ env, timeout: 30_000, windowsHide: true }
				);
			}
			await rm(root, { recursive: true, force: true });
		}, 40_000);

		it.each([
			"valid",
			"corrupt-helper",
			"wrong-publisher",
			"unsigned-preview",
		] as const)("%s: preserves the handoff or rejects it before installation", async (mode) => {
			const callsPath = join(root, `${mode}.jsonl`);
			const home = join(root, mode);
			const artifactBytes = mode === "unsigned-preview" ? unsignedBytes : bytes;
			let origin = "";
			const server = createServer((request, response) => {
				if (request.url?.startsWith("/setup?")) {
					response.setHeader("Content-Type", "text/plain; charset=utf-8");
					response.end(
						buildWindowsBinaryBootstrap({
							internalPreview: mode === "unsigned-preview",
							manifestUrl: `${origin}/manifest.json`,
							envPreset: "dev-local",
							userFacingCommand: "openmeld-dev",
							openMeldHome: home,
							gatewayUrl: "",
							authUrl: "",
							progressMessage: "Connecting fixture...",
						})
					);
				} else if (request.url === "/manifest.json") {
					const artifact = {
						url: `${origin}/fixture.exe`,
						sha256: createHash("sha256").update(artifactBytes).digest("hex"),
						sizeBytes: artifactBytes.length,
					};
					response.setHeader("Content-Type", "application/json");
					response.end(
						JSON.stringify({
							schemaVersion: 1,
							channels: {
								stable: {
									platforms: {
										"windows-x64": {
											...artifact,
											windows:
												mode === "unsigned-preview"
													? {
															mode: "internal-unsigned-preview",
															processHelper: artifact,
														}
													: {
															publisherName:
																mode === "wrong-publisher"
																	? "Different publisher"
																	: publisher,
															processHelper: {
																...artifact,
																sha256:
																	mode === "corrupt-helper"
																		? "0".repeat(64)
																		: artifact.sha256,
															},
														},
										},
									},
									service: {
										platforms: {
											"windows-x64": {
												...artifact,
												windows:
													mode === "unsigned-preview"
														? {
																mode: "internal-unsigned-preview",
																processHelper: artifact,
															}
														: {
																publisherName: publisher,
																processHelper: artifact,
															},
											},
										},
									},
								},
							},
						})
					);
				} else if (request.url === "/fixture.exe") {
					response.end(artifactBytes);
				} else {
					response.writeHead(404).end();
				}
			});
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve)
			);
			const address = server.address();
			if (!address || typeof address === "string") {
				throw new Error("No fixture address");
			}
			origin = `http://127.0.0.1:${address.port}`;
			const grant = `fixture & 中文 'quoted' "double" slash\\`;
			const command = buildWebSetupCommand({
				setupPlatform: "windows",
				userFacingCommand: "openmeld",
				startSession: "fixture-session",
				deviceCode: grant,
				view: "human",
			}).replace("https://openmeld.ai", origin);
			// Actually execute the emitted prefix in the unchanged parent shell.
			// Its PATH has no openmeld/Node/npm; quoting must handle the real home.
			const followUp =
				mode === "valid" || mode === "unsigned-preview"
					? `$record = @(Get-Content -LiteralPath $env:OPENMELD_TEST_CALLS_PATH -Encoding UTF8 | ForEach-Object { ConvertFrom-Json $_ })[-1]; & ([scriptblock]::Create($record.followUp + " 'fixture-follow-up'")); if ($LASTEXITCODE -ne 23) { exit 99 };`
					: "";
			const owned = spawnAgentControllerProcess({
				bin: resolveWindowsPowerShellPath(),
				args: powerShellEncodedArguments(
					`[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); ${command}; $code=$LASTEXITCODE; Write-Output 'caller still running'; ${followUp} exit $code`
				),
				cwd: root,
				env: {
					...env,
					PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`,
					OPENMELD_TEST_CALLS_PATH: callsPath,
					OPENMELD_HOME: home,
				},
				shell: false,
			});
			let stdout = "";
			let stderr = "";
			owned.child.stdout.on("data", (chunk) => {
				stdout += chunk.toString();
			});
			owned.child.stderr.on("data", (chunk) => {
				stderr += chunk.toString();
			});
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				owned.terminate("SIGKILL");
			}, 30_000);
			try {
				const code = await new Promise<number | null>((resolve, reject) => {
					owned.child.once("close", resolve);
					owned.child.once("error", reject);
				});
				const detail = JSON.stringify({ mode, code, timedOut, stdout, stderr });
				console.info("[windows binary bootstrap]", detail);
				expect(timedOut, detail).toBe(false);
				expect(stdout, detail).toContain("caller still running");
				const calls = await readFile(callsPath, "utf8")
					.then((text) =>
						text
							.trim()
							.split(NEWLINE)
							.map((line) => JSON.parse(line))
					)
					.catch(() => []);
				if (mode === "valid" || mode === "unsigned-preview") {
					expect(code, detail).toBe(7);
					const prefix = `& '${join(home, "bin", "openmeld.exe").replaceAll("'", "''")}'`;
					expect(calls).toEqual([
						{
							args: ["install-self", "--json"],
							home,
							commandPrefix: "openmeld-dev",
							followUp: "openmeld-dev",
						},
						{
							args: [
								"setup",
								"--start-session",
								"fixture-session",
								"--device-code",
								grant,
								"--view",
								"human",
							],
							home,
							commandPrefix: prefix,
							followUp: prefix,
						},
						expect.objectContaining({ args: ["fixture-follow-up"], home }),
					]);
					expect(stdout).toContain("fixture setup output");
					expect(stderr).toContain("fixture setup stderr");
					if (mode === "unsigned-preview") {
						expect(stdout).toContain("internal Windows preview is unsigned");
					}
				} else {
					expect(code, detail).toBe(1);
					expect(calls).toEqual([]);
					expect(stdout).toContain(
						mode === "corrupt-helper"
							? "integrity check"
							: "publisher does not match"
					);
				}
			} finally {
				clearTimeout(timer);
				const cleanup = await owned.terminateRemainingDescendants();
				await new Promise<void>((resolve) => server.close(() => resolve()));
				expect(cleanup.ok).toBe(true);
			}
		});
	}
);
