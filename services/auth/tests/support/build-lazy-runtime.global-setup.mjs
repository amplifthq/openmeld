import { buildLazyRuntimeModules } from "../../scripts/build-lazy-runtime-modules.mjs";

export async function setup() {
  await buildLazyRuntimeModules();
}
