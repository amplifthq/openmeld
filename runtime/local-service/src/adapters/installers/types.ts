import type {
  AdapterInterruptSignal,
  AdapterRuntimeProcessEvent,
} from "@openmeld/adapter-core";
import type { LocalDaemonAdapterEntry } from "../local-adapter-container.js";

export type LocalAdapterInstallerInput = {
  registerRuntimeProcess?: (input: {
    phase: AdapterRuntimeProcessEvent["phase"];
    processId: AdapterRuntimeProcessEvent["processId"];
    signalTarget: AdapterRuntimeProcessEvent["signalTarget"];
    taskId: string;
  }) => void;
  runtimeWorkdir: string;
  sendInterrupt?: (signal: AdapterInterruptSignal) => Promise<void>;
};

export type LocalAdapterInstaller = {
  adapterId: string;
  install(input: LocalAdapterInstallerInput): LocalDaemonAdapterEntry;
};
