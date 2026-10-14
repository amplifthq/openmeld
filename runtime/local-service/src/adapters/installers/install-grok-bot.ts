import { createGrokBotAdapter } from "@openmeld/adapter-grok-bot";
import type { LocalAdapterInstaller } from "./types.js";

export const installGrokBotAdapter: LocalAdapterInstaller = {
  adapterId: "grok-bot",
  install() {
    return {
      adapter: createGrokBotAdapter(),
      adapterId: "grok-bot",
      transportModes: ["local-cli"],
    };
  },
};
