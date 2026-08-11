import { createClaudeCodeAdapter } from "@openmeld/adapter-claude-code";
import type { LocalAdapterInstaller } from "./types.js";

export const installClaudeCodeAdapter: LocalAdapterInstaller = {
  adapterId: "claude-code",
  install(input) {
    const claudeCodeAdapter = createClaudeCodeAdapter({
      ...(input.registerRuntimeProcess
        ? { registerRuntimeProcess: input.registerRuntimeProcess }
        : {}),
      ...(input.sendInterrupt ? { sendInterrupt: input.sendInterrupt } : {}),
    });

    return {
      adapter: claudeCodeAdapter,
      adapterId: claudeCodeAdapter.adapterId,
      transportModes: ["local-cli"],
    };
  },
};
