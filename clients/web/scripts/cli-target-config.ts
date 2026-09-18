import { readFileSync } from "node:fs";
import { parseJsoncObject } from "../../../packages/db/src/tooling/parse-jsonc.ts";

type WorkerTargetConfig = {
	vars: Record<string, string>;
	env: Record<string, { vars: Record<string, string> }>;
};

/** Project only public command inputs from the existing Worker config owner. */
export function resolveCliBuildEnvironment(
	environment: Record<string, string | undefined>
) {
	const command = resolveCliBuildCommand(environment);
	const config = parseJsoncObject<WorkerTargetConfig>(
		readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
	);
	const environmentName =
		environment.OPENMELD_DESKTOP_TARGET === "production"
			? "prod"
			: environment.CLOUDFLARE_ENV;
	const vars = environmentName
		? config.env[environmentName]?.vars
		: config.vars;
	if (!vars) {
		throw new Error(
			"Unknown Cloudflare environment for the OpenMeld CLI target."
		);
	}
	return {
		VITE_OPENMELD_SETUP_USER_FACING_COMMAND: command,
		VITE_OPENMELD_GATEWAY_URL:
			environment.VITE_OPENMELD_GATEWAY_URL ??
			environment.OPENMELD_GATEWAY_URL ??
			vars.OPENMELD_GATEWAY_URL,
		VITE_OPENMELD_WEB_URL:
			environment.VITE_OPENMELD_WEB_URL ??
			environment.WEB_APP_URL ??
			vars.WEB_APP_URL,
		VITE_BETTER_AUTH_URL:
			environment.VITE_BETTER_AUTH_URL ??
			environment.BETTER_AUTH_URL ??
			vars.VITE_BETTER_AUTH_URL,
	};
}

export function resolveCliBuildCommand(
	env: Record<string, string | undefined>
) {
	const isolated = env.OPENMELD_DEV_ISOLATED === "1";
	const production =
		env.CLOUDFLARE_ENV === "prod" ||
		env.OPENMELD_DESKTOP_TARGET === "production";
	const staging = env.CLOUDFLARE_ENV === "stg";
	if ((isolated && (production || staging)) || (production && staging)) {
		throw new Error(
			"Conflicting isolated, production or staging CLI build target."
		);
	}
	const explicit = env.VITE_OPENMELD_SETUP_USER_FACING_COMMAND;
	let declared: string | undefined;
	if (isolated) {
		declared = "openmeld-dev";
	} else if (production) {
		declared = "openmeld";
	} else if (staging) {
		declared = "openmeld-canary";
	}
	if (
		explicit &&
		!["openmeld", "openmeld-dev", "openmeld-canary"].includes(explicit)
	) {
		throw new Error("Invalid VITE_OPENMELD_SETUP_USER_FACING_COMMAND.");
	}
	if (explicit && declared && explicit !== declared) {
		throw new Error("CLI command conflicts with the declared build target.");
	}
	if (env.OPENMELD_DESKTOP_TARGET === "disposable" && !isolated && !explicit) {
		throw new Error(
			"Disposable Desktop builds require an explicit isolated CLI target."
		);
	}
	// The unnamed Wrangler environment is local development, for both dev and
	// optimized builds. This does not depend on Vite DEV/PROD or NODE_ENV.
	return declared ?? explicit ?? "openmeld-dev";
}
