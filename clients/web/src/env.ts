import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

function getNodeProcessEnv(): Record<string, string | undefined> {
	if (typeof process === "undefined") {
		return {};
	}
	return process.env;
}

const nodeProcessEnv = getNodeProcessEnv();

const runtimeEnv = {
	...nodeProcessEnv,
	...import.meta.env,
	OPENMELD_GATEWAY_URL:
		import.meta.env.OPENMELD_GATEWAY_URL ?? nodeProcessEnv.OPENMELD_GATEWAY_URL,
	OPENMELD_CLI_BINARY_MANIFEST_URL:
		import.meta.env.OPENMELD_CLI_BINARY_MANIFEST_URL ??
		import.meta.env.VITE_OPENMELD_CLI_BINARY_MANIFEST_URL ??
		nodeProcessEnv.OPENMELD_CLI_BINARY_MANIFEST_URL,
	WEB_APP_URL: import.meta.env.WEB_APP_URL ?? nodeProcessEnv.WEB_APP_URL,
	BETTER_AUTH_URL:
		import.meta.env.BETTER_AUTH_URL ?? nodeProcessEnv.BETTER_AUTH_URL,
	WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET:
		import.meta.env.WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET ??
		nodeProcessEnv.WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET,
	VITE_APP_TITLE:
		import.meta.env.VITE_APP_TITLE ?? nodeProcessEnv.VITE_APP_TITLE,
	VITE_BETTER_AUTH_URL:
		import.meta.env.VITE_BETTER_AUTH_URL ??
		nodeProcessEnv.VITE_BETTER_AUTH_URL ??
		nodeProcessEnv.BETTER_AUTH_URL,
	VITE_OPENMELD_HOME:
		import.meta.env.VITE_OPENMELD_HOME ??
		nodeProcessEnv.VITE_OPENMELD_HOME ??
		nodeProcessEnv.OPENMELD_HOME,
} satisfies Record<string, string | boolean | undefined>;

function formatValidationIssue(issue: unknown): string {
	if (!issue || typeof issue !== "object") {
		return `- ${String(issue)}`;
	}

	const issueRecord = issue as {
		message?: unknown;
		path?: unknown;
	};

	const pathValue = Array.isArray(issueRecord.path)
		? issueRecord.path
				.filter((segment) => typeof segment === "string")
				.join(".")
		: "";
	const message =
		typeof issueRecord.message === "string" && issueRecord.message.trim()
			? issueRecord.message
			: "Invalid value";

	return pathValue ? `- ${pathValue}: ${message}` : `- ${message}`;
}

export const env = createEnv({
	server: {
		OPENMELD_CLI_BINARY_MANIFEST_URL: z.url().optional(),
		OPENMELD_GATEWAY_URL: z.url().optional(),
		WEB_APP_URL: z.url().optional(),
		BETTER_AUTH_URL: z.url().optional(),
		WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET: z.string().min(1).optional(),
	},

	/**
	 * The prefix that client-side variables must have. This is enforced both at
	 * a type-level and at runtime.
	 */
	clientPrefix: "VITE_",

	client: {
		VITE_APP_TITLE: z.string().min(1).optional(),
		VITE_OPENMELD_HOME: z.string().min(1).optional(),
		VITE_BETTER_AUTH_URL: z.string().url().optional(),
	},

	/**
	 * What object holds the environment variables at runtime. This is usually
	 * `process.env` or `import.meta.env`.
	 */
	runtimeEnv,

	onInvalidAccess: (variable: string): never => {
		throw new Error(
			`[env] Attempted to access server env "${variable}" on the client.`
		);
	},

	onValidationError: (issues): never => {
		const details = issues
			.map((issue) => formatValidationIssue(issue))
			.join("\n");
		const guide = [
			"[env] Invalid environment variables.",
			details,
			"",
			"Checklist:",
			"- Ensure clients/web/.dev.vars or clients/web/.dev.vars.prod contains WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET",
			"- Ensure OPENMELD_GATEWAY_URL, WEB_APP_URL, BETTER_AUTH_URL, and VITE_* vars are defined in clients/web/wrangler.jsonc vars/env.prod.vars",
			"- Restart dev server after env changes",
		].join("\n");
		throw new Error(guide);
	},

	/**
	 * By default, this library will feed the environment variables directly to
	 * the Zod validator.
	 *
	 * This means that if you have an empty string for a value that is supposed
	 * to be a number (e.g. `PORT=` in a ".env" file), Zod will incorrectly flag
	 * it as a type mismatch violation. Additionally, if you have an empty string
	 * for a value that is supposed to be a string with a default value (e.g.
	 * `DOMAIN=` in an ".env" file), the default value will never be applied.
	 *
	 * In order to solve these issues, we recommend that all new projects
	 * explicitly specify this option as true.
	 */
	emptyStringAsUndefined: true,
});

type RequiredServerEnvKey =
	| "OPENMELD_GATEWAY_URL"
	| "WEB_APP_URL"
	| "BETTER_AUTH_URL"
	| "WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET";
const REQUIRED_SERVER_ENV_KEYS = [
	"OPENMELD_GATEWAY_URL",
	"WEB_APP_URL",
	"BETTER_AUTH_URL",
	"WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET",
] as const satisfies readonly RequiredServerEnvKey[];

export function getRequiredServerEnv(key: RequiredServerEnvKey): string {
	const value = env[key];
	if (!value) {
		throw new Error(`[env] Missing required server env: ${key}`);
	}
	return value;
}

if (typeof window === "undefined") {
	for (const key of REQUIRED_SERVER_ENV_KEYS) {
		getRequiredServerEnv(key);
	}
}
