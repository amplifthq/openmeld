import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

// Bound the Workers runtime lifetime as well as concurrency: this pool retains
// transformed modules until exit. Vitest owns shard selection so every file runs.
export function runGatewayTests(args = [], run = spawnSync) {
  for (let shard = 1; shard <= 4; shard += 1) {
    const result = run(
      process.execPath,
      [
        require.resolve("vitest/vitest.mjs"),
        "run",
        `--shard=${shard}/4`,
        ...args,
      ],
      { stdio: "inherit" }
    );
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
