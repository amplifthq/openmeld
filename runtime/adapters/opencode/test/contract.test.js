import { runSharedRuntimeAdapterContractSuite } from "../../core/test/contracts/run-shared-runtime-adapter-contract-suite.js";

runSharedRuntimeAdapterContractSuite({
  adapterId: "opencode",
  createAdapter: async (options) => {
    const { createOpenCodeAdapter } = await import("../dist/index.js");
    return createOpenCodeAdapter(options);
  },
});
