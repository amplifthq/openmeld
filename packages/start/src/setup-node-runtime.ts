// Keep the public package engine contract and both generated setup shells aligned.
const LEGACY_MAJOR = 20;
const CURRENT_MIN_MAJOR = 22;
const CURRENT_MAX_MAJOR_EXCLUSIVE = 26;

export const OPENMELD_NODE_ENGINE_RANGE = `${LEGACY_MAJOR}.x || >=${CURRENT_MIN_MAJOR} <${CURRENT_MAX_MAJOR_EXCLUSIVE}`;

export const OPENMELD_SUPPORTED_NODE_MAJORS: readonly number[] = Object.freeze([
  LEGACY_MAJOR,
  ...Array.from(
    { length: CURRENT_MAX_MAJOR_EXCLUSIVE - CURRENT_MIN_MAJOR },
    (_, index) => CURRENT_MIN_MAJOR + index
  ),
]);
