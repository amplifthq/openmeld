import { Script } from "node:vm";
import type { Executor } from "@cloudflare/codemode";
import { createCodeTool } from "@cloudflare/codemode/ai";
import type { RemoteAgentCodeModeRuntime } from "../flue-adapter/code-mode";

// Node integration tests execute real SDK-generated code against the real
// capability handlers. This is not an acceptance test of Worker Loader isolation.
const executor: Executor = {
  async execute(code, providers) {
    if (!Array.isArray(providers)) {
      throw new Error("Expected resolved Code Mode providers.");
    }
    const globals = Object.fromEntries(
      providers.map((provider) => [provider.name, provider.fns])
    );
    const result: unknown = await new Script(`(${code})()`).runInNewContext(
      globals,
      { timeout: 1000 }
    );
    return { result };
  },
};

export const NODE_CODE_MODE_RUNTIME: RemoteAgentCodeModeRuntime = {
  createExecutor: () => executor,
  createCodeTool: (input) => createCodeTool({ ...input, executor }),
};
