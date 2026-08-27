import packageJson from "../../package.json";

declare const __OPENMELD_VERSION__: string | undefined;

/**
 * The version of the running CLI and Service bundle.
 *
 * npm builds use package.json. Binary builds may inject an isolated staging
 * prerelease so the real update lifecycle can be exercised before a production
 * version exists.
 */
export function resolveOpenMeldVersion(): string {
  const injected =
    typeof __OPENMELD_VERSION__ === "string" ? __OPENMELD_VERSION__.trim() : "";
  return injected || packageJson.version;
}

export const OPENMELD_VERSION = resolveOpenMeldVersion();
