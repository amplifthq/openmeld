// Keep the public package engine contract and both generated setup shells aligned.
export const OPENMELD_SUPPORTED_NODE_MAJORS: readonly number[] = Object.freeze([
  22, 24, 25,
]);

export const OPENMELD_NODE_ENGINE_RANGE = OPENMELD_SUPPORTED_NODE_MAJORS.map(
  (major) => `${major}.x`
).join(" || ");

export function unsupportedNodeRuntimeMessage(version: string): string | null {
  const normalized = version.startsWith("v") ? version.slice(1) : version;
  const major = Number(normalized.split(".")[0]);
  if (OPENMELD_SUPPORTED_NODE_MAJORS.includes(major)) {
    return null;
  }
  return `OpenMeld requires Node.js ${OPENMELD_NODE_ENGINE_RANGE}; found ${version}. Install Node.js 24 (recommended) from https://nodejs.org, then run this command again.`;
}
