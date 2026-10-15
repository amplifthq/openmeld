// Keep the public package engine contract and both generated setup shells aligned.
const CURRENT_MIN_MAJOR = 22;
const CURRENT_MAX_MAJOR_EXCLUSIVE = 26;

export const OPENMELD_NODE_ENGINE_RANGE = `>=${CURRENT_MIN_MAJOR} <${CURRENT_MAX_MAJOR_EXCLUSIVE}`;

export const OPENMELD_SUPPORTED_NODE_MAJORS: readonly number[] = Object.freeze([
  ...Array.from(
    { length: CURRENT_MAX_MAJOR_EXCLUSIVE - CURRENT_MIN_MAJOR },
    (_, index) => CURRENT_MIN_MAJOR + index
  ),
]);

export function unsupportedNodeRuntimeMessage(version: string): string | null {
  const major = Number(version.split(".")[0]);
  if (OPENMELD_SUPPORTED_NODE_MAJORS.includes(major)) {
    return null;
  }
  return `OpenMeld requires Node.js ${OPENMELD_NODE_ENGINE_RANGE}; found ${version}. Install Node.js 24 (recommended) from https://nodejs.org, then run this command again.`;
}
