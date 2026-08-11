import assert from "node:assert/strict";
import test from "node:test";
import { listSharedProviderContractAdapterIds } from "./provider-contract-matrix.js";
import { listRuntimeSupportedRegistryAdapterIds } from "./registry-runtime-adapters.js";

test("shared runtime adapter contract matrix covers every runtime-supported registry adapter", () => {
  const sharedAdapterIds = [...listSharedProviderContractAdapterIds()].sort(
    (left, right) => left.localeCompare(right)
  );
  const registryAdapterIds = listRuntimeSupportedRegistryAdapterIds();

  assert.deepEqual(sharedAdapterIds, registryAdapterIds);
});
