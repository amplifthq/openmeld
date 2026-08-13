import { createGrokBuildAdapter } from "@openmeld/adapter-grok-build";
import type { LocalAdapterInstaller } from "./types.js";

export const installGrokBuildAdapter: LocalAdapterInstaller = {
  adapterId: "grok-build",
  install(input) {
    const grokBuildAdapter = createGrokBuildAdapter({
      ...(input.registerRuntimeProcess
        ? { registerRuntimeProcess: input.registerRuntimeProcess }
        : {}),
    });
    return {
      adapter: grokBuildAdapter,
      adapterId: grokBuildAdapter.adapterId,
      transportModes: ["acp"],
    };
  },
};
