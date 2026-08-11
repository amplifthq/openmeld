/**
 * Build-time distribution marker.
 *
 * `OpenMeldDistribution` records how this CLI build is shipped and run. It is
 * orthogonal to the runtime lane / env preset (prod | dev-local | canary):
 *
 * - `npm`: shipped as the `openmeld` npm package, run via `node dist/*.js`; the
 *   OpenMeld Service daemon runs as a self-contained node bundle (dist copy +
 *   node_modules dependency closure).
 * - `binary`: shipped as a precompiled single binary (`bun build --compile`),
 *   run and self-installed as one executable; the daemon runs the same binary
 *   via its `service run` subcommand.
 *
 * The value is injected at build time (tsdown defines `"npm"`;
 * `scripts/release/build-cli-binary.mjs` defines `"binary"` via Bun `--define`)
 * so distribution-mode branching never guesses from paths and cannot be spoofed
 * by a runtime environment variable.
 */
declare const __OPENMELD_DISTRIBUTION__: string | undefined;

export type OpenMeldDistribution = "binary" | "npm";

const BINARY_DISTRIBUTION: OpenMeldDistribution = "binary";
const NPM_DISTRIBUTION: OpenMeldDistribution = "npm";

/**
 * The distribution form this CLI build was compiled for. Falls back to `npm`
 * when the marker is absent (e.g. under Vitest, where no build-time define
 * runs), which keeps the safe, path-independent default.
 */
export function resolveOpenMeldDistribution(): OpenMeldDistribution {
  const injected =
    typeof __OPENMELD_DISTRIBUTION__ === "string"
      ? __OPENMELD_DISTRIBUTION__
      : undefined;
  return injected === BINARY_DISTRIBUTION
    ? BINARY_DISTRIBUTION
    : NPM_DISTRIBUTION;
}

export function isBinaryDistribution(): boolean {
  return resolveOpenMeldDistribution() === BINARY_DISTRIBUTION;
}
