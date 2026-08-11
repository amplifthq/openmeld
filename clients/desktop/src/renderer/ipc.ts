import type { OpenMeldBridge } from "../shared/ipc-contract";

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: global augmentation of Window requires interface merging
  interface Window {
    openmeld?: OpenMeldBridge;
  }
}

/** Resolve the preload-exposed bridge, or throw if the preload didn't load. */
export function getBridge(): OpenMeldBridge {
  if (!window.openmeld) {
    throw new Error("OpenMeld bridge unavailable (preload script not loaded)");
  }
  return window.openmeld;
}
