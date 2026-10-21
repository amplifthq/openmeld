import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
// Vitest 4 exports only its package entry; resolve the CLI through its bin.
const vitestPackagePath = require.resolve("vitest/package.json");
const vitestCliPath = path.join(
  path.dirname(vitestPackagePath),
  require(vitestPackagePath).bin.vitest
);

// Bound the Workers runtime lifetime as well as concurrency: this pool retains
// transformed modules until exit. Vitest owns shard selection so every file runs.
export function runGatewayTests(args = [], run = spawnSync) {
  // Explicit test filters/options retain Vitest's native single-run behavior.
  const groups =
    args.length > 0
      ? [args]
      : Array.from({ length: 4 }, (_, index) => [`--shard=${index + 1}/4`]);
  for (const group of groups) {
    const result = run(process.execPath, [vitestCliPath, "run", ...group], {
      stdio: "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = runGatewayTests(
    process.argv.slice(2).filter((arg) => arg !== "--")
  );
}
