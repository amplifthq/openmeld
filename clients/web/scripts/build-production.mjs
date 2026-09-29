#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createBuilder } from "vite";

const phase = process.argv[2];

if (phase) {
	await runPhase(phase);
} else {
	for (const nextPhase of ["client", "ssr", "post"]) {
		const result = spawnSync(
			process.execPath,
			[import.meta.filename, nextPhase],
			{
				cwd: process.cwd(),
				env: process.env,
				stdio: "inherit",
			}
		);
		if (result.error) {
			throw result.error;
		}
		if (result.status !== 0) {
			process.exit(result.status ?? 1);
		}
	}
}

async function runPhase(currentPhase) {
	const builder = await createBuilder();
	if (currentPhase === "client" || currentPhase === "ssr") {
		await builder.build(builder.environments[currentPhase]);
		return;
	}
	if (currentPhase !== "post") {
		throw new Error(`Unknown production build phase: ${currentPhase}`);
	}

	for (const environment of Object.values(builder.environments)) {
		environment.isBuilt = true;
	}
	await builder.buildApp();
}
