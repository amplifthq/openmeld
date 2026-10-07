import { createAntigravityAdapter } from "@openmeld/adapter-antigravity";
import type { LocalAdapterInstaller } from "./types.js";

export const installAntigravityAdapter: LocalAdapterInstaller = {
  adapterId: "antigravity",
  install(input) {
    const antigravityAdapter = createAntigravityAdapter({
      ...(input.registerRuntimeProcess
        ? { registerRuntimeProcess: input.registerRuntimeProcess }
        : {}),
    });

    return {
      adapter: antigravityAdapter,
      adapterId: antigravityAdapter.adapterId,
      transportModes: ["local-cli"],
    };
  },
};
