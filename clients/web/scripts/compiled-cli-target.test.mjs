import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildIsolatedDevEnvironment } from "../../../scripts/dev/dev-isolated-lane.mjs";
import {
	resolveCliBuildCommand,
	resolveCliBuildEnvironment,
} from "./cli-target-config.ts";
import { resolveIsolatedWebDevSettings } from "./isolated-dev-config.ts";

const require = createRequire(new URL("../package.json", import.meta.url));
// Use the bundler shipped with the installed Vite, not a new test dependency.
const { build } = require(
	require.resolve("esbuild", {
		paths: [path.dirname(require.resolve("vite"))],
	})
);
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const releaseCommand = /npx -y openmeld@latest|https:\/\/openmeld\.ai\/setup/u;
const targetError = /target|isolat|configuration|VITE_OPENMELD/iu;
const envImport = /^#\/env$/;
const clipboardImport = /^#\/lib\/clipboard$/;
const anyModule = /.*/;
const lane = {
	laneId: "wt-command-regression",
	openMeldHome: "/tmp/openmeld command regression/home",
	wranglerStateDirectory: "/tmp/openmeld-command-regression/wrangler",
	wranglerRegistryPath: "/tmp/openmeld-command-regression/registry",
	ports: {
		auth: 28_601,
		gateway: 28_602,
		web: 28_603,
		cliBinary: 28_604,
		authInspector: 28_611,
		coreInspector: 28_612,
		gatewayInspector: 28_613,
		remoteAgentInspector: 28_614,
		remoteAgent: 28_605,
		webInspector: 28_615,
	},
};

async function compiledCommands(environment) {
	const result = await build({
		entryPoints: [path.join(webRoot, "src/lib/cli-entry-command.ts")],
		bundle: true,
		write: false,
		platform: "browser",
		format: "esm",
		define: {
			"import.meta.env": JSON.stringify({
				...environment,
				DEV: false,
				PROD: true,
				SSR: false,
			}),
			"process.env": "{}",
		},
		plugins: [
			{
				name: "command-test-boundaries",
				setup(bundler) {
					bundler.onResolve({ filter: envImport }, () => ({
						path: path.join(webRoot, "src/env.ts"),
					}));
					bundler.onResolve({ filter: clipboardImport }, () => ({
						path: "clipboard",
						namespace: "test",
					}));
					bundler.onLoad({ filter: anyModule, namespace: "test" }, () => ({
						contents:
							'export const copyTextToClipboard=()=>{throw new Error("Clipboard is not used by this test");};',
						loader: "js",
					}));
				},
			},
		],
	});
	// Only formatting functions execute. No installer, Service command, URL fetch,
	// or clipboard write is ever invoked.
	return import(
		`data:text/javascript;base64,${Buffer.from(`${result.outputFiles[0].text}\n//# sourceURL=compiled-cli-target-fixture.js`).toString("base64")}`
	);
}

function withinLaneOrigin(environment, run) {
	const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { location: { origin: environment.WEB_APP_URL } },
	});
	return Promise.resolve()
		.then(run)
		.finally(() => {
			if (oldWindow) {
				Object.defineProperty(globalThis, "window", oldWindow);
			} else {
				Reflect.deleteProperty(globalThis, "window");
			}
		});
}

const handoff = {
	startSession: "fixture-session",
	deviceCode: "fixture-device-code",
};

test("declared Worker targets, not optimization modes, govern the build", () => {
	for (const nodeEnv of ["development", "production"]) {
		assert.equal(resolveCliBuildCommand({ NODE_ENV: nodeEnv }), "openmeld-dev");
		assert.equal(
			resolveCliBuildCommand({ NODE_ENV: nodeEnv, CLOUDFLARE_ENV: "prod" }),
			"openmeld"
		);
		assert.equal(
			resolveCliBuildCommand({ NODE_ENV: nodeEnv, CLOUDFLARE_ENV: "stg" }),
			"openmeld-canary"
		);
	}
	assert.throws(
		() =>
			resolveCliBuildCommand({
				OPENMELD_DEV_ISOLATED: "1",
				CLOUDFLARE_ENV: "prod",
			}),
		targetError
	);
	assert.throws(
		() =>
			resolveCliBuildCommand({
				OPENMELD_DEV_ISOLATED: "1",
				VITE_OPENMELD_SETUP_USER_FACING_COMMAND: "openmeld",
			}),
		targetError
	);
});

test("production and staging builds preserve their actual Worker endpoints", async () => {
	for (const name of ["prod", "stg"]) {
		const environment = resolveCliBuildEnvironment({ CLOUDFLARE_ENV: name });
		await withinLaneOrigin(
			{ WEB_APP_URL: environment.VITE_OPENMELD_WEB_URL },
			async () => {
				const commands = await compiledCommands(environment);
				const setup = commands.buildWebSetupCommand(handoff);
				const setupOrigin =
					name === "prod"
						? "https://openmeld.ai"
						: environment.VITE_OPENMELD_WEB_URL;
				assert.ok(setup.includes(`${setupOrigin}/setup`));
				if (name === "prod") {
					const defaultCommands = await compiledCommands({
						...environment,
						VITE_OPENMELD_SETUP_USER_FACING_COMMAND: undefined,
					});
					assert.equal(
						defaultCommands.resolveWebStartCommand(),
						"npx -y openmeld@latest start"
					);
					assert.equal(
						commands.resolveWebStartCommand(),
						"npx -y openmeld@latest start"
					);
					assert.ok(!setup.includes("lane="));
					for (const authUrl of [
						"https://app.openmeld.ai",
						"https://openmeld.ai",
					]) {
						assert.ok(
							defaultCommands
								.buildWebSetupCommand({
									startSession: "fixture-session",
									oneTimeToken: "fixture-ott",
									authUrl,
								})
								.includes("https://openmeld.ai/setup")
						);
					}
				} else {
					assert.ok(setup.includes("dist=binary&lane=canary"));
					const followUp = commands.resolveWebSetupFollowUpCliCommandPrefix();
					assert.ok(followUp.includes(environment.VITE_BETTER_AUTH_URL));
					assert.ok(followUp.includes(environment.VITE_OPENMELD_GATEWAY_URL));
					assert.ok(followUp.endsWith("openmeld-canary"));
				}
				const windows = commands.buildWebSetupCommand({
					...handoff,
					setupPlatform: "windows",
				});
				assert.ok(windows.includes(`${setupOrigin}/setup`));
				assert.ok(windows.includes("platform=windows&dist=binary"));
			}
		);
	}
});

test("isolated helpers reject mismatched Home, lane and endpoints", async () => {
	const environment = buildIsolatedDevEnvironment(lane);
	await withinLaneOrigin(environment, async () => {
		const commands = await compiledCommands(environment);
		for (const input of [
			{ ...handoff, openMeldHome: "/tmp/another-home" },
			{ ...handoff, userFacingCommand: "openmeld" },
			{ ...handoff, gatewayUrl: "https://gateway.openmeld.ai" },
			{ ...handoff, authUrl: "http://another-worktree.localhost:28601" },
			{ ...handoff, gatewayUrl: environment.WEB_APP_URL },
			{ ...handoff, authUrl: environment.OPENMELD_GATEWAY_URL },
		]) {
			assert.throws(() => commands.buildWebSetupCommand(input), targetError);
		}
		assert.throws(
			() => commands.resolveWebCliEntryCommand({ runtimeLane: "unrecognized" }),
			targetError
		);
	});
});

test("official isolated preset stays local after production-mode compilation", async () => {
	const environment = buildIsolatedDevEnvironment(lane);
	const projected = resolveIsolatedWebDevSettings(environment);
	assert.ok(projected);
	await withinLaneOrigin(environment, async () => {
		const commands = await compiledCommands({
			...environment,
			...projected.vars,
			...resolveCliBuildEnvironment(environment),
		});
		for (const input of [
			handoff,
			{
				...handoff,
				authUrl: environment.OPENMELD_AUTH_URL,
				gatewayUrl: environment.OPENMELD_GATEWAY_URL,
			},
		]) {
			const setup = commands.buildWebSetupCommand(input);
			assert.doesNotMatch(setup, releaseCommand);
			assert.ok(setup.includes("lane=dev-local"));
			assert.ok(
				setup.includes(
					"openMeldHome=%2Ftmp%2Fopenmeld+command+regression%2Fhome"
				)
			);
			assert.ok(setup.includes(environment.WEB_APP_URL));
		}
		for (const command of [
			commands.resolveWebStartCommand(),
			commands.resolveWebServiceStopCommand(),
			commands.resolveWebSetupFollowUpCliCommandPrefix(),
			commands.formatWebCliCommand("openmeld whoami --view agent"),
			commands.resolveWebAgentsRepairCommand({ agentIds: ["codex"] }),
		]) {
			assert.doesNotMatch(command, releaseCommand);
			assert.ok(command.includes("openmeld-dev"));
			assert.ok(command.includes(lane.openMeldHome));
			assert.ok(command.includes(environment.OPENMELD_AUTH_URL));
			assert.ok(command.includes(environment.OPENMELD_GATEWAY_URL));
		}
	});
});

test("the supported setup override also governs follow-up, Start and Stop", async () => {
	const environment = {
		...buildIsolatedDevEnvironment(lane),
		VITE_OPENMELD_SETUP_USER_FACING_COMMAND: "openmeld-dev",
	};
	await withinLaneOrigin(environment, async () => {
		const commands = await compiledCommands(environment);
		for (const command of [
			commands.resolveWebSetupFollowUpCliCommandPrefix(),
			commands.resolveWebStartCommand(),
			commands.resolveWebServiceStopCommand(),
		]) {
			assert.doesNotMatch(command, releaseCommand);
			assert.ok(command.includes(lane.openMeldHome));
		}
	});
});

test("incomplete compiled isolation never silently emits a production command", async () => {
	const environment = buildIsolatedDevEnvironment(lane);
	environment.VITE_OPENMELD_SETUP_USER_FACING_COMMAND = undefined;
	await withinLaneOrigin(environment, async () => {
		const commands = await compiledCommands(environment);
		for (const format of [
			() => commands.buildWebSetupCommand(handoff),
			() => commands.resolveWebStartCommand(),
			() => commands.resolveWebSetupFollowUpCliCommandPrefix(),
		]) {
			assert.throws(format, targetError);
		}
	});
});
