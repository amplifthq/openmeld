// Reads the public npm registry, the receipt for an OpenMeld CLI publication:
// a version exists once, with the gitHead of the exact source it came from.

import { execFileSync } from "node:child_process";

const FULL_SHA = /^[0-9a-f]{40}$/u;

// Returns null only when npm reports the version does not exist. Any other
// failure is unknown state and throws.
export function readNpmVersion(version, run = execFileSync) {
  try {
    const output = run(
      "npm",
      ["view", `openmeld@${version}`, "version", "gitHead", "--json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    if (!output) {
      return null;
    }
    const value = JSON.parse(output);
    return {
      version: value.version,
      gitHead: FULL_SHA.test(value.gitHead ?? "") ? value.gitHead : null,
    };
  } catch (error) {
    if (String(error.stderr ?? error.stdout ?? "").includes("E404")) {
      return null;
    }
    throw new Error(
      `npm view openmeld@${version} failed; registry state is unknown.`,
      { cause: error }
    );
  }
}
