import { createOpenClawAdapter } from "@openmeld/adapter-openclaw";
import type { LocalAdapterInstaller } from "./types.js";

export const installOpenClawAdapter: LocalAdapterInstaller = {
  adapterId: "openclaw",
  install(input) {
    const openClawAdapter = createOpenClawAdapter({
      ...(input.registerRuntimeProcess
        ? { registerRuntimeProcess: input.registerRuntimeProcess }
        : {}),
      ...(input.sendInterrupt ? { sendInterrupt: input.sendInterrupt } : {}),
    });

    return {
      adapter: openClawAdapter,
      adapterId: openClawAdapter.adapterId,
      transportModes: ["local-cli"],
    };
  },
};
