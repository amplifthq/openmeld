import parse from "semver/functions/parse.js";
import satisfies from "semver/functions/satisfies.js";

/** Compare controller SemVer evidence without stripping prerelease identifiers. */
export function compareAgentControllerVersions(
  left: string,
  right: string
): number | null {
  const a = parse(left.trim());
  const b = parse(right.trim());
  return a && b ? a.compare(b) : null;
}

/** Version admission is necessary evidence, never a replacement for native policy checks. */
export function supportsAgentControllerVersion(
  version: string | null,
  range: string
): boolean {
  const parsed = version === null ? null : parse(version.trim());
  // Include newer prereleases, but preserve SemVer ordering at the actual floor.
  // For example, 0.159.0-alpha.1 >= 0.150.1; 0.150.1-alpha.1 < 0.150.1.
  return (
    parsed !== null && satisfies(parsed, range, { includePrerelease: true })
  );
}
