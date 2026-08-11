import { spawnSync } from "node:child_process";
import process from "node:process";

const PACKAGED_CLI_BUILD_ARGS = [
  "exec",
  "turbo",
  "run",
  "build",
  "--filter=openmeld",
  // Release truth must come from tsdown's clean build. A Turbo cache hit can
  // restore current outputs without removing stale chunks from an older build.
  "--force",
];

export function buildPackagedOpenMeldCli(input) {
  const result = spawnSync(
    resolveCommandBinary("pnpm"),
    PACKAGED_CLI_BUILD_ARGS,
    {
      cwd: input.repoRoot,
      env: input.env ?? process.env,
      stdio: "inherit",
    }
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `pnpm ${PACKAGED_CLI_BUILD_ARGS.join(" ")} failed with exit code ${String(result.status)}`
    );
  }
}

function resolveCommandBinary(command) {
  if (process.platform !== "win32") {
    return command;
  }
  return `${command}.cmd`;
}
