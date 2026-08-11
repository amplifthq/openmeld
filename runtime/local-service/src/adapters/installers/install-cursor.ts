import { createCursorAdapter } from "@openmeld/adapter-cursor";
import type { LocalAdapterInstaller } from "./types.js";

export const installCursorAdapter: LocalAdapterInstaller = {
  adapterId: "cursor",
  install(input) {
    const cursorAdapter = createCursorAdapter({
      ...(input.registerRuntimeProcess
        ? { registerRuntimeProcess: input.registerRuntimeProcess }
        : {}),
    });
    return {
      adapter: cursorAdapter,
      adapterId: cursorAdapter.adapterId,
      transportModes: ["acp"],
    };
  },
};
