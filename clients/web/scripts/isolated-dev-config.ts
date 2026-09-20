import { join } from "node:path";

export type IsolatedWebDevSettings = {
	inspectorPort: number;
	laneId: string;
	persistStatePath: string;
	port: number;
	vars: {
		AUTH_DESKTOP_DEVELOPMENT_TARGET?: string;
		BETTER_AUTH_URL: string;
		VITE_BETTER_AUTH_URL: string;
		VITE_OPENMELD_HOME: string;
		VITE_OPENMELD_SETUP_USER_FACING_COMMAND: "openmeld-dev";
		VITE_OPENMELD_DEV_LANE_ID: string;
		VITE_OPENMELD_GATEWAY_URL: string;
		VITE_OPENMELD_WEB_URL: string;
		VITE_OPENMELD_CLI_BINARY_MANIFEST_URL: string;
		OPENMELD_CLI_BINARY_MANIFEST_URL: string;
		OPENMELD_GATEWAY_URL: string;
		WEB_APP_URL: string;
	};
};

export function resolveIsolatedWebDevSettings(
	env: Record<string, string | undefined> = process.env
): IsolatedWebDevSettings | null {
	if (String(env.OPENMELD_DEV_ISOLATED ?? "").trim() !== "1") {
		return null;
	}

	const wranglerStateDirectory = requireValue(
		env,
		"OPENMELD_DEV_WRANGLER_STATE_DIR"
	);

	return {
		inspectorPort: requirePort(env, "OPENMELD_DEV_WEB_INSPECTOR_PORT"),
		laneId: requireValue(env, "OPENMELD_DEV_LANE_ID"),
		persistStatePath: join(wranglerStateDirectory, "web"),
		port: requirePort(env, "OPENMELD_DEV_WEB_PORT"),
		vars: {
			...(env.AUTH_DESKTOP_DEVELOPMENT_TARGET
				? {
						AUTH_DESKTOP_DEVELOPMENT_TARGET:
							env.AUTH_DESKTOP_DEVELOPMENT_TARGET,
					}
				: {}),
			BETTER_AUTH_URL: requireValue(env, "BETTER_AUTH_URL"),
			VITE_BETTER_AUTH_URL: requireValue(env, "VITE_BETTER_AUTH_URL"),
			VITE_OPENMELD_HOME: requireValue(env, "VITE_OPENMELD_HOME"),
			VITE_OPENMELD_SETUP_USER_FACING_COMMAND: requireIsolatedCommand(env),
			VITE_OPENMELD_DEV_LANE_ID: requireValue(env, "OPENMELD_DEV_LANE_ID"),
			VITE_OPENMELD_GATEWAY_URL: requireValue(env, "OPENMELD_GATEWAY_URL"),
			VITE_OPENMELD_WEB_URL: requireValue(env, "WEB_APP_URL"),
			VITE_OPENMELD_CLI_BINARY_MANIFEST_URL: requireValue(
				env,
				"VITE_OPENMELD_CLI_BINARY_MANIFEST_URL"
			),
			OPENMELD_CLI_BINARY_MANIFEST_URL: requireValue(
				env,
				"OPENMELD_CLI_BINARY_MANIFEST_URL"
			),
			OPENMELD_GATEWAY_URL: requireValue(env, "OPENMELD_GATEWAY_URL"),
			WEB_APP_URL: requireValue(env, "WEB_APP_URL"),
		},
	};
}

function requireIsolatedCommand(
	env: Record<string, string | undefined>
): "openmeld-dev" {
	if (
		requireValue(env, "VITE_OPENMELD_SETUP_USER_FACING_COMMAND") !==
		"openmeld-dev"
	) {
		throw new Error("Isolated Web must use the openmeld-dev setup target.");
	}
	if (
		requireValue(env, "VITE_OPENMELD_CLI_BINARY_MANIFEST_URL") !==
		requireValue(env, "OPENMELD_CLI_BINARY_MANIFEST_URL")
	) {
		throw new Error(
			"Isolated Web and its installer must use the same CLI manifest."
		);
	}
	return "openmeld-dev";
}

function requirePort(env: Record<string, string | undefined>, name: string) {
	const value = Number(requireValue(env, name));
	if (!Number.isInteger(value) || value < 1 || value > 65_535) {
		throw new Error(`${name} must be a valid TCP port.`);
	}
	return value;
}

function requireValue(
	env: Record<string, string | undefined>,
	name: string
): string {
	const value = String(env[name] ?? "").trim();
	if (value.length === 0) {
		throw new Error(`Missing required isolated Web value: ${name}`);
	}
	return value;
}
