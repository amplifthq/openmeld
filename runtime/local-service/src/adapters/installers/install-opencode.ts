import { createOpenCodeAdapter } from "@openmeld/adapter-opencode";
import type { LocalAdapterInstaller } from "./types.js";

export const installOpenCodeAdapter: LocalAdapterInstaller = {
  adapterId: "opencode",
  install(input) {
    const openCodeAdapter = createOpenCodeAdapter({
      ...(input.registerRuntimeProcess
        ? { registerRuntimeProcess: input.registerRuntimeProcess }
        : {}),
      ...(input.sendInterrupt ? { sendInterrupt: input.sendInterrupt } : {}),
    });

    return {
      adapter: openCodeAdapter,
      adapterId: openCodeAdapter.adapterId,
      transportModes: ["local-cli"],
    };
  },
};
