import { runSharedRuntimeAdapterContractSuite } from "../../core/test/contracts/run-shared-runtime-adapter-contract-suite.js";

runSharedRuntimeAdapterContractSuite({
  adapterId: "antigravity",
  createAdapter: async (options) => {
    const { createAntigravityAdapter } = await import("../dist/index.js");
    return createAntigravityAdapter(options);
  },
});
