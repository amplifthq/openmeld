#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createBuilder } from "vite";

if (process.argv[2] !== "--build") {
	const result = spawnSync(
		process.execPath,
		["--expose-gc", import.meta.filename, "--build"],
		{ cwd: process.cwd(), env: process.env, stdio: "inherit" }
	);
	if (result.error) {
		throw result.error;
	}
	process.exit(result.status ?? 1);
}

// TanStack Start records server functions while building the client and uses
// that in-memory registry for the SSR resolver and final app manifest. All
// three phases must therefore share one Vite builder instance.
const builder = await createBuilder();
let peakHeapBytes = 0;
const sampleHeap = () => {
	peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
};
const heapSampler = setInterval(sampleHeap, 50);
for (const phase of ["client", "ssr"]) {
	await builder.build(builder.environments[phase]);
	sampleHeap();
	console.log(
		`Web ${phase} peak V8 heap: ${Math.ceil(peakHeapBytes / 1024 ** 2)} MiB`
	);
	global.gc?.();
	console.log(
		`Web ${phase} retained V8 heap: ${Math.ceil(process.memoryUsage().heapUsed / 1024 ** 2)} MiB`
	);
}
await builder.buildApp();
sampleHeap();
clearInterval(heapSampler);
console.log(
	`Web build peak V8 heap: ${Math.ceil(peakHeapBytes / 1024 ** 2)} MiB`
);
