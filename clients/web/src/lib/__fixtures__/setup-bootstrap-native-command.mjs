import { appendFileSync } from "node:fs";
import { join } from "node:path";

const [kind, ...args] = process.argv.slice(2);
appendFileSync(
	process.env.OPENMELD_TEST_CALLS_PATH,
	`${JSON.stringify({ kind, args })}\n`
);
if (kind === "node") {
	console.log(
		args[0] === "-p"
			? process.env.OPENMELD_TEST_NODE_MAJOR
			: `v${process.env.OPENMELD_TEST_NODE_MAJOR}.0.0`
	);
} else if (kind === "npm" && args[0] === "root") {
	console.log(join(process.env.OPENMELD_TEST_ROOT, "unused-global-prefix"));
} else if (kind === "npx") {
	const failure = process.env.OPENMELD_TEST_NPX_FAILURE_MODE;
	if (failure === "catalog" || failure === "workspace") {
		console.error("npm error code EUNSUPPORTEDPROTOCOL");
		console.error(`npm error Unsupported URL Type "${failure}:": ${failure}:`);
		process.exitCode = 7;
	} else {
		console.error("npm warn fixture warning on stderr");
		console.log("fixture setup completed");
	}
} else {
	console.error(`Unexpected fixture invocation: ${kind} ${args.join(" ")}`);
	process.exitCode = 19;
}
