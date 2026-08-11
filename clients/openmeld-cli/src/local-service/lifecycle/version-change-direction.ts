import { compareSemver } from "../../config/version-state";

export type VersionChangeDirection = "same" | "upgrade" | "downgrade";

export function resolveVersionChangeDirection(input: {
  fromVersion: string;
  toVersion: string;
}): VersionChangeDirection {
  const comparison = compareSemver(input.fromVersion, input.toVersion);
  if (comparison === 0) {
    return "same";
  }
  return comparison < 0 ? "upgrade" : "downgrade";
}

export function isVersionDowngrade(input: {
  fromVersion: string;
  toVersion: string;
}): boolean {
  return resolveVersionChangeDirection(input) === "downgrade";
}
