import { runSharedRuntimeAdapterContractSuite } from "../../core/test/contracts/run-shared-runtime-adapter-contract-suite.js";

runSharedRuntimeAdapterContractSuite({
  adapterId: "claude-code",
  createAdapter: async (options) => {
    const { createClaudeCodeAdapter } = await import("../dist/index.js");
    return createClaudeCodeAdapter(options);
  },
});
