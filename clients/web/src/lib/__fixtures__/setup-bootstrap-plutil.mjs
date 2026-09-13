#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

// Linux test stand-in for macOS plutil's documented -extract contract.
// macOS tests use the real system tool, including type and missing-key checks.
const args = process.argv.slice(2);
try {
	if (args[0] !== "-extract") {
		throw new Error("Unsupported plutil test command");
	}
	const value = args[1]
		.split(".")
		.reduce(
			(parent, key) => parent[key],
			JSON.parse(readFileSync(args.at(-1), "utf8"))
		);
	const expected = args[args.indexOf("-expect") + 1];
	if (
		value === undefined ||
		(args.includes("-expect") &&
			!(
				(expected === "integer" && Number.isInteger(value)) ||
				(expected === "string" && typeof value === "string")
			))
	) {
		throw new Error("Missing key or unexpected type");
	}
	const output = `${args[2] === "json" ? JSON.stringify(value) : String(value)}\n`;
	const destination = args[args.indexOf("-o") + 1];
	if (destination === "-") {
		process.stdout.write(output);
	} else {
		writeFileSync(destination, output);
	}
} catch {
	process.exitCode = 1;
}
