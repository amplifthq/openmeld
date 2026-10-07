import { env } from "#/env";

export type WebSetupUserFacingCommand =
	| "openmeld"
	| "openmeld-dev"
	| "openmeld-canary";
export type WebCliTargetInput = {
	runtimeLane?: string;
	userFacingCommand?: WebSetupUserFacingCommand;
	openMeldHome?: string;
	authUrl?: string;
	gatewayUrl?: string;
};

const PRODUCTION_WEB = "https://app.openmeld.ai";
const LEGACY_APP_ORIGIN = "https://openmeld.ai";
const PRODUCTION_AUTH = "https://auth.openmeld.ai";
const PRODUCTION_GATEWAY = "https://gateway.openmeld.ai";
const COMMANDS = {
	openmeld: { lane: "prod", entryCommand: "npx -y openmeld@latest" },
	"openmeld-dev": { lane: "dev-local", entryCommand: "openmeld-dev" },
	"openmeld-canary": { lane: "canary", entryCommand: "openmeld-canary" },
} as const;

/** All generated commands use this target. Build optimization is not a lane. */
export function resolveWebCliTarget(input: WebCliTargetInput = {}) {
	const runtimeCommand = commandForLane(input.runtimeLane);
	if (
		runtimeCommand &&
		input.userFacingCommand &&
		runtimeCommand !== input.userFacingCommand
	) {
		throw new Error(
			"Conflicting OpenMeld command and runtime target. Refresh the connection details before continuing."
		);
	}
	const configuredCommand = env.VITE_OPENMELD_SETUP_USER_FACING_COMMAND;
	const command =
		input.userFacingCommand ?? runtimeCommand ?? configuredCommand;
	const home = optionalText(input.openMeldHome ?? env.VITE_OPENMELD_HOME);
	const authUrl = optionalText(input.authUrl ?? env.VITE_BETTER_AUTH_URL);
	const gatewayUrl = optionalText(
		input.gatewayUrl ?? env.VITE_OPENMELD_GATEWAY_URL
	);
	const webUrl = optionalText(env.VITE_OPENMELD_WEB_URL);
	const manifestUrl = optionalText(env.VITE_OPENMELD_CLI_BINARY_MANIFEST_URL);
	const isolatedLane = optionalText(env.VITE_OPENMELD_DEV_LANE_ID);
	if (
		!command &&
		(home ||
			manifestUrl ||
			isolatedLane ||
			(authUrl && !isProductionAuth(authUrl)) ||
			(gatewayUrl && !sameOrigin(gatewayUrl, PRODUCTION_GATEWAY)) ||
			(webUrl && !sameOrigin(webUrl, PRODUCTION_WEB)))
	) {
		throw new Error(
			"OpenMeld setup target is missing. Rebuild this environment with VITE_OPENMELD_SETUP_USER_FACING_COMMAND; no production command was generated."
		);
	}
	const userFacingCommand = command ?? "openmeld";
	const target = COMMANDS[userFacingCommand];
	const resolved = {
		...target,
		userFacingCommand,
		openMeldHome: target.lane === "prod" ? undefined : home,
		authUrl,
		gatewayUrl,
		webUrl,
		manifestUrl,
		isolatedLane,
		defaultAuthUrl:
			target.lane === "prod" ? PRODUCTION_AUTH : "http://localhost:8788",
		productionBootstrap:
			target.lane === "prod" &&
			(!authUrl || isProductionAuth(authUrl)) &&
			(!gatewayUrl || sameOrigin(gatewayUrl, PRODUCTION_GATEWAY)),
	};
	validateIsolatedTarget(resolved);
	return resolved;
}

export type WebCliTarget = ReturnType<typeof resolveWebCliTarget>;

function validateIsolatedTarget(target: WebCliTarget): void {
	const {
		isolatedLane,
		userFacingCommand,
		openMeldHome: home,
		authUrl,
		gatewayUrl,
		webUrl,
		manifestUrl,
	} = target;
	if (!isolatedLane) {
		return;
	}
	if (
		userFacingCommand !== "openmeld-dev" ||
		env.VITE_OPENMELD_SETUP_USER_FACING_COMMAND !== "openmeld-dev" ||
		!home ||
		!authUrl ||
		!gatewayUrl ||
		!webUrl ||
		!manifestUrl
	) {
		throw new Error(
			"Incomplete or conflicting isolated OpenMeld target. Rebuild through the worktree launcher with its Home, endpoints and CLI manifest."
		);
	}
	if (home !== optionalText(env.VITE_OPENMELD_HOME)) {
		throw new Error(
			"Isolated OpenMeld commands cannot switch to another Home."
		);
	}
	if (
		authUrl !== optionalText(env.VITE_BETTER_AUTH_URL) ||
		gatewayUrl !== optionalText(env.VITE_OPENMELD_GATEWAY_URL)
	) {
		throw new Error(
			"Isolated OpenMeld commands must retain the configured Auth and Gateway endpoints, including their ports."
		);
	}
	const hostname = `${isolatedLane}.localhost`;
	for (const url of [authUrl, gatewayUrl, webUrl]) {
		if (!isLocalTargetUrl(url, [hostname])) {
			throw new Error(
				"Isolated OpenMeld target endpoints must belong to the selected worktree lane."
			);
		}
	}
	if (!isLocalTargetUrl(manifestUrl, ["127.0.0.1", hostname])) {
		throw new Error(
			"Isolated OpenMeld target requires its local CLI manifest."
		);
	}
}

function isLocalTargetUrl(value: string, hosts: string[]): boolean {
	const url = new URL(value);
	return (
		url.protocol === "http:" &&
		hosts.includes(url.hostname) &&
		!url.username &&
		!url.password
	);
}

function commandForLane(lane?: string): WebSetupUserFacingCommand | undefined {
	if (lane === undefined) {
		return undefined;
	}
	if (lane === "prod" || lane === "openmeld") {
		return "openmeld";
	}
	if (lane === "dev-local" || lane === "openmeld-dev") {
		return "openmeld-dev";
	}
	if (lane === "canary" || lane === "openmeld-canary") {
		return "openmeld-canary";
	}
	throw new Error(
		"Unknown OpenMeld runtime target. Refresh the connection details before continuing."
	);
}

function optionalText(value?: string): string | undefined {
	return value?.trim() || undefined;
}
function sameOrigin(value: string, origin: string): boolean {
	try {
		const url = new URL(value);
		return url.origin === origin && !url.username && !url.password;
	} catch {
		return false;
	}
}
function isProductionAuth(value: string): boolean {
	return (
		sameOrigin(value, PRODUCTION_AUTH) ||
		sameOrigin(value, PRODUCTION_WEB) ||
		// The migration keeps the old root Auth proxy available to existing clients.
		sameOrigin(value, LEGACY_APP_ORIGIN)
	);
}
