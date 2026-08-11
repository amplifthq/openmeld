#!/usr/bin/env node

import { waitForLocalDevStackReady } from "../../../scripts/dev/dev-stack-readiness.mjs";

run().catch((error) => {
	const message =
		error instanceof Error ? error.message : "unknown preflight failure";
	console.error(`[openmeld-web:dev-preflight] ${message}`);
	process.exit(1);
});

async function run() {
	console.log(
		"[openmeld-web:dev-preflight] waiting for auth, gateway, and the gateway chain..."
	);
	const readiness = await waitForLocalDevStackReady({
		authBaseUrl:
			process.env.OPENMELD_DEV_ISOLATED === "1"
				? process.env.BETTER_AUTH_URL
				: undefined,
		gatewayBaseUrl:
			process.env.OPENMELD_DEV_ISOLATED === "1"
				? process.env.OPENMELD_GATEWAY_URL
				: undefined,
	});
	console.log(`[openmeld-web:dev-preflight] ${readiness.summary}`);
}
