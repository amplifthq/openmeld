import type { RemoteAgentCodeModeRuntime } from "../flue-adapter/code-mode";

export const TEST_CODE_MODE_LOADER = {} as WorkerLoader;

export const TEST_CODE_MODE_RUNTIME: RemoteAgentCodeModeRuntime = {
  createCodeTool: () => ({
    description:
      "Execute JavaScript with the active tools.\n\n" +
      "declare const codemode: Record<string, (input: unknown) => Promise<unknown>>;",
    execute: async () => ({ result: null }),
  }),
  createExecutor: () => ({}),
};
