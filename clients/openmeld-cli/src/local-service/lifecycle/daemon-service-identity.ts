import type {
  OpenMeldEnvPreset,
  OpenMeldPathResolutionInput,
} from "../../config/paths";
import { resolveOpenMeldEnvPreset } from "../../config/paths";

export type DaemonServiceIdentity = {
  envPreset: OpenMeldEnvPreset;
  serviceName: string;
  launchdLabel: string;
  windowsServiceName: string;
  windowsDisplayName: string;
  cliEntryAliases: readonly string[];
};

const DAEMON_SERVICE_IDENTITY_BY_PRESET = {
  prod: {
    envPreset: "prod",
    serviceName: "openmeld-daemon",
    launchdLabel: "com.openmeld.openmeld-background-service",
    windowsServiceName: "OpenMeld-Daemon",
    windowsDisplayName: "OpenMeld Daemon Service",
    cliEntryAliases: ["openmeld"],
  },
  "dev-local": {
    envPreset: "dev-local",
    serviceName: "openmeld-daemon-dev-local",
    launchdLabel: "com.openmeld.openmeld-background-service.dev-local",
    windowsServiceName: "OpenMeld-Daemon-DevLocal",
    windowsDisplayName: "OpenMeld Daemon Service (Dev Local)",
    cliEntryAliases: ["openmeld-dev"],
  },
  canary: {
    envPreset: "canary",
    serviceName: "openmeld-daemon-canary",
    launchdLabel: "com.openmeld.openmeld-background-service.canary",
    windowsServiceName: "OpenMeld-Daemon-Canary",
    windowsDisplayName: "OpenMeld Daemon Service (Canary)",
    cliEntryAliases: ["openmeld-canary"],
  },
} as const satisfies Record<OpenMeldEnvPreset, DaemonServiceIdentity>;

export function resolveDaemonServiceIdentity(
  input: OpenMeldPathResolutionInput = {}
): DaemonServiceIdentity {
  const preset = resolveOpenMeldEnvPreset(input);
  return DAEMON_SERVICE_IDENTITY_BY_PRESET[preset];
}
