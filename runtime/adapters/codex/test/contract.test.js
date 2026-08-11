import { runSharedRuntimeAdapterContractSuite } from "../../core/test/contracts/run-shared-runtime-adapter-contract-suite.js";

runSharedRuntimeAdapterContractSuite({
  adapterId: "codex",
  createAdapter: async (options) => {
    const { createCodexAdapter } = await import("../dist/index.js");
    return createCodexAdapter(options);
  },
});
