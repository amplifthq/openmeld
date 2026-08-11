import { createCodexAdapter } from "@openmeld/adapter-codex";
import type { LocalAdapterInstaller } from "./types.js";

export const installCodexAdapter: LocalAdapterInstaller = {
  adapterId: "codex",
  install(input) {
    const codexAdapter = createCodexAdapter({
      ...(input.registerRuntimeProcess
        ? { registerRuntimeProcess: input.registerRuntimeProcess }
        : {}),
      ...(input.sendInterrupt ? { sendInterrupt: input.sendInterrupt } : {}),
    });

    return {
      adapter: codexAdapter,
      adapterId: codexAdapter.adapterId,
      transportModes: ["codex-app-server"],
    };
  },
};
