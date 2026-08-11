import { runSharedRuntimeAdapterContractSuite } from "../../core/test/contracts/run-shared-runtime-adapter-contract-suite.js";

runSharedRuntimeAdapterContractSuite({
  adapterId: "openclaw",
  createAdapter: async (options) => {
    const { createOpenClawAdapter } = await import("../dist/index.js");
    return createOpenClawAdapter(options);
  },
});
