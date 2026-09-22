// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOpenMeldSetupBootstrapPowerShellScript } from "./setup-bootstrap-script";

const NEWLINE = /\r?\n/u;
type FixtureCall = { kind: string; args: string[] };

function quoted(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function runBootstrap(major: number, failure = "") {
	const root = mkdtempSync(join(tmpdir(), "openmeld setup 连接 "));
	const bin = join(root, "bin");
	const callsPath = join(root, "calls.jsonl");
	const scriptPath = join(root, "setup.ps1");
	const fixture = join(
		dirname(fileURLToPath(import.meta.url)),
		"__fixtures__/setup-bootstrap-native-command.mjs"
	);
	try {
		mkdirSync(bin);
		for (const command of ["node", "npm", "npx"]) {
			writeFileSync(
				join(bin, `${command}.ps1`),
				`\uFEFF& ${quoted(process.execPath)} ${quoted(fixture)} ${quoted(command)} @args\nexit $LASTEXITCODE\n`
			);
		}
		writeFileSync(
			scriptPath,
			`\uFEFF${buildOpenMeldSetupBootstrapPowerShellScript({ distribution: "npm", lane: "prod", openMeldHome: join(root, "openmeld-home") })}`
		);
		const env = Object.fromEntries(
			Object.entries(process.env).filter(
				([key]) => key.toLowerCase() !== "path"
			)
		);
		const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
		if (!systemRoot) {
			throw new Error("Native Windows test requires SystemRoot.");
		}
		const result = spawnSync(
			join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
			[
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				scriptPath,
				"setup",
				"--start-session",
				"fixture-session",
				"--device-code",
				"fixture & 中文",
				"--view",
				"human",
			],
			{
				cwd: root,
				env: {
					...env,
					PATH: `${bin};${process.env.Path ?? process.env.PATH ?? ""}`,
					OPENMELD_TEST_ROOT: root,
					OPENMELD_TEST_CALLS_PATH: callsPath,
					OPENMELD_TEST_NODE_MAJOR: String(major),
					OPENMELD_TEST_NPX_FAILURE_MODE: failure,
				},
				encoding: "utf8",
				timeout: 30_000,
				windowsHide: true,
			}
		);
		if (result.error) {
			throw result.error;
		}
		const calls = readFileSync(callsPath, "utf8")
			.trim()
			.split(NEWLINE)
			.filter(Boolean)
			.map((line) => JSON.parse(line) as FixtureCall);
		return { ...result, calls };
	} finally {
		rmSync(root, { recursive: true, force: true, maxRetries: 3 });
	}
}

describe.skipIf(process.platform !== "win32")(
	"generated setup in native Windows PowerShell 5.1",
	() => {
		it.each([
			"catalog",
			"workspace",
		])("reports %s dependency failures and preserves the original exit code", (failure) => {
			const result = runBootstrap(24, failure);
			expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(7);
			expect(result.stdout).toContain("dependency reference");
			expect(result.stdout).toContain("EUNSUPPORTEDPROTOCOL");
			expect(result.stdout).not.toContain("fix the npm or network error");
			const npxCalls = result.calls.filter((call) => call.kind === "npx");
			expect(npxCalls).toHaveLength(2);
			expect(npxCalls[0]?.args).toContain("fixture & 中文");
			expect(npxCalls[1]?.args).toEqual(["-y", "openmeld@latest", "--version"]);
		});

		it.each([
			20, 22, 23, 24, 25,
		])("admits supported Node major %s and does not mistake stderr warnings for failure", (major) => {
			const result = runBootstrap(major);
			expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
			expect(result.stdout).toContain("fixture setup completed");
			expect(result.calls.filter((call) => call.kind === "npx")).toHaveLength(
				1
			);
		});

		it.each([
			19, 21, 26,
		])("rejects unsupported Node major %s before invoking npm", (major) => {
			const result = runBootstrap(major);
			expect(result.status).toBe(1);
			expect(result.stdout).toContain("20.x || >=22 <26");
			expect(result.calls.every((call) => call.kind === "node")).toBe(true);
		});
	}
);
