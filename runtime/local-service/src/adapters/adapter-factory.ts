import type { AdapterRuntimeProcessEvent } from "@openmeld/adapter-core";
import { listLocalAdapterInstallers } from "./installers/list-installers.js";
import type { LocalDaemonAdapterEntry } from "./local-adapter-container.js";

export function createLocalAdapterEntries(input: {
  registerRuntimeProcess?: (input: {
    phase: AdapterRuntimeProcessEvent["phase"];
    processId: AdapterRuntimeProcessEvent["processId"];
    signalTarget: AdapterRuntimeProcessEvent["signalTarget"];
    taskId: string;
  }) => void;
  runtimeWorkdir: string;
  sendInterrupt?: (
    signal: import("@openmeld/adapter-core").AdapterInterruptSignal
  ) => Promise<void>;
}): LocalDaemonAdapterEntry[] {
  return listLocalAdapterInstallers().map((installer) =>
    installer.install({
      ...(input.registerRuntimeProcess
        ? { registerRuntimeProcess: input.registerRuntimeProcess }
        : {}),
      runtimeWorkdir: input.runtimeWorkdir,
      ...(input.sendInterrupt ? { sendInterrupt: input.sendInterrupt } : {}),
    })
  );
}
